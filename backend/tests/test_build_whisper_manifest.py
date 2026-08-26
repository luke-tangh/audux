import json
from pathlib import Path

import pytest

from build_whisper_manifest import build_manifest


def _write_descriptor(root: Path, target: str, *, asset_name: str | None = None) -> None:
    descriptor = {
        "target": target,
        "asset_name": asset_name or f"audux-whisper-{target}.zip",
        "archive_sha256": f"archive-{target}",
        "archive_size": 123,
        "executable_name": "audux-whisper.exe" if "windows" in target else "audux-whisper",
        "executable_sha256": f"executable-{target}",
        "executable_size": 456,
    }
    path = root / f"audux-{target}" / f"whisper-component-{target}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(descriptor), encoding="utf-8")


def test_build_whisper_manifest_collects_uploaded_platform_descriptors(tmp_path: Path):
    _write_descriptor(tmp_path, "x86_64-unknown-linux-gnu")
    _write_descriptor(tmp_path, "aarch64-apple-darwin")

    manifest = build_manifest(tmp_path, "1.0.0")

    assert manifest["schema_version"] == 1
    assert manifest["app_version"] == "1.0.0"
    assert set(manifest["components"]) == {
        "x86_64-unknown-linux-gnu",
        "aarch64-apple-darwin",
    }
    assert manifest["components"]["aarch64-apple-darwin"]["archive_size"] == 123


def test_build_whisper_manifest_rejects_missing_and_duplicate_descriptors(tmp_path: Path):
    with pytest.raises(ValueError, match="No Whisper component descriptors found"):
        build_manifest(tmp_path, "1.0.0")

    target = "x86_64-pc-windows-msvc"
    _write_descriptor(tmp_path / "first", target)
    _write_descriptor(tmp_path / "second", target, asset_name="duplicate.zip")

    with pytest.raises(ValueError, match="Duplicate Whisper component target"):
        build_manifest(tmp_path, "1.0.0")


def test_release_workflow_uploads_component_descriptors() -> None:
    repository_root = Path(__file__).resolve().parents[2]
    workflow = (repository_root / ".github" / "workflows" / "release.yml").read_text(
        encoding="utf-8"
    )

    assert "backend/dist/whisper-components/whisper-component-*.json" in workflow
    assert 'notes_path="docs/releases/${GITHUB_REF_NAME}.md"' in workflow
    assert "body_path: ${{ steps.release-notes.outputs.path }}" in workflow
    assert "needs: [backend-release-tests, frontend-release-tests, tauri-release-tests]" in workflow
    assert "AUDUX_WHISPER_MANIFEST_PUBLIC_KEY" in workflow
    assert "AUDUX_WHISPER_MANIFEST_PRIVATE_KEY" in workflow
    assert "backend/sign_whisper_manifest.py" in workflow
    assert "release-artifacts/whisper-components.json.sig" in workflow
    assert "permissions:\n      contents: write" in workflow
    assert "uses: actions/checkout@v" not in workflow
