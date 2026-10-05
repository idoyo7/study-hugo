#!/usr/bin/env python3
"""Validate a generated Hugo site after the content information-architecture move.

The checker deliberately works on generated output rather than source front matter:
it validates the URLs and navigation that readers and crawlers actually receive.
It uses only the Python standard library.
"""

from __future__ import annotations

import argparse
import csv
import json
import posixpath
import re
import sys
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable, Iterator
from urllib.parse import unquote, urljoin, urlsplit


CANONICAL_HOST = "docs.makgol.com"
ORIGIN = f"https://{CANONICAL_HOST}"
ROOT_SECTIONS = ("/platform/", "/observability/", "/data/", "/engineering/")
UTILITY_NAVIGATION_PATHS = {"/", "/about/"}
VOID_ELEMENTS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
    "meta", "param", "source", "track", "wbr",
}
SOURCE_TAGS = {"audio", "embed", "iframe", "img", "input", "script", "source", "track", "video"}
URL_FIELDS = ("original_url", "old_url", "url", "permalink", "new_url")
SOURCE_LEDGER_COLUMNS = ("old_source", "new_source", "original_url", "aliases")
# Hugo fingerprint 가 내는 해시 길이: md5 32, sha256 64, sha384 96, sha512 128 (hex).
FINGERPRINTED_NAME = re.compile(
    r"^(?P<stem>.+)\.(?P<hash>[0-9a-f]{32}|[0-9a-f]{64}|[0-9a-f]{96}|[0-9a-f]{128})\.(?P<ext>[^./]+)$"
)


def fingerprint_key(path: str) -> tuple[str, str, str] | None:
    """`<dir>/<stem>.<hash>.<ext>` 꼴이면 해시를 뺀 (dir, stem, ext), 아니면 None."""
    directory, _, name = path.rpartition("/")
    match = FINGERPRINTED_NAME.match(name)
    if match is None:
        return None
    return directory, match.group("stem"), match.group("ext")


def normalize_path(path: str, *, keep_trailing: bool = True) -> str:
    decoded = unicodedata.normalize("NFC", unquote(path or "/"))
    trailing = keep_trailing and decoded.endswith("/")
    normalized = posixpath.normpath("/" + decoded.lstrip("/"))
    if normalized == "/.":
        normalized = "/"
    if trailing and normalized != "/":
        normalized += "/"
    return normalized


def public_url_for_file(relative: Path) -> str:
    value = "/" + relative.as_posix()
    if value == "/index.html":
        return "/"
    if value.endswith("/index.html"):
        return value[: -len("index.html")]
    return value


@dataclass
class Node:
    tag: str
    attrs: dict[str, str]
    parent: "Node | None" = None
    children: list["Node"] = field(default_factory=list)
    line: int = 0

    def classes(self) -> set[str]:
        return set(self.attrs.get("class", "").split())

    def descendants(self, tag: str | None = None) -> Iterator["Node"]:
        for child in self.children:
            if tag is None or child.tag == tag:
                yield child
            yield from child.descendants(tag)

    def ancestors(self) -> Iterator["Node"]:
        current = self.parent
        while current is not None:
            yield current
            current = current.parent


class DocumentParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root = Node("#document", {})
        self.stack = [self.root]

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        node = Node(
            tag.lower(),
            {key.lower(): value or "" for key, value in attrs},
            self.stack[-1],
            line=self.getpos()[0],
        )
        self.stack[-1].children.append(node)
        if tag.lower() not in VOID_ELEMENTS:
            self.stack.append(node)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        if self.stack[-1].tag == tag.lower():
            self.stack.pop()

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                return


@dataclass(frozen=True)
class Reference:
    source_url: str
    raw: str
    kind: str
    line: int


@dataclass(frozen=True)
class BrokenReference:
    kind: str
    target: str
    source_url: str
    line: int

    @property
    def comparison_key(self) -> tuple[str, str, str]:
        return self.kind, self.target, self.source_url


@dataclass
class Document:
    path: Path
    url: str
    root: Node
    ids: set[str]
    references: list[Reference]
    canonicals: list[str]
    redirect: str | None


def _srcset_values(value: str) -> Iterator[str]:
    for candidate in value.split(","):
        token = candidate.strip().split()
        if token:
            yield token[0]


def parse_document(path: Path, site_dir: Path) -> Document:
    relative = path.relative_to(site_dir)
    url = public_url_for_file(relative)
    parser = DocumentParser()
    parser.feed(path.read_text(encoding="utf-8", errors="replace"))
    ids: set[str] = set()
    references: list[Reference] = []
    canonicals: list[str] = []
    redirect: str | None = None

    for node in parser.root.descendants():
        node_id = node.attrs.get("id")
        if node_id:
            ids.add(unicodedata.normalize("NFC", node_id))
        if node.tag == "a" and node.attrs.get("name"):
            ids.add(unicodedata.normalize("NFC", node.attrs["name"]))

        if node.tag in {"a", "area", "link"} and node.attrs.get("href"):
            kind = "anchor" if node.tag in {"a", "area"} else "asset"
            references.append(Reference(url, node.attrs["href"].strip(), kind, node.line))
        if node.tag in SOURCE_TAGS and node.attrs.get("src"):
            references.append(Reference(url, node.attrs["src"].strip(), "asset", node.line))
        if node.attrs.get("srcset"):
            references.extend(
                Reference(url, item, "asset", node.line)
                for item in _srcset_values(node.attrs["srcset"])
            )

        if node.tag == "link" and "canonical" in node.attrs.get("rel", "").lower().split():
            canonicals.append(node.attrs.get("href", "").strip())
        if node.tag == "meta" and node.attrs.get("http-equiv", "").lower() == "refresh":
            content = node.attrs.get("content", "")
            for part in content.split(";"):
                key, separator, value = part.partition("=")
                if separator and key.strip().lower() == "url":
                    redirect = value.strip().strip("'\"")
                    references.append(Reference(url, redirect, "redirect", node.line))
                    break

    return Document(path, url, parser.root, ids, references, canonicals, redirect)


@dataclass(frozen=True)
class ResolvedURL:
    path: str
    fragment: str

    @property
    def display(self) -> str:
        return self.path + (f"#{self.fragment}" if self.fragment else "")


def resolve_local(raw: str, source_url: str) -> ResolvedURL | None:
    raw = raw.strip()
    if not raw:
        return None
    lowered = raw.lower()
    if lowered.startswith(("mailto:", "tel:", "javascript:", "data:", "blob:")):
        return None
    absolute = urlsplit(urljoin(ORIGIN + source_url, raw))
    if absolute.scheme not in {"http", "https"}:
        return None
    if (absolute.hostname or "").lower() != CANONICAL_HOST:
        return None
    fragment = unicodedata.normalize("NFC", unquote(absolute.fragment))
    return ResolvedURL(normalize_path(absolute.path), fragment)


class SiteIndex:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        if not self.root.is_dir():
            raise ValueError(f"site directory does not exist: {root}")
        self.resources: set[str] = set()
        self.page_urls: set[str] = set()
        self.route_to_document: dict[str, Document] = {}
        self.documents: list[Document] = []
        self._fingerprint_keys: set[tuple[str, str, str]] = set()
        self._index()

    def _index(self) -> None:
        html_paths: list[Path] = []
        for path in sorted(self.root.rglob("*")):
            if not path.is_file():
                continue
            relative = path.relative_to(self.root)
            exact = normalize_path("/" + relative.as_posix(), keep_trailing=False)
            self.resources.add(exact)
            key = fingerprint_key(exact)
            if key is not None:
                self._fingerprint_keys.add(key)
            if path.suffix.lower() == ".html":
                html_paths.append(path)
                public = normalize_path(public_url_for_file(relative))
                self.page_urls.add(public)
                self.resources.add(public)
                if public != "/":
                    self.resources.add(public.rstrip("/"))

        for path in html_paths:
            document = parse_document(path, self.root)
            self.documents.append(document)
            exact = normalize_path("/" + path.relative_to(self.root).as_posix(), keep_trailing=False)
            for route in {document.url, document.url.rstrip("/") or "/", exact}:
                self.route_to_document[normalize_path(route)] = document

    def contains(self, path: str) -> bool:
        normalized = normalize_path(path)
        return normalized in self.resources or normalized.rstrip("/") in self.resources

    def contains_refingerprinted(self, path: str) -> bool:
        """같은 디렉터리·stem·확장자에 해시만 다른 지문 파일이 있으면 True."""
        key = fingerprint_key(normalize_path(path, keep_trailing=False))
        return key is not None and key in self._fingerprint_keys

    def document_for(self, path: str) -> Document | None:
        normalized = normalize_path(path)
        return self.route_to_document.get(normalized) or self.route_to_document.get(normalized.rstrip("/"))

    def final_document(self, path: str) -> Document | None:
        document = self.document_for(path)
        seen: set[str] = set()
        while document and document.redirect and document.url not in seen:
            seen.add(document.url)
            resolved = resolve_local(document.redirect, document.url)
            if resolved is None:
                return None
            document = self.document_for(resolved.path)
        return document

    def broken_references(self) -> list[BrokenReference]:
        broken: list[BrokenReference] = []
        for document in self.documents:
            for reference in document.references:
                resolved = resolve_local(reference.raw, reference.source_url)
                if resolved is None:
                    continue
                if not self.contains(resolved.path):
                    broken.append(BrokenReference("missing-path", resolved.display, document.url, reference.line))
                    continue
                if resolved.fragment and not resolved.fragment.startswith(":~:text="):
                    target = self.final_document(resolved.path)
                    if target is not None and resolved.fragment not in target.ids:
                        broken.append(BrokenReference("missing-fragment", resolved.display, document.url, reference.line))
        return broken

    def valid_local_targets(self) -> set[str]:
        targets: set[str] = set()
        for document in self.documents:
            for reference in document.references:
                resolved = resolve_local(reference.raw, reference.source_url)
                if resolved and self.contains(resolved.path):
                    targets.add(resolved.path)
        return targets


def _find_nodes(root: Node, tag: str, required_class: str | None = None) -> list[Node]:
    nodes = list(root.descendants(tag))
    if required_class:
        nodes = [node for node in nodes if required_class in node.classes()]
    return nodes


def _is_descendant(node: Node, ancestor: Node) -> bool:
    return any(parent is ancestor for parent in node.ancestors())


def _nearest_ancestor(node: Node, tag: str) -> Node | None:
    return next((ancestor for ancestor in node.ancestors() if ancestor.tag == tag), None)


def _first_anchor_before_nested_list(li: Node) -> Node | None:
    pending = list(reversed(li.children))
    while pending:
        node = pending.pop()
        if node.tag == "ul":
            continue
        if node.tag == "a" and node.attrs.get("href"):
            return node
        pending.extend(reversed(node.children))
    return None


def _sidebar_lists(document: Document) -> dict[str, Node]:
    aside = _sidebar_aside(document)
    if aside is None:
        return {}
    result: dict[str, Node] = {}
    for ul in aside.descendants("ul"):
        classes = ul.classes()
        if "hx:md:hidden" in classes:
            result["mobile"] = ul
        if "hx:max-md:hidden" in classes:
            result["desktop"] = ul
    return result


def _sidebar_aside(document: Document) -> Node | None:
    asides = _find_nodes(document.root, "aside", "hextra-sidebar-container")
    return asides[0] if len(asides) == 1 else None


def validate_canonicals(site: SiteIndex) -> list[str]:
    errors: list[str] = []
    for document in site.documents:
        if document.url == "/404.html":
            continue
        if len(document.canonicals) != 1:
            errors.append(f"{document.url}: expected one canonical link, found {len(document.canonicals)}")
            continue
        canonical = urlsplit(document.canonicals[0])
        if canonical.scheme != "https" or (canonical.hostname or "").lower() != CANONICAL_HOST:
            errors.append(f"{document.url}: canonical is not on https://{CANONICAL_HOST}: {document.canonicals[0]}")
            continue
        canonical_path = normalize_path(canonical.path)
        if not site.contains(canonical_path):
            errors.append(f"{document.url}: canonical target is missing: {canonical_path}")
    return errors


def validate_root_navigation(site: SiteIndex) -> list[str]:
    errors: list[str] = []
    home = site.document_for("/")
    if home is None:
        return ["home page / is missing"]
    aside = _sidebar_aside(home)
    if aside is None:
        return ["/: sidebar is missing"]
    if aside.attrs.get("data-sidebar-excluded") != "false":
        errors.append("/: sidebar expected data-sidebar-excluded=false")
    lists = _sidebar_lists(home)
    for mode in ("mobile", "desktop"):
        root = lists.get(mode)
        if root is None:
            errors.append(f"/: {mode} root sidebar list is missing")
            continue
        direct_items = [child for child in root.children if child.tag == "li"]
        resolved_paths: list[str] = []
        for item in direct_items:
            anchor = _first_anchor_before_nested_list(item)
            if anchor:
                resolved = resolve_local(anchor.attrs["href"], "/")
                if resolved:
                    resolved_paths.append(normalize_path(resolved.path))
        section_paths = [path for path in resolved_paths if path not in UTILITY_NAVIGATION_PATHS]
        if sorted(section_paths) != sorted(ROOT_SECTIONS):
            errors.append(
                f"/: {mode} sidebar expected exactly four root sections "
                f"{', '.join(ROOT_SECTIONS)}; found {', '.join(section_paths) or 'none'}"
            )
    return errors


def _active_anchor_for(root: Node, page_url: str) -> Node | None:
    for anchor in root.descendants("a"):
        resolved = resolve_local(anchor.attrs.get("href", ""), page_url)
        if not resolved or normalize_path(resolved.path) != normalize_path(page_url):
            continue
        active_container = next(
            (
                ancestor
                for ancestor in anchor.ancestors()
                if ancestor.tag == "div"
                and "hextra-sidebar-item" in ancestor.classes()
                and ancestor.attrs.get("data-active") == "true"
            ),
            None,
        )
        if active_container and _is_descendant(active_container, root):
            return anchor
    return None


def _linked_paths(node: Node, source_url: str) -> list[str]:
    paths: list[str] = []
    for anchor in node.descendants("a"):
        resolved = resolve_local(anchor.attrs.get("href", ""), source_url)
        if resolved:
            paths.append(normalize_path(resolved.path))
    return paths


def _breadcrumb_paths(document: Document, *, required: bool) -> tuple[list[str], list[str]]:
    containers = [
        node
        for node in document.root.descendants()
        if node.attrs.get("data-page-breadcrumb") == "true"
    ]
    if len(containers) > 1:
        return [], [f"{document.url}: expected at most one breadcrumb, found {len(containers)}"]
    if not containers:
        errors = [f"{document.url}: breadcrumb is missing"] if required else []
        return [], errors
    paths = _linked_paths(containers[0], document.url)
    if required and not paths:
        return [], [f"{document.url}: breadcrumb has no parent links"]
    return paths, []


def _active_ancestor_paths(root: Node, active: Node, source_url: str) -> list[str]:
    active_li = _nearest_ancestor(active, "li")
    if active_li is None:
        return []
    chain = [active_li] + [node for node in active_li.ancestors() if node.tag == "li" and _is_descendant(node, root)]
    paths: list[str] = []
    for li in reversed(chain):
        anchor = _first_anchor_before_nested_list(li)
        resolved = resolve_local(anchor.attrs.get("href", ""), source_url) if anchor else None
        if resolved:
            paths.append(normalize_path(resolved.path))
    return paths


def _validate_excluded_breadcrumb_path(root: Node, breadcrumb_paths: list[str], url: str, mode: str) -> list[str]:
    errors: list[str] = []
    current_list = root
    for path in breadcrumb_paths:
        match: Node | None = None
        for li in (child for child in current_list.children if child.tag == "li"):
            anchor = _first_anchor_before_nested_list(li)
            resolved = resolve_local(anchor.attrs.get("href", ""), url) if anchor else None
            if resolved and normalize_path(resolved.path) == path:
                match = li
                break
        if match is None:
            errors.append(f"{url}: {mode} breadcrumb parent is absent from sidebar ancestry: {path}")
            return errors
        anchor = _first_anchor_before_nested_list(match)
        errors.extend(_validate_active_ancestry(root, anchor, url, mode))
        nested_lists = list(match.descendants("ul"))
        if path != breadcrumb_paths[-1]:
            if not nested_lists:
                errors.append(f"{url}: {mode} breadcrumb ancestry stops before: {path}")
                return errors
            current_list = nested_lists[0]
    return errors


def validate_pagers(site: SiteIndex) -> list[str]:
    errors: list[str] = []
    for document in site.documents:
        if document.redirect:
            continue
        aside = _sidebar_aside(document)
        if aside is None:
            continue
        current_parent = aside.attrs.get("data-page-parent")
        if current_parent is None:
            errors.append(f"{document.url}: sidebar is missing data-page-parent")
            continue
        pagers = [node for node in document.root.descendants() if node.attrs.get("data-page-pager") == "true"]
        if len(pagers) > 1:
            errors.append(f"{document.url}: expected at most one page pager, found {len(pagers)}")
            continue
        if not pagers:
            continue
        for anchor in pagers[0].descendants("a"):
            explicit = anchor.attrs.get("data-pager-explicit")
            if explicit not in {"true", "false"}:
                errors.append(f"{document.url}: pager link is missing data-pager-explicit=true|false")
                continue
            if explicit == "true":
                continue
            resolved = resolve_local(anchor.attrs.get("href", ""), document.url)
            target = site.final_document(resolved.path) if resolved else None
            target_aside = _sidebar_aside(target) if target else None
            target_parent = target_aside.attrs.get("data-page-parent") if target_aside else None
            if target_parent != current_parent:
                errors.append(
                    f"{document.url}: pager target is not a direct sibling: "
                    f"{resolved.path if resolved else anchor.attrs.get('href', '')}"
                )
    return errors


def _validate_active_ancestry(root: Node, active: Node, url: str, mode: str) -> list[str]:
    errors: list[str] = []
    active_li = _nearest_ancestor(active, "li")
    if active_li is None:
        return [f"{url}: {mode} active link is not inside a list item"]
    li_ancestors = [active_li] + [node for node in active_li.ancestors() if node.tag == "li"]
    for li in li_ancestors:
        if not _is_descendant(li, root) and li is not active_li:
            continue
        if "open" not in li.classes():
            errors.append(f"{url}: {mode} active ancestry contains a closed list item (line {li.line})")
        item_div = next(
            (child for child in li.children if child.tag == "div" and "hextra-sidebar-item" in child.classes()),
            None,
        )
        if item_div:
            buttons = [
                button
                for button in item_div.descendants("button")
                if "hextra-sidebar-collapsible-button" in button.classes()
            ]
            if buttons and any(button.attrs.get("aria-expanded") != "true" for button in buttons):
                errors.append(f"{url}: {mode} active ancestor is not aria-expanded (line {li.line})")
    return errors


def validate_sidebar_navigation(site: SiteIndex) -> list[str]:
    errors: list[str] = []
    for document in site.documents:
        if document.redirect or document.url in {"/", "/404.html"}:
            continue
        url = normalize_path(document.url)
        asides = _find_nodes(document.root, "aside", "hextra-sidebar-container")
        if len(asides) != 1:
            errors.append(f"{url}: expected exactly one sidebar, found {len(asides)}")
            continue
        aside = asides[0]
        excluded_value = aside.attrs.get("data-sidebar-excluded")
        if excluded_value not in {"true", "false"}:
            errors.append(f"{url}: sidebar is missing data-sidebar-excluded=true|false")
            continue
        excluded = excluded_value == "true"
        parent = aside.attrs.get("data-page-parent")
        if not parent:
            errors.append(f"{url}: sidebar is missing data-page-parent")
            continue
        parent = normalize_path(parent)
        breadcrumb_paths, breadcrumb_errors = _breadcrumb_paths(document, required=parent != "/")
        errors.extend(breadcrumb_errors)
        if breadcrumb_paths and breadcrumb_paths[-1] != parent:
            errors.append(f"{url}: breadcrumb does not end at direct parent {parent}")
        lists = _sidebar_lists(document)
        for mode in ("mobile", "desktop"):
            root = lists.get(mode)
            if root is None:
                errors.append(f"{url}: {mode} root sidebar list is missing")
                continue
            if excluded:
                if _active_anchor_for(root, url) is not None:
                    errors.append(f"{url}: {mode} excluded page unexpectedly appears as an active sidebar leaf")
                errors.extend(_validate_excluded_breadcrumb_path(root, breadcrumb_paths, url, mode))
                continue
            active = _active_anchor_for(root, url)
            if active is None:
                errors.append(f"{url}: {mode} sidebar has no active link for the page")
                continue
            errors.extend(_validate_active_ancestry(root, active, url, mode))
            ancestor_paths = _active_ancestor_paths(root, active, url)
            if ancestor_paths[:-1] != breadcrumb_paths:
                errors.append(
                    f"{url}: {mode} breadcrumb/sidebar ancestry mismatch; "
                    f"breadcrumb={breadcrumb_paths}, sidebar={ancestor_paths[:-1]}"
                )
    return errors


@dataclass
class MappingManifest:
    urls: set[str]
    baseline_urls: set[str]
    row_count: int
    errors: list[str]


def _parse_aliases(value: str, row_number: int) -> list[str]:
    if not value.strip():
        return []
    try:
        aliases = json.loads(value)
    except json.JSONDecodeError as error:
        raise ValueError(f"mapping row {row_number}: aliases must be a JSON array: {error.msg}") from error
    if not isinstance(aliases, list) or not all(isinstance(alias, str) for alias in aliases):
        raise ValueError(f"mapping row {row_number}: aliases must be a JSON array of strings")
    return aliases


def load_mapping(
    path: Path,
    source_dir: Path,
    expected_count: int | None,
) -> MappingManifest:
    if not path.is_file():
        raise ValueError(f"mapping file does not exist: {path}")
    urls: set[str] = set()
    baseline_urls: set[str] = set()
    errors: list[str] = []
    row_count = 0

    def add(value: object) -> None:
        values = value if isinstance(value, list) else [value]
        for item in values:
            if not isinstance(item, str) or not item.strip():
                continue
            split = urlsplit(item.strip())
            if split.hostname and split.hostname.lower() != CANONICAL_HOST:
                continue
            if item.strip().startswith("/") or split.hostname:
                urls.add(normalize_path(split.path))

    if path.suffix.lower() == ".json":
        payload = json.loads(path.read_text(encoding="utf-8-sig"))

        def visit(value: object) -> None:
            if isinstance(value, dict):
                for key, child in value.items():
                    if key.lower() in URL_FIELDS or key.lower() == "aliases":
                        add(child)
                    else:
                        visit(child)
            elif isinstance(value, list):
                for child in value:
                    visit(child)

        visit(payload)
        if isinstance(payload, list):
            row_count = len(payload)
    else:
        with path.open(encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            fieldnames = tuple(reader.fieldnames or ())
            is_source_ledger = any(name in SOURCE_LEDGER_COLUMNS for name in fieldnames)
            if is_source_ledger and fieldnames != SOURCE_LEDGER_COLUMNS:
                raise ValueError(
                    "source ledger columns must be exactly: " + ",".join(SOURCE_LEDGER_COLUMNS)
                )
            old_sources: set[str] = set()
            new_sources: set[str] = set()
            source_root = source_dir.resolve()
            for row_number, row in enumerate(reader, start=2):
                row_count += 1
                lowered = {key.lower(): value for key, value in row.items() if key}
                for field_name in URL_FIELDS:
                    add(lowered.get(field_name))
                if not is_source_ledger:
                    aliases = lowered.get("aliases")
                    if aliases:
                        for alias in _parse_aliases(aliases, row_number):
                            add(alias)
                    continue

                old_source = (row.get("old_source") or "").strip()
                new_source = (row.get("new_source") or "").strip()
                original_url = (row.get("original_url") or "").strip()
                aliases = _parse_aliases(row.get("aliases") or "", row_number)
                if not old_source or not new_source or not original_url:
                    errors.append(f"mapping row {row_number}: old_source, new_source, and original_url are required")
                if old_source in old_sources:
                    errors.append(f"mapping row {row_number}: duplicate old_source: {old_source}")
                old_sources.add(old_source)
                if new_source in new_sources:
                    errors.append(f"mapping row {row_number}: duplicate new_source: {new_source}")
                new_sources.add(new_source)
                candidate = (source_root / new_source).resolve()
                try:
                    candidate.relative_to(source_root)
                except ValueError:
                    errors.append(f"mapping row {row_number}: new_source escapes source directory: {new_source}")
                else:
                    if not candidate.is_file():
                        errors.append(f"mapping row {row_number}: new_source file is missing: {new_source}")
                add(original_url)
                baseline_urls.add(normalize_path(urlsplit(original_url).path))
                for alias in aliases:
                    add(alias)
                    baseline_urls.add(normalize_path(urlsplit(alias).path))
    if expected_count is not None and row_count != expected_count:
        errors.append(f"mapping row count mismatch: expected {expected_count}, found {row_count}")
    if not urls:
        raise ValueError(
            "mapping contains no recognized URL values; use original_url, old_url, url, "
            "permalink, new_url, or aliases"
        )
    return MappingManifest(urls, baseline_urls, row_count, errors)


def compare_baseline(
    site: SiteIndex,
    baseline: SiteIndex,
) -> tuple[list[str], Counter[tuple[str, str, str]]]:
    errors: list[str] = []
    for url in sorted(baseline.page_urls - {"/404.html"}):
        if not site.contains(url):
            errors.append(f"baseline page URL disappeared: {url}")
    for target in sorted(baseline.valid_local_targets()):
        # 지문 번들은 내용이 바뀌면 파일명 해시가 바뀐다. 새 HTML 이 새 해시를 참조하는지는
        # broken_references 가 따로 잡으므로, 해시만 다른 대응 파일이 있으면 살아남은 것으로 본다.
        if not site.contains(target) and not site.contains_refingerprinted(target):
            errors.append(f"baseline referenced page/asset disappeared: {target}")
    baseline_broken = Counter(item.comparison_key for item in baseline.broken_references())
    return errors, baseline_broken


def _print_group(title: str, items: Iterable[str], stream: object | None = None) -> int:
    values = list(items)
    if not values:
        return 0
    if stream is None:
        stream = sys.stdout
    print(f"\n{title} ({len(values)}):", file=stream)
    for value in values:
        print(f"  - {value}", file=stream)
    return len(values)


def run(
    site_dir: Path,
    baseline_dir: Path | None,
    mapping: Path | None,
    source_dir: Path | None = None,
    expected_mapping_count: int | None = None,
) -> int:
    try:
        site = SiteIndex(site_dir)
        baseline = SiteIndex(baseline_dir) if baseline_dir else None
    except (OSError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2

    failures: list[str] = []
    failures.extend(validate_canonicals(site))
    failures.extend(validate_root_navigation(site))
    failures.extend(validate_sidebar_navigation(site))
    failures.extend(validate_pagers(site))

    baseline_broken: Counter[tuple[str, str, str]] = Counter()
    if baseline:
        baseline_failures, baseline_broken = compare_baseline(site, baseline)
        failures.extend(baseline_failures)

    if mapping:
        try:
            manifest = load_mapping(mapping, source_dir or Path.cwd(), expected_mapping_count)
        except (OSError, ValueError, json.JSONDecodeError, csv.Error) as error:
            print(f"error: {error}", file=sys.stderr)
            return 2
        failures.extend(manifest.errors)
        for url in sorted(manifest.urls):
            if not site.contains(url):
                failures.append(f"mapped URL is missing: {url}")
        if baseline:
            for url in sorted(manifest.baseline_urls):
                if not baseline.contains(url):
                    failures.append(f"mapped URL was not present in baseline: {url}")
    elif expected_mapping_count is not None:
        print("error: --expected-mapping-count requires --mapping", file=sys.stderr)
        return 2

    current_broken = site.broken_references()
    introduced: list[BrokenReference] = []
    existing: list[BrokenReference] = []
    for broken in current_broken:
        if baseline and baseline_broken[broken.comparison_key] > 0:
            existing.append(broken)
            baseline_broken[broken.comparison_key] -= 1
        else:
            introduced.append(broken)
    failures.extend(
        f"{item.kind}: {item.target} (from {item.source_url}:{item.line})"
        for item in introduced
    )

    _print_group(
        "Existing broken references retained from baseline (reported, not failed)",
        (f"{item.kind}: {item.target} (from {item.source_url}:{item.line})" for item in existing),
    )
    _print_group("Validation failures", failures, stream=sys.stderr)
    print(
        f"\nChecked {len(site.documents)} HTML files and {len(site.resources)} generated routes/resources"
        + (f" against {len(baseline.documents)} baseline HTML files" if baseline else "")
        + "."
    )
    if failures:
        print(f"FAILED: {len(failures)} issue(s).", file=sys.stderr)
        return 1
    print("PASS: content URLs, local references, canonicals, and responsive sidebar state are valid.")
    return 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site-dir", type=Path, required=True, help="generated Hugo output to validate")
    parser.add_argument("--baseline-dir", type=Path, help="generated pre-migration Hugo output")
    parser.add_argument("--mapping", type=Path, help="optional JSON/CSV containing old/new public URLs")
    parser.add_argument(
        "--source-dir",
        type=Path,
        default=Path.cwd(),
        help="repository/source root used to resolve mapping new_source paths (default: cwd)",
    )
    parser.add_argument(
        "--expected-mapping-count",
        type=int,
        help="optional exact mapping row count, for example 219 for this migration ledger",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    return run(
        args.site_dir,
        args.baseline_dir,
        args.mapping,
        args.source_dir,
        args.expected_mapping_count,
    )


if __name__ == "__main__":
    raise SystemExit(main())
