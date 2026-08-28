from __future__ import annotations

import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from scripts import clean_local_branches


SCRIPT = Path(__file__).with_name("clean_local_branches.py")


class BranchCleanupTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.root = Path(self.temporary_directory.name)
        self.remote = self.root / "remote.git"
        self.repository = self.root / "repository"
        self.bin_directory = self.root / "bin"
        self.bin_directory.mkdir()
        self.git(
            "init",
            "--bare",
            "--initial-branch=main",
            str(self.remote),
            cwd=self.root,
        )
        self.git(
            "init",
            "--initial-branch=main",
            str(self.repository),
            cwd=self.root,
        )
        self.git("config", "user.name", "Branch Test")
        self.git("config", "user.email", "branch-test@example.invalid")
        self.git("remote", "add", "origin", str(self.remote))
        (self.repository / "README.md").write_text("base\n", encoding="utf-8")
        self.git("add", "README.md")
        self.git("commit", "-m", "base")
        self.git("push", "-u", "origin", "main")

    def git(self, *arguments: str, cwd: Path | None = None) -> str:
        result = subprocess.run(
            ("git", *arguments),
            cwd=cwd or self.repository,
            check=True,
            capture_output=True,
            text=True,
        )
        return result.stdout.strip()

    def create_merged_topic(self, branch: str = "topic") -> tuple[str, str]:
        self.git("switch", "-c", branch)
        (self.repository / "topic.txt").write_text(f"{branch}\n", encoding="utf-8")
        self.git("add", "topic.txt")
        self.git("commit", "-m", branch)
        head_oid = self.git("rev-parse", "HEAD")
        self.git("push", "-u", "origin", branch)
        self.git("switch", "main")
        self.git("merge", "--squash", branch)
        self.git("commit", "-m", f"merge {branch}")
        merge_oid = self.git("rev-parse", "HEAD")
        self.git("push", "origin", "main")
        self.git("push", "origin", "--delete", branch)
        self.git("fetch", "--prune", "origin")
        return head_oid, merge_oid

    def install_fake_gh(self, pull_requests: list[dict[str, object]]) -> None:
        executable = self.bin_directory / "gh"
        payload = json.dumps(pull_requests)
        executable.write_text(
            "#!/usr/bin/env python3\n"
            f"print({payload!r})\n",
            encoding="utf-8",
        )
        executable.chmod(executable.stat().st_mode | stat.S_IXUSR)

    def record(
        self,
        branch: str,
        head_oid: str,
        merge_oid: str,
        number: int = 1,
    ) -> dict[str, object]:
        return {
            "number": number,
            "headRefName": branch,
            "headRefOid": head_oid,
            "headRepositoryOwner": {"login": "owner"},
            "baseRefName": "main",
            "mergeCommit": {"oid": merge_oid},
        }

    def run_cleanup(self, *arguments: str) -> subprocess.CompletedProcess[str]:
        environment = os.environ.copy()
        environment["PATH"] = f"{self.bin_directory}{os.pathsep}{environment['PATH']}"
        return subprocess.run(
            (
                sys.executable,
                str(SCRIPT),
                "--no-fetch",
                "--repo",
                "owner/repository",
                *arguments,
            ),
            cwd=self.repository,
            env=environment,
            check=False,
            capture_output=True,
            text=True,
        )

    def branch_exists(self, branch: str) -> bool:
        result = subprocess.run(
            ("git", "show-ref", "--verify", "--quiet", f"refs/heads/{branch}"),
            cwd=self.repository,
            check=False,
        )
        return result.returncode == 0

    def test_dry_run_preserves_verified_squash_branch(self) -> None:
        head_oid, merge_oid = self.create_merged_topic()
        self.install_fake_gh([self.record("topic", head_oid, merge_oid)])

        result = self.run_cleanup()

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("WOULD DELETE topic (PR #1)", result.stdout)
        self.assertTrue(self.branch_exists("topic"))

    def test_delete_removes_verified_squash_branch(self) -> None:
        head_oid, merge_oid = self.create_merged_topic()
        self.install_fake_gh([self.record("topic", head_oid, merge_oid)])

        result = self.run_cleanup("--delete")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("DELETE topic (PR #1)", result.stdout)
        self.assertFalse(self.branch_exists("topic"))

    def test_mismatched_pr_head_is_not_deleted(self) -> None:
        _, merge_oid = self.create_merged_topic()
        self.install_fake_gh([self.record("topic", "0" * 40, merge_oid)])

        result = self.run_cleanup("--delete")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("no merged PR matches the local branch tip", result.stdout)
        self.assertTrue(self.branch_exists("topic"))

    def test_merge_commit_missing_from_remote_base_is_not_deleted(self) -> None:
        head_oid, _ = self.create_merged_topic()
        self.install_fake_gh([self.record("topic", head_oid, head_oid)])

        result = self.run_cleanup("--delete")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(
            "merged PR is not present on refs/remotes/origin/main",
            result.stdout,
        )
        self.assertTrue(self.branch_exists("topic"))

    def test_branch_checked_out_in_another_worktree_is_not_eligible(self) -> None:
        head_oid, merge_oid = self.create_merged_topic()
        self.install_fake_gh([self.record("topic", head_oid, merge_oid)])
        worktree = self.root / "topic-worktree"
        self.git("worktree", "add", str(worktree), "topic")
        self.addCleanup(
            lambda: self.git("worktree", "remove", "--force", str(worktree))
        )

        result = self.run_cleanup("--delete")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("No eligible local branches", result.stdout)
        self.assertTrue(self.branch_exists("topic"))


class RemoteUrlTest(unittest.TestCase):
    def test_https_remote(self) -> None:
        self.assertEqual(
            clean_local_branches.repository_from_remote_url(
                "https://github.com/owner/repository.git"
            ),
            "owner/repository",
        )

    def test_scp_style_ssh_remote(self) -> None:
        self.assertEqual(
            clean_local_branches.repository_from_remote_url(
                "git@github.com:owner/repository.git"
            ),
            "owner/repository",
        )

    def test_non_github_remote_is_rejected(self) -> None:
        with self.assertRaises(clean_local_branches.CommandError):
            clean_local_branches.repository_from_remote_url(
                "https://example.com/owner/repository.git"
            )


if __name__ == "__main__":
    unittest.main()
