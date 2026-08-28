from __future__ import annotations

import argparse
import re
import subprocess
import sys
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path


V1_VERSION_PATTERN = re.compile(r"^1\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")


class ReleaseContextError(ValueError):
    pass


@dataclass(frozen=True)
class ReleaseContext:
    mode: str
    version: str


def _read_version(version_file: Path) -> str:
    version = version_file.read_text(encoding="utf-8").strip()
    if not V1_VERSION_PATTERN.fullmatch(version):
        raise ReleaseContextError(
            "VERSION must be a stable v1.x version in MAJOR.MINOR.PATCH form "
            "without leading zeroes"
        )
    return version


def _git_is_ancestor(commit: str, main_ref: str) -> bool:
    result = subprocess.run(
        ["git", "merge-base", "--is-ancestor", commit, main_ref],
        check=False,
    )
    if result.returncode not in {0, 1}:
        raise ReleaseContextError(
            f"git could not compare release commit {commit} with {main_ref}"
        )
    return result.returncode == 0


def validate_release_context(
    *,
    repository_root: Path,
    event_name: str,
    ref: str,
    ref_name: str,
    sha: str,
    signed_preflight: bool,
    main_ref: str = "origin/main",
    is_ancestor: Callable[[str, str], bool] = _git_is_ancestor,
) -> ReleaseContext:
    version = _read_version(repository_root / "VERSION")

    if event_name == "push":
        expected_tag = f"v{version}"
        if ref != f"refs/tags/{expected_tag}" or ref_name != expected_tag:
            raise ReleaseContextError(
                f"release tag must be exactly {expected_tag} and match VERSION"
            )
        if not sha or not is_ancestor(sha, main_ref):
            raise ReleaseContextError(
                f"release commit {sha or '<empty>'} is not an ancestor of {main_ref}"
            )
        for locale in ("en", "zh-CN"):
            notes_path = (
                repository_root
                / "docs"
                / locale
                / "releases"
                / f"{expected_tag}.md"
            )
            if not notes_path.is_file():
                relative_notes_path = notes_path.relative_to(repository_root)
                raise ReleaseContextError(
                    f"missing {locale} release notes: {relative_notes_path}"
                )
        return ReleaseContext(mode="signed", version=version)

    if event_name != "workflow_dispatch":
        raise ReleaseContextError(f"unsupported release event: {event_name}")
    if signed_preflight and ref != "refs/heads/main":
        raise ReleaseContextError("signed preflight must run from refs/heads/main")
    return ReleaseContext(
        mode="signed" if signed_preflight else "unsigned",
        version=version,
    )


def _parse_bool(value: str) -> bool:
    normalized = value.strip().lower()
    if normalized in {"", "false"}:
        return False
    if normalized == "true":
        return True
    raise argparse.ArgumentTypeError("expected true or false")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository-root", type=Path, required=True)
    parser.add_argument("--event-name", required=True)
    parser.add_argument("--ref", required=True)
    parser.add_argument("--ref-name", required=True)
    parser.add_argument("--sha", default="")
    parser.add_argument("--signed-preflight", type=_parse_bool, default=False)
    parser.add_argument("--main-ref", default="origin/main")
    parser.add_argument("--github-output", type=Path)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        context = validate_release_context(
            repository_root=args.repository_root.resolve(),
            event_name=args.event_name,
            ref=args.ref,
            ref_name=args.ref_name,
            sha=args.sha,
            signed_preflight=args.signed_preflight,
            main_ref=args.main_ref,
        )
    except (OSError, ReleaseContextError) as exc:
        print(f"::error::{exc}", file=sys.stderr)
        return 1

    output = f"mode={context.mode}\nversion={context.version}\n"
    if args.github_output is None:
        print(output, end="")
    else:
        with args.github_output.open("a", encoding="utf-8") as output_file:
            output_file.write(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
