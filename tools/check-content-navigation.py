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
import sys
import unicodedata
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
    def comparison_key(self) -> tuple[str, str]:
        return self.kind, self.target


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
        self._index()

    def _index(self) -> None:
        html_paths: list[Path] = []
        for path in sorted(self.root.rglob("*")):
            if not path.is_file():
                continue
            relative = path.relative_to(self.root)
            exact = normalize_path("/" + relative.as_posix(), keep_trailing=False)
            self.resources.add(exact)
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
    asides = _find_nodes(document.root, "aside", "hextra-sidebar-container")
    if len(asides) != 1:
        return {}
    result: dict[str, Node] = {}
    for ul in asides[0].descendants("ul"):
        classes = ul.classes()
        if "hx:md:hidden" in classes:
            result["mobile"] = ul
        if "hx:max-md:hidden" in classes:
            result["desktop"] = ul
    return result


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


def validate_deep_navigation(site: SiteIndex) -> list[str]:
    errors: list[str] = []
    for document in site.documents:
        if document.redirect:
            continue
        url = normalize_path(document.url)
        root_section = next((root for root in ROOT_SECTIONS if url.startswith(root)), None)
        if root_section is None or len([part for part in url.split("/") if part]) < 3:
            continue
        lists = _sidebar_lists(document)
        for mode in ("mobile", "desktop"):
            root = lists.get(mode)
            if root is None:
                errors.append(f"{url}: {mode} root sidebar list is missing")
                continue
            active = _active_anchor_for(root, url)
            if active is None:
                errors.append(f"{url}: {mode} sidebar has no active link for the page")
                continue
            active_li = _nearest_ancestor(active, "li")
            if active_li is None:
                errors.append(f"{url}: {mode} active link is not inside a list item")
                continue
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
                    buttons = [button for button in item_div.descendants("button") if "hextra-sidebar-collapsible-button" in button.classes()]
                    if buttons and any(button.attrs.get("aria-expanded") != "true" for button in buttons):
                        errors.append(f"{url}: {mode} active ancestor is not aria-expanded (line {li.line})")
    return errors


def load_mapping_urls(path: Path) -> set[str]:
    if not path.is_file():
        raise ValueError(f"mapping file does not exist: {path}")
    urls: set[str] = set()

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
    else:
        with path.open(encoding="utf-8-sig", newline="") as handle:
            for row in csv.DictReader(handle):
                lowered = {key.lower(): value for key, value in row.items() if key}
                for field_name in URL_FIELDS:
                    add(lowered.get(field_name))
                aliases = lowered.get("aliases")
                if aliases:
                    for alias in aliases.replace(";", ",").split(","):
                        add(alias.strip())
    if not urls:
        raise ValueError(
            "mapping contains no recognized URL values; use original_url, old_url, url, "
            "permalink, new_url, or aliases"
        )
    return urls


def compare_baseline(site: SiteIndex, baseline: SiteIndex) -> tuple[list[str], set[tuple[str, str]]]:
    errors: list[str] = []
    for url in sorted(baseline.page_urls - {"/404.html"}):
        if not site.contains(url):
            errors.append(f"baseline page URL disappeared: {url}")
    for target in sorted(baseline.valid_local_targets()):
        if not site.contains(target):
            errors.append(f"baseline referenced page/asset disappeared: {target}")
    baseline_broken = {item.comparison_key for item in baseline.broken_references()}
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


def run(site_dir: Path, baseline_dir: Path | None, mapping: Path | None) -> int:
    try:
        site = SiteIndex(site_dir)
        baseline = SiteIndex(baseline_dir) if baseline_dir else None
    except (OSError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2

    failures: list[str] = []
    failures.extend(validate_canonicals(site))
    failures.extend(validate_root_navigation(site))
    failures.extend(validate_deep_navigation(site))

    baseline_broken: set[tuple[str, str]] = set()
    if baseline:
        baseline_failures, baseline_broken = compare_baseline(site, baseline)
        failures.extend(baseline_failures)

    if mapping:
        try:
            mapping_urls = load_mapping_urls(mapping)
        except (OSError, ValueError, json.JSONDecodeError, csv.Error) as error:
            print(f"error: {error}", file=sys.stderr)
            return 2
        for url in sorted(mapping_urls):
            if not site.contains(url):
                failures.append(f"mapped URL is missing: {url}")

    current_broken = site.broken_references()
    introduced: list[BrokenReference] = []
    existing: list[BrokenReference] = []
    for broken in current_broken:
        if baseline and broken.comparison_key in baseline_broken:
            existing.append(broken)
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
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    return run(args.site_dir, args.baseline_dir, args.mapping)


if __name__ == "__main__":
    raise SystemExit(main())
