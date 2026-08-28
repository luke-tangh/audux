import re
from pathlib import Path
from urllib.parse import unquote, urlsplit


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DOCS_ROOT = REPOSITORY_ROOT / "docs"
EN_ROOT = DOCS_ROOT / "en"
ZH_CN_ROOT = DOCS_ROOT / "zh-CN"
LOCALIZED_ROOTS = {"en": EN_ROOT, "zh-CN": ZH_CN_ROOT}
MARKDOWN_LINK = re.compile(r"\[[^\]]+\]\(([^)]+)\)")


def _project_markdown_files() -> list[Path]:
    return [REPOSITORY_ROOT / "README.md", *sorted(DOCS_ROOT.rglob("*.md"))]


def test_localized_documentation_has_matching_reader_oriented_sections() -> None:
    expected_sections = {
        "user-guide",
        "reference",
        "contributing",
        "project",
        "releases",
        "history",
    }

    assert (DOCS_ROOT / "README.md").is_file()
    for localized_root in LOCALIZED_ROOTS.values():
        assert (localized_root / "README.md").is_file()
        assert expected_sections == {
            path.name for path in localized_root.iterdir() if path.is_dir()
        }
        for section in expected_sections:
            assert (localized_root / section / "README.md").is_file()

    english_files = {
        path.relative_to(EN_ROOT) for path in EN_ROOT.rglob("*.md")
    }
    chinese_files = {
        path.relative_to(ZH_CN_ROOT) for path in ZH_CN_ROOT.rglob("*.md")
    }
    assert english_files == chinese_files


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


def test_localized_pages_link_to_their_index_and_counterpart() -> None:
    for locale, localized_root in LOCALIZED_ROOTS.items():
        documents = list(localized_root.rglob("*.md"))
        assert documents
        for document in documents:
            text = document.read_text(encoding="utf-8")
            if locale == "en":
                assert "[简体中文]" in text
                if document.name != "README.md":
                    assert "[English documentation home]" in text
            else:
                assert "[English]" in text
                if document.name != "README.md":
                    assert "[中文文档首页]" in text


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
