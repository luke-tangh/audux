#!/usr/bin/env python3
"""Safely remove local branches whose GitHub pull requests were merged."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from dataclasses import dataclass
from typing import Sequence
from urllib.parse import urlparse


@dataclass(frozen=True)
class PullRequest:
    number: int
    head_ref: str
    head_oid: str
    merge_oid: str


class CommandError(RuntimeError):
    """Raised when a required command cannot be completed."""


def run(
    command: Sequence[str],
    *,
    check: bool = True,
    capture_output: bool = True,
) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            command,
            check=check,
            capture_output=capture_output,
            text=True,
        )
    except FileNotFoundError as exc:
        raise CommandError(f"required command not found: {command[0]}") from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or "").strip()
        suffix = f": {detail}" if detail else ""
        raise CommandError(f"command failed: {' '.join(command)}{suffix}") from exc


def git_output(*arguments: str) -> str:
    return run(("git", *arguments)).stdout.strip()


def verify_repository() -> None:
    if git_output("rev-parse", "--is-inside-work-tree") != "true":
        raise CommandError("run this script from inside a Git worktree")


def repository_from_remote_url(remote_url: str) -> str:
    if remote_url.startswith("git@github.com:"):
        repository = remote_url.removeprefix("git@github.com:")
    else:
        parsed = urlparse(remote_url)
        if parsed.hostname != "github.com":
            raise CommandError("the selected remote is not hosted on github.com")
        repository = parsed.path.lstrip("/")
    repository = repository.removesuffix(".git").rstrip("/")
    if repository.count("/") != 1:
        raise CommandError("could not determine OWNER/REPO from the remote URL")
    return repository


def resolve_repository(remote: str, repository: str | None) -> str:
    if repository:
        if repository.count("/") != 1:
            raise CommandError("--repo must use the OWNER/REPO form")
        return repository

    result = run(
        ("gh", "repo", "view", "--json", "nameWithOwner"),
    )
    try:
        name = json.loads(result.stdout)["nameWithOwner"]
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        raise CommandError("could not determine the GitHub repository") from exc
    if not isinstance(name, str) or name.count("/") != 1:
        raise CommandError("GitHub returned an invalid repository name")

    remote_url = git_output("remote", "get-url", remote)
    remote_repository = repository_from_remote_url(remote_url)
    if name.casefold() != remote_repository.casefold():
        raise CommandError(
            f"GitHub repository {name} does not match the {remote} remote"
        )
    return name


def checked_out_branches() -> set[str]:
    branches: set[str] = set()
    for line in git_output("worktree", "list", "--porcelain").splitlines():
        prefix = "branch refs/heads/"
        if line.startswith(prefix):
            branches.add(line[len(prefix) :])
    return branches


def gone_upstream_branches(remote: str) -> list[str]:
    result: list[str] = []
    output = git_output(
        "for-each-ref",
        "--format=%(refname:short)%00%(upstream:short)",
        "refs/heads",
    )
    for line in output.splitlines():
        branch, separator, upstream = line.partition("\0")
        if not separator or not upstream.startswith(f"{remote}/"):
            continue
        remote_ref = f"refs/remotes/{upstream}"
        exists = run(
            ("git", "show-ref", "--verify", "--quiet", remote_ref),
            check=False,
        ).returncode == 0
        if not exists:
            result.append(branch)
    return sorted(result)


def merged_pull_requests(repository: str, owner: str, base: str) -> list[PullRequest]:
    fields = ",".join(
        (
            "number",
            "headRefName",
            "headRefOid",
            "headRepositoryOwner",
            "baseRefName",
            "mergeCommit",
        )
    )
    result = run(
        (
            "gh",
            "pr",
            "list",
            "--repo",
            repository,
            "--state",
            "merged",
            "--base",
            base,
            "--limit",
            "1000",
            "--json",
            fields,
        )
    )
    try:
        records = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise CommandError("GitHub returned invalid pull-request data") from exc
    if not isinstance(records, list):
        raise CommandError("GitHub returned invalid pull-request data")

    pull_requests: list[PullRequest] = []
    for record in records:
        head_owner = record.get("headRepositoryOwner") or {}
        merge_commit = record.get("mergeCommit") or {}
        if (
            record.get("baseRefName") != base
            or head_owner.get("login", "").casefold() != owner.casefold()
            or not record.get("headRefOid")
            or not merge_commit.get("oid")
        ):
            continue
        pull_requests.append(
            PullRequest(
                number=int(record["number"]),
                head_ref=str(record["headRefName"]),
                head_oid=str(record["headRefOid"]),
                merge_oid=str(merge_commit["oid"]),
            )
        )
    return pull_requests


def merge_is_on_base(merge_oid: str, base_ref: str) -> bool:
    return run(
        ("git", "merge-base", "--is-ancestor", merge_oid, base_ref),
        check=False,
    ).returncode == 0


def find_deletable_branches(
    candidates: Sequence[str],
    pull_requests: Sequence[PullRequest],
    base_ref: str,
) -> tuple[list[tuple[str, int]], list[tuple[str, str]]]:
    by_branch: dict[str, list[PullRequest]] = {}
    for pull_request in pull_requests:
        by_branch.setdefault(pull_request.head_ref, []).append(pull_request)

    deletable: list[tuple[str, int]] = []
    skipped: list[tuple[str, str]] = []
    for branch in candidates:
        head_oid = git_output("rev-parse", f"refs/heads/{branch}")
        exact_matches = [
            pull_request
            for pull_request in by_branch.get(branch, [])
            if pull_request.head_oid == head_oid
        ]
        verified = next(
            (
                pull_request
                for pull_request in exact_matches
                if merge_is_on_base(pull_request.merge_oid, base_ref)
            ),
            None,
        )
        if verified:
            deletable.append((branch, verified.number))
        elif exact_matches:
            skipped.append((branch, f"merged PR is not present on {base_ref}"))
        else:
            skipped.append((branch, "no merged PR matches the local branch tip"))
    return deletable, skipped


def parse_args(arguments: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Preview or delete local branches whose upstreams are gone and whose "
            "exact GitHub PR heads were merged into the remote base branch."
        )
    )
    parser.add_argument(
        "--delete",
        action="store_true",
        help="delete verified branches (the default is a dry run)",
    )
    parser.add_argument("--remote", default="origin", help="Git remote to inspect")
    parser.add_argument("--base", default="main", help="PR base branch")
    parser.add_argument(
        "--repo",
        help="GitHub repository in OWNER/REPO form (normally detected with gh)",
    )
    parser.add_argument(
        "--no-fetch",
        action="store_true",
        help="skip git fetch --prune (intended for tests or an already-fetched repo)",
    )
    return parser.parse_args(arguments)


def main(arguments: Sequence[str] | None = None) -> int:
    args = parse_args(arguments if arguments is not None else sys.argv[1:])
    try:
        verify_repository()
        if not args.no_fetch:
            run(("git", "fetch", "--prune", args.remote), capture_output=False)

        base_ref = f"refs/remotes/{args.remote}/{args.base}"
        if run(
            ("git", "show-ref", "--verify", "--quiet", base_ref),
            check=False,
        ).returncode != 0:
            missing_base = f"{args.remote}/{args.base}"
            raise CommandError(f"remote base branch not found: {missing_base}")

        occupied = checked_out_branches()
        gone = gone_upstream_branches(args.remote)
        candidates = [
            branch for branch in gone if branch != args.base and branch not in occupied
        ]

        if not candidates:
            print("No eligible local branches with gone upstreams.")
            return 0

        if not shutil.which("gh"):
            raise CommandError("required command not found: gh")
        repository = resolve_repository(args.remote, args.repo)
        owner = repository.split("/", 1)[0]
        pull_requests = merged_pull_requests(repository, owner, args.base)
        deletable, skipped = find_deletable_branches(
            candidates,
            pull_requests,
            base_ref,
        )

        for branch, reason in skipped:
            print(f"SKIP   {branch}: {reason}")
        for branch, pull_request in deletable:
            action = "DELETE" if args.delete else "WOULD DELETE"
            print(f"{action} {branch} (PR #{pull_request})", flush=True)
            if args.delete:
                run(("git", "branch", "-D", "--", branch), capture_output=False)

        if deletable and not args.delete:
            print("Dry run only; rerun with --delete to remove verified branches.")
        elif not deletable:
            print("No local branches passed merged-PR verification.")
        return 0
    except CommandError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
