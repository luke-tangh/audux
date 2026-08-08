import json
import tomllib
from pathlib import Path

from app.version import APP_VERSION


class TestVersionConsistency:
    def test_release_version_is_consistent_across_layers(self):
        repository_root = Path(__file__).resolve().parents[2]
        expected = (repository_root / "VERSION").read_text(encoding="utf-8").strip()

        with (repository_root / "pyproject.toml").open("rb") as file:
            python_version = tomllib.load(file)["project"]["version"]

        with (repository_root / "frontend" / "package.json").open(
            encoding="utf-8"
        ) as file:
            frontend_version = json.load(file)["version"]

        with (
            repository_root / "frontend" / "src-tauri" / "Cargo.toml"
        ).open("rb") as file:
            rust_version = tomllib.load(file)["package"]["version"]

        with (
            repository_root / "frontend" / "src-tauri" / "tauri.conf.json"
        ).open(encoding="utf-8") as file:
            desktop_version = json.load(file)["version"]

        assert {
            python_version,
            frontend_version,
            rust_version,
            desktop_version,
            APP_VERSION,
        } == {expected}

    def test_prerelease_version_does_not_enable_windows_msi(self):
        repository_root = Path(__file__).resolve().parents[2]
        expected = (repository_root / "VERSION").read_text(encoding="utf-8").strip()

        if "-" not in expected:
            return

        with (
            repository_root
            / "frontend"
            / "src-tauri"
            / "tauri.windows.conf.json"
        ).open(encoding="utf-8") as file:
            windows_targets = json.load(file)["bundle"]["targets"]

        assert windows_targets != "all"
        assert "msi" not in windows_targets
