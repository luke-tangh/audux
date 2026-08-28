from collections.abc import Callable
from pathlib import Path

import pytest

from validate_release_context import (
    ReleaseContext,
    ReleaseContextError,
    main,
    validate_release_context,
)


def _repository(tmp_path: Path, version: str = "1.2.3") -> Path:
    (tmp_path / "VERSION").write_text(f"{version}\n", encoding="utf-8")
    for locale in ("en", "zh-CN"):
        notes = tmp_path / "docs" / locale / "releases" / f"v{version}.md"
        notes.parent.mkdir(parents=True, exist_ok=True)
        notes.write_text(f"# Audux v{version}\n", encoding="utf-8")
    return tmp_path


def _validate_push(
    repository: Path,
    *,
    ref: str = "refs/tags/v1.2.3",
    ref_name: str = "v1.2.3",
    is_ancestor: Callable[[str, str], bool] = lambda _commit, _main_ref: True,
) -> ReleaseContext:
    return validate_release_context(
        repository_root=repository,
        event_name="push",
        ref=ref,
        ref_name=ref_name,
        sha="release-commit",
        signed_preflight=False,
        is_ancestor=is_ancestor,
    )


@pytest.mark.parametrize("version", ["1.0.0", "1.2.3", "1.123.456"])
def test_accepts_strict_stable_v1_versions(tmp_path: Path, version: str) -> None:
    repository = _repository(tmp_path, version)

    context = _validate_push(
        repository,
        ref=f"refs/tags/v{version}",
        ref_name=f"v{version}",
    )

    assert context.mode == "signed"
    assert context.version == version


@pytest.mark.parametrize(
    "version",
    ["0.9.9", "2.0.0", "1.2", "1.2.3-beta.1", "1.02.3", "1.2.03", "v1.2.3"],
)
def test_rejects_versions_outside_strict_stable_v1(tmp_path: Path, version: str) -> None:
    repository = _repository(tmp_path, version)

    with pytest.raises(ReleaseContextError, match="stable v1.x version"):
        _validate_push(repository)


def test_rejects_tag_that_does_not_exactly_match_version(tmp_path: Path) -> None:
    repository = _repository(tmp_path)

    with pytest.raises(ReleaseContextError, match="must be exactly v1.2.3"):
        _validate_push(repository, ref="refs/tags/v1.2.4", ref_name="v1.2.4")


def test_rejects_release_commit_outside_main(tmp_path: Path) -> None:
    repository = _repository(tmp_path)

    with pytest.raises(ReleaseContextError, match="not an ancestor"):
        _validate_push(repository, is_ancestor=lambda _commit, _main_ref: False)


@pytest.mark.parametrize("locale", ["en", "zh-CN"])
def test_requires_both_localized_release_notes(tmp_path: Path, locale: str) -> None:
    repository = _repository(tmp_path)
    (repository / "docs" / locale / "releases" / "v1.2.3.md").unlink()

    with pytest.raises(ReleaseContextError, match=f"missing {locale} release notes"):
        _validate_push(repository)


def test_signed_preflight_requires_main(tmp_path: Path) -> None:
    repository = _repository(tmp_path)

    context = validate_release_context(
        repository_root=repository,
        event_name="workflow_dispatch",
        ref="refs/heads/main",
        ref_name="main",
        sha="main-commit",
        signed_preflight=True,
    )
    assert context.mode == "signed"

    with pytest.raises(ReleaseContextError, match="must run from refs/heads/main"):
        validate_release_context(
            repository_root=repository,
            event_name="workflow_dispatch",
            ref="refs/heads/topic",
            ref_name="topic",
            sha="topic-commit",
            signed_preflight=True,
        )


def test_unsigned_preflight_can_run_from_topic_branch(tmp_path: Path) -> None:
    repository = _repository(tmp_path)

    context = validate_release_context(
        repository_root=repository,
        event_name="workflow_dispatch",
        ref="refs/heads/topic",
        ref_name="topic",
        sha="topic-commit",
        signed_preflight=False,
    )

    assert context.mode == "unsigned"


def test_cli_appends_github_outputs(tmp_path: Path) -> None:
    repository = _repository(tmp_path)
    output = tmp_path / "github-output"

    result = main(
        [
            "--repository-root",
            str(repository),
            "--event-name",
            "workflow_dispatch",
            "--ref",
            "refs/heads/topic",
            "--ref-name",
            "topic",
            "--sha",
            "topic-commit",
            "--signed-preflight",
            "false",
            "--github-output",
            str(output),
        ]
    )

    assert result == 0
    assert output.read_text(encoding="utf-8") == "mode=unsigned\nversion=1.2.3\n"
