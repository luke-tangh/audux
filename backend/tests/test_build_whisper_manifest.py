import hashlib
import json
import zipfile
from pathlib import Path

import pytest

from build_whisper_manifest import build_manifest
from release_artifacts import EXPECTED_TARGETS


def _write_descriptor(root: Path, target: str, *, asset_name: str | None = None) -> None:
    executable_name = "audux-whisper.exe" if "windows" in target else "audux-whisper"
    executable = f"executable-{target}".encode()
    archive_name = asset_name or f"audux-whisper-{target}.zip"
    path = root / f"audux-{target}" / f"whisper-component-{target}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    archive = path.parent / archive_name
    with zipfile.ZipFile(archive, "w") as bundle:
        bundle.writestr(executable_name, executable)
        bundle.writestr("LICENSE", "license")
        bundle.writestr("THIRD_PARTY_NOTICES.txt", "notices")
    descriptor = {
        "target": target,
        "asset_name": archive_name,
        "archive_sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
        "archive_size": archive.stat().st_size,
        "executable_name": executable_name,
        "executable_sha256": hashlib.sha256(executable).hexdigest(),
        "executable_size": len(executable),
    }
    path.write_text(json.dumps(descriptor), encoding="utf-8")


def test_build_whisper_manifest_collects_uploaded_platform_descriptors(tmp_path: Path):
    for target in EXPECTED_TARGETS:
        _write_descriptor(tmp_path, target)

    manifest = build_manifest(tmp_path, "1.0.0")

    assert manifest["schema_version"] == 1
    assert manifest["app_version"] == "1.0.0"
    assert set(manifest["components"]) == EXPECTED_TARGETS
    assert manifest["components"]["aarch64-apple-darwin"]["archive_size"] > 0


def test_build_whisper_manifest_rejects_missing_and_duplicate_descriptors(tmp_path: Path):
    with pytest.raises(ValueError, match="target set is incomplete"):
        build_manifest(tmp_path, "1.0.0")

    for target in EXPECTED_TARGETS:
        _write_descriptor(tmp_path, target)
    target = "x86_64-pc-windows-msvc"
    _write_descriptor(tmp_path / "second", target)

    with pytest.raises(ValueError, match="Duplicate Whisper component target"):
        build_manifest(tmp_path, "1.0.0")


def test_release_workflow_uploads_component_descriptors() -> None:
    repository_root = Path(__file__).resolve().parents[2]
    workflow = (repository_root / ".github" / "workflows" / "release.yml").read_text(
        encoding="utf-8"
    )

    assert "backend/release_artifacts.py stage" in workflow
    assert 'notes_path="docs/releases/${GITHUB_REF_NAME}.md"' in workflow
    assert "body_path: ${{ steps.release-notes.outputs.path }}" in workflow
    assert "needs: [quality-gates, release-context]" in workflow
    assert "AUDUX_WHISPER_MANIFEST_PUBLIC_KEY" in workflow
    assert "AUDUX_WHISPER_MANIFEST_PRIVATE_KEY" in workflow
    assert "backend/sign_whisper_manifest.py" in workflow
    assert "release-metadata/whisper-components.json" in workflow
    assert "backend/release_artifacts.py assemble" in workflow
    assert "signed_preflight:" in workflow
    assert "draft: true" in workflow
    assert "fail_on_unmatched_files: true" in workflow
    assert "uses: ./.github/workflows/quality-gates.yml" in workflow
    assert "permissions:\n      contents: write" in workflow
    assert "uses: actions/checkout@v" not in workflow
