import re
from pathlib import Path
from urllib.parse import unquote, urlsplit


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DOCS_ROOT = REPOSITORY_ROOT / "docs"
ZH_CN_ROOT = DOCS_ROOT / "zh-CN"
MARKDOWN_LINK = re.compile(r"\[[^\]]+\]\(([^)]+)\)")


def _project_markdown_files() -> list[Path]:
    return [REPOSITORY_ROOT / "README.md", *sorted(DOCS_ROOT.rglob("*.md"))]


def test_chinese_documentation_has_reader_oriented_sections() -> None:
    expected_sections = {
        "user-guide",
        "reference",
        "contributing",
        "project",
        "releases",
        "history",
    }

    assert (DOCS_ROOT / "README.md").is_file()
    assert (ZH_CN_ROOT / "README.md").is_file()
    assert expected_sections == {
        path.name for path in ZH_CN_ROOT.iterdir() if path.is_dir()
    }
    for section in expected_sections:
        assert (ZH_CN_ROOT / section / "README.md").is_file()


def test_legacy_chinese_document_paths_are_empty() -> None:
    legacy_paths = {
        "building.md",
        "compatibility.md",
        "configuration.md",
        "data-and-security.md",
        "development.md",
        "getting-started.md",
        "release-checklist.md",
        "releases",
        "roadmap.md",
        "security-advisories.md",
        "troubleshooting.md",
    }

    assert not legacy_paths.intersection(path.name for path in DOCS_ROOT.iterdir())
    assert not (REPOSITORY_ROOT / "PRD.md").exists()


def test_chinese_content_pages_link_back_to_language_index() -> None:
    content_pages = [
        path for path in ZH_CN_ROOT.rglob("*.md") if path.name != "README.md"
    ]

    assert content_pages
    for document in content_pages:
        assert "[中文文档首页]" in document.read_text(encoding="utf-8")


def test_project_markdown_relative_links_resolve() -> None:
    broken_links: list[str] = []

    for document in _project_markdown_files():
        for raw_target in MARKDOWN_LINK.findall(document.read_text(encoding="utf-8")):
            target = raw_target.strip().strip("<>")
            parsed = urlsplit(target)
            if parsed.scheme or not parsed.path:
                continue
            resolved = (document.parent / unquote(parsed.path)).resolve()
            if not resolved.exists():
                broken_links.append(
                    f"{document.relative_to(REPOSITORY_ROOT)} -> {target}"
                )

    assert broken_links == []
