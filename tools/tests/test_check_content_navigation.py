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


def root_list(css_class: str, *, active_url: str | None = None) -> str:
    items = []
    for root in ROOTS:
        if active_url and active_url.startswith(root):
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
        else:
            items.append(f'<li><div class="hextra-sidebar-item" data-active="false"><a href="{root}">section</a></div></li>')
    return f'<ul class="{css_class}">{"".join(items)}</ul>'


def page_html(url: str, body: str = "", *, active: bool = False) -> str:
    active_url = url if active else None
    sidebar = (
        '<aside class="hextra-sidebar-container">'
        + root_list("hx:md:hidden", active_url=active_url)
        + root_list("hx:max-md:hidden", active_url=active_url)
        + "</aside>"
    )
    return f"<!doctype html><html><head>{canonical(url)}</head><body>{sidebar}{body}</body></html>"


def make_valid_site(root: Path, *, broken: str | None = None) -> None:
    write_url(root, "/", page_html("/"))
    for section in ROOTS:
        write_url(root, section, page_html(section))
    deep = "/observability/metrics/소개/"
    body = (
        '<h2 id="제목">제목</h2>'
        '<a href="#%EC%A0%9C%EB%AA%A9">fragment</a>'
        '<img src="/assets/%ED%95%9C%20%EA%B8%80.png?version=1">'
        '<a href="https://example.com/not-local">external</a>'
    )
    if broken:
        body += f'<a href="{broken}">known broken</a>'
    write_url(root, deep, page_html(deep, body, active=True))
    asset = root / "assets" / "한 글.png"
    asset.parent.mkdir(parents=True, exist_ok=True)
    asset.write_bytes(b"png")


class NavigationCheckerIntegrationTests(unittest.TestCase):
    def run_checker(self, site: Path, baseline: Path | None = None, mapping: Path | None = None):
        stdout = io.StringIO()
        stderr = io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            result = checker.run(site, baseline, mapping)
        return result, stdout.getvalue(), stderr.getvalue()

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


if __name__ == "__main__":
    unittest.main()
