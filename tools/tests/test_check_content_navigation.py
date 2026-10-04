from __future__ import annotations

import importlib.util
import io
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "check-content-navigation.py"
SPEC = importlib.util.spec_from_file_location("check_content_navigation", SCRIPT)
assert SPEC and SPEC.loader
checker = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = checker
SPEC.loader.exec_module(checker)


ROOTS = ("/platform/", "/observability/", "/data/", "/engineering/")


def write_url(root: Path, url: str, content: str) -> None:
    if url == "/":
        path = root / "index.html"
    elif url.endswith("/"):
        path = root / url.lstrip("/") / "index.html"
    else:
        path = root / url.lstrip("/")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def canonical(url: str) -> str:
    return f'<link rel="canonical" href="https://docs.makgol.com{url}">'


def redirect_html(target: str) -> str:
    return (
        f'<!doctype html>{canonical(target)}'
        f'<meta http-equiv="refresh" content="0; url=https://docs.makgol.com{target}">'
    )


def root_list(
    css_class: str,
    *,
    active_url: str | None = None,
    expanded_root: str | None = None,
) -> str:
    items = []
    for root in ROOTS:
        if active_url == root:
            items.append(
                '<li class="open"><div class="hextra-sidebar-item" data-active="true">'
                f'<a href="{root}">section</a></div></li>'
            )
        elif active_url and root == expanded_root:
            active = (
                '<li class="open">'
                '<div class="hextra-sidebar-item" data-active="false">'
                f'<a href="{root}">section</a>'
                '<button class="hextra-sidebar-collapsible-button" aria-expanded="true"></button>'
                '</div><div class="hextra-sidebar-children"><ul>'
                '<li class="open"><div class="hextra-sidebar-item" data-active="true">'
                f'<a href="{active_url}">active</a></div></li>'
                '</ul></div></li>'
            )
            items.append(active)
        elif root == expanded_root:
            items.append(
                '<li class="open"><div class="hextra-sidebar-item" data-active="false">'
                f'<a href="{root}">section</a>'
                '<button class="hextra-sidebar-collapsible-button" aria-expanded="true"></button>'
                '</div><div class="hextra-sidebar-children"><ul><li>parent content</li></ul></div></li>'
            )
        else:
            items.append(f'<li><div class="hextra-sidebar-item" data-active="false"><a href="{root}">section</a></div></li>')
    return f'<ul class="{css_class}">{"".join(items)}</ul>'


def page_html(
    url: str,
    body: str = "",
    *,
    active: bool = False,
    excluded: bool = False,
    expanded_root: str | None = None,
    breadcrumb_paths: tuple[str, ...] = (),
    parent_url: str = "/",
    pager_links: tuple[tuple[str, bool], ...] = (),
) -> str:
    active_url = url if active else None
    if active and expanded_root is None:
        expanded_root = next((root for root in ROOTS if url.startswith(root)), ROOTS[0])
    sidebar = (
        f'<aside class="hextra-sidebar-container" data-sidebar-excluded="{str(excluded).lower()}" '
        f'data-page-parent="{parent_url}">'
        + root_list("hx:md:hidden", active_url=active_url, expanded_root=expanded_root)
        + root_list("hx:max-md:hidden", active_url=active_url, expanded_root=expanded_root)
        + "</aside>"
    )
    breadcrumb = ""
    if breadcrumb_paths:
        breadcrumb = '<div data-page-breadcrumb="true">' + "".join(
            f'<a href="{path}">parent</a>' for path in breadcrumb_paths
        ) + "</div>"
    pager = ""
    if pager_links:
        pager = '<div data-page-pager="true">' + "".join(
            f'<a href="{path}" data-pager-explicit="{str(explicit).lower()}">sibling</a>'
            for path, explicit in pager_links
        ) + "</div>"
    return f"<!doctype html><html><head>{canonical(url)}</head><body>{sidebar}{breadcrumb}{body}{pager}</body></html>"


def make_valid_site(root: Path, *, broken: str | None = None) -> None:
    write_url(root, "/", page_html("/"))
    for section in ROOTS:
        write_url(root, section, page_html(section, active=True, expanded_root=section))
    deep = "/observability/metrics/소개/"
    body = (
        '<h2 id="제목">제목</h2>'
        '<a href="#%EC%A0%9C%EB%AA%A9">fragment</a>'
        '<img src="/assets/%ED%95%9C%20%EA%B8%80.png?version=1">'
        '<a href="https://example.com/not-local">external</a>'
    )
    if broken:
        body += f'<a href="{broken}">known broken</a>'
    write_url(
        root,
        deep,
        page_html(
            deep,
            body,
            active=True,
            breadcrumb_paths=("/observability/",),
            parent_url="/observability/",
        ),
    )
    asset = root / "assets" / "한 글.png"
    asset.parent.mkdir(parents=True, exist_ok=True)
    asset.write_bytes(b"png")


class NavigationCheckerIntegrationTests(unittest.TestCase):
    def run_checker(
        self,
        site: Path,
        baseline: Path | None = None,
        mapping: Path | None = None,
        source_dir: Path | None = None,
        expected_mapping_count: int | None = None,
    ):
        stdout = io.StringIO()
        stderr = io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            result = checker.run(site, baseline, mapping, source_dir, expected_mapping_count)
        return result, stdout.getvalue(), stderr.getvalue()

    def test_missing_breadcrumb_fails_for_visible_and_excluded_legacy_pages(self) -> None:
        for excluded in (False, True):
            with self.subTest(excluded=excluded), tempfile.TemporaryDirectory() as directory:
                site = Path(directory)
                make_valid_site(site)
                legacy = "/ai-tools/legacy/"
                valid = page_html(
                    legacy, active=not excluded, excluded=excluded,
                    expanded_root="/engineering/", parent_url="/engineering/",
                    breadcrumb_paths=("/engineering/",),
                )
                write_url(site, legacy, valid)
                result, _, stderr = self.run_checker(site)
                self.assertEqual(0, result, stderr)
                breadcrumb = '<div data-page-breadcrumb="true"><a href="/engineering/">parent</a></div>'
                write_url(site, legacy, valid.replace(breadcrumb, ""))
                result, _, stderr = self.run_checker(site)
                self.assertEqual(1, result)
                self.assertIn("breadcrumb is missing", stderr)

    def test_breadcrumb_must_end_at_declared_direct_parent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            site = Path(directory)
            make_valid_site(site)
            path = site / "observability" / "metrics" / "소개" / "index.html"
            path.write_text(path.read_text().replace(
                'data-page-parent="/observability/"', 'data-page-parent="/platform/"'
            ))
            result, _, stderr = self.run_checker(site)
        self.assertEqual(1, result)
        self.assertIn("breadcrumb does not end at direct parent", stderr)

    def test_valid_utf8_fragment_assets_and_responsive_navigation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            site = Path(directory)
            make_valid_site(site)
            result, stdout, stderr = self.run_checker(site)
        self.assertEqual(0, result, stderr)
        self.assertIn("PASS", stdout)

    def test_baseline_known_breakage_is_reported_but_new_breakage_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory)
            baseline = workspace / "before"
            site = workspace / "after"
            make_valid_site(baseline, broken="/already-missing/")
            make_valid_site(site, broken="/already-missing/")

            result, stdout, stderr = self.run_checker(site, baseline)
            self.assertEqual(0, result, stderr)
            self.assertIn("Existing broken references retained", stdout)

            deep_file = site / "observability" / "metrics" / "소개" / "index.html"
            deep_file.write_text(
                deep_file.read_text(encoding="utf-8").replace("</body>", '<a href="/newly-missing/">new</a></body>'),
                encoding="utf-8",
            )
            result, _, stderr = self.run_checker(site, baseline)
            self.assertEqual(1, result)
            self.assertIn("/newly-missing/", stderr)

    def test_baseline_breakage_does_not_mask_same_target_from_another_page_or_extra_occurrence(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory)
            baseline = workspace / "before"
            site = workspace / "after"
            make_valid_site(baseline)
            make_valid_site(site)
            baseline_page = baseline / "observability" / "metrics" / "소개" / "index.html"
            baseline_page.write_text(
                baseline_page.read_text(encoding="utf-8").replace(
                    "</body>", '<a href="/same-missing/">old</a></body>'
                ),
                encoding="utf-8",
            )
            current_page = site / "observability" / "metrics" / "소개" / "index.html"
            current_page.write_text(
                current_page.read_text(encoding="utf-8").replace(
                    "</body>",
                    '<a href="/same-missing/">old</a><a href="/same-missing/">duplicate</a></body>',
                ),
                encoding="utf-8",
            )
            platform_page = site / "platform" / "index.html"
            platform_page.write_text(
                platform_page.read_text(encoding="utf-8").replace(
                    "</body>", '<a href="/same-missing/">different source</a></body>'
                ),
                encoding="utf-8",
            )

            result, stdout, stderr = self.run_checker(site, baseline)
        self.assertEqual(1, result)
        self.assertEqual(1, stdout.count("/same-missing/"))
        self.assertEqual(2, stderr.count("/same-missing/"))
        self.assertIn("from /platform/", stderr)

    def test_baseline_page_and_referenced_asset_must_survive(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory)
            baseline = workspace / "before"
            site = workspace / "after"
            make_valid_site(baseline)
            make_valid_site(site)
            write_url(
                baseline,
                "/old-route/",
                f'<!doctype html><link rel="canonical" href="https://docs.makgol.com/old-route/">'
                '<img src="/assets/retired.png">',
            )
            (baseline / "assets" / "retired.png").write_bytes(b"old")

            result, _, stderr = self.run_checker(site, baseline)
        self.assertEqual(1, result)
        self.assertIn("baseline page URL disappeared: /old-route/", stderr)
        self.assertIn("baseline referenced page/asset disappeared: /assets/retired.png", stderr)

    def test_mapping_requires_recognized_urls_and_checks_alias(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            site = Path(directory) / "site"
            make_valid_site(site)
            mapping = Path(directory) / "mapping.csv"
            mapping.write_text("source_path,old_url\ncontent/a.md,/legacy/\n", encoding="utf-8")
            result, _, stderr = self.run_checker(site, mapping=mapping)
            self.assertEqual(1, result)
            self.assertIn("mapped URL is missing: /legacy/", stderr)

            unrecognized = Path(directory) / "paths.csv"
            unrecognized.write_text("source_path,new_source_path\na,b\n", encoding="utf-8")
            result, _, stderr = self.run_checker(site, mapping=unrecognized)
            self.assertEqual(2, result)
            self.assertIn("no recognized URL values", stderr)

    def test_closed_mobile_ancestor_is_detected_independently(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            site = Path(directory)
            make_valid_site(site)
            deep_file = site / "observability" / "metrics" / "소개" / "index.html"
            html = deep_file.read_text(encoding="utf-8")
            mobile_start = html.index('<ul class="hx:md:hidden">')
            open_index = html.index('<li class="open">', mobile_start)
            html = html[:open_index] + '<li class="">' + html[open_index + len('<li class="open">'):]
            deep_file.write_text(html, encoding="utf-8")

            result, _, stderr = self.run_checker(site)
        self.assertEqual(1, result)
        self.assertIn("mobile active ancestry contains a closed list item", stderr)

    def test_legacy_public_url_is_checked_for_active_sidebar_state(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            site = Path(directory)
            make_valid_site(site)
            legacy_url = "/istio/routing/article/"
            write_url(
                site,
                legacy_url,
                page_html(legacy_url, active=True, expanded_root="/platform/", parent_url="/platform/", breadcrumb_paths=("/platform/",)),
            )
            result, _, stderr = self.run_checker(site)
            self.assertEqual(0, result, stderr)

            legacy_file = site / "istio" / "routing" / "article" / "index.html"
            legacy_file.write_text(
                legacy_file.read_text(encoding="utf-8").replace('data-active="true"', 'data-active="false"'),
                encoding="utf-8",
            )
            result, _, stderr = self.run_checker(site)
        self.assertEqual(1, result)
        self.assertIn("/istio/routing/article/: mobile sidebar has no active link", stderr)
        self.assertIn("/istio/routing/article/: desktop sidebar has no active link", stderr)

    def test_normal_page_requires_exactly_one_sidebar(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            site = Path(directory)
            make_valid_site(site)
            legacy_url = "/monitoring/legacy/"
            write_url(site, legacy_url, page_html(legacy_url, active=True, expanded_root="/observability/", parent_url="/observability/", breadcrumb_paths=("/observability/",)))
            legacy_file = site / "monitoring" / "legacy" / "index.html"
            html = legacy_file.read_text(encoding="utf-8")
            aside_start = html.index("<aside")
            aside_end = html.index("</aside>", aside_start) + len("</aside>")
            aside = html[aside_start:aside_end]

            legacy_file.write_text(html.replace(aside, ""), encoding="utf-8")
            result, _, missing_stderr = self.run_checker(site)
            legacy_file.write_text(html.replace(aside, aside + aside), encoding="utf-8")
            result_duplicate, _, duplicate_stderr = self.run_checker(site)
        self.assertEqual(1, result)
        self.assertIn("expected exactly one sidebar, found 0", missing_stderr)
        self.assertEqual(1, result_duplicate)
        self.assertIn("expected exactly one sidebar, found 2", duplicate_stderr)

    def test_non_explicit_pager_targets_must_share_direct_parent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            site = Path(directory)
            make_valid_site(site)
            first = "/istio/sibling-a/"
            second = "/istio/sibling-b/"
            write_url(
                site,
                first,
                page_html(
                    first,
                    active=True,
                    expanded_root="/platform/",
                    parent_url="/platform/",
                    breadcrumb_paths=("/platform/",),
                    pager_links=((second, False),),
                ),
            )
            write_url(
                site,
                second,
                page_html(second, active=True, expanded_root="/platform/", parent_url="/platform/", breadcrumb_paths=("/platform/",)),
            )
            result, _, stderr = self.run_checker(site)
            self.assertEqual(0, result, stderr)

            second_file = site / "istio" / "sibling-b" / "index.html"
            second_file.write_text(
                page_html(second, active=True, expanded_root="/data/", parent_url="/data/", breadcrumb_paths=("/data/",)),
                encoding="utf-8",
            )
            result, _, stderr = self.run_checker(site)
        self.assertEqual(1, result)
        self.assertIn("pager target is not a direct sibling: /istio/sibling-b/", stderr)

    def test_excluded_legacy_leaf_requires_expanded_parent_but_no_active_leaf(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            site = Path(directory)
            make_valid_site(site)
            transcript_url = "/ai-tools/legacy-transcript/"
            write_url(
                site,
                transcript_url,
                page_html(
                    transcript_url,
                    excluded=True,
                    expanded_root="/engineering/",
                    parent_url="/engineering/",
                    breadcrumb_paths=("/engineering/",),
                ),
            )
            result, _, stderr = self.run_checker(site)
            self.assertEqual(0, result, stderr)

            transcript_file = site / "ai-tools" / "legacy-transcript" / "index.html"
            transcript_file.write_text(
                page_html(
                    transcript_url,
                    excluded=True,
                    expanded_root="/platform/",
                    parent_url="/engineering/",
                    breadcrumb_paths=("/engineering/",),
                ),
                encoding="utf-8",
            )
            result, _, stderr = self.run_checker(site)
        self.assertEqual(1, result)
        self.assertIn("active ancestry contains a closed list item", stderr)

    def test_source_ledger_validates_json_aliases_duplicates_files_and_count(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory)
            site = workspace / "site"
            source = workspace / "repo"
            make_valid_site(site)
            (source / "content").mkdir(parents=True)
            (source / "content" / "one.md").write_text("one", encoding="utf-8")
            write_url(site, "/legacy-one/", redirect_html("/observability/metrics/소개/"))
            write_url(site, "/legacy-two/", redirect_html("/observability/metrics/소개/"))
            ledger = workspace / "mapping.csv"
            ledger.write_text(
                'old_source,new_source,original_url,aliases\n'
                'content/old.md,content/one.md,/observability/metrics/소개/,'
                '"[""/legacy-one/"", ""/legacy-two/""]"\n',
                encoding="utf-8",
            )
            result, _, stderr = self.run_checker(
                site,
                mapping=ledger,
                source_dir=source,
                expected_mapping_count=1,
            )
            self.assertEqual(0, result, stderr)

            baseline = workspace / "baseline"
            make_valid_site(baseline)
            result, _, stderr = self.run_checker(
                site,
                baseline=baseline,
                mapping=ledger,
                source_dir=source,
                expected_mapping_count=1,
            )
            self.assertEqual(1, result)
            self.assertIn("mapped URL was not present in baseline: /legacy-one/", stderr)
            self.assertIn("mapped URL was not present in baseline: /legacy-two/", stderr)

            ledger.write_text(
                'old_source,new_source,original_url,aliases\n'
                'content/old.md,content/missing.md,/observability/metrics/소개/,[]\n'
                'content/old.md,content/missing.md,/observability/metrics/소개/,[]\n',
                encoding="utf-8",
            )
            result, _, stderr = self.run_checker(
                site,
                mapping=ledger,
                source_dir=source,
                expected_mapping_count=1,
            )
        self.assertEqual(1, result)
        self.assertIn("duplicate old_source", stderr)
        self.assertIn("duplicate new_source", stderr)
        self.assertIn("new_source file is missing", stderr)
        self.assertIn("mapping row count mismatch", stderr)


if __name__ == "__main__":
    unittest.main()
