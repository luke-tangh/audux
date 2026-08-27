from pathlib import Path

import pytest

from build_update_manifest import build_manifest


def _write_artifact(root: Path, relative_path: str) -> None:
    artifact = root / relative_path
    artifact.parent.mkdir(parents=True, exist_ok=True)
    artifact.write_bytes(b"updater")
    artifact.with_name(f"{artifact.name}.sig").write_text(
        f"signature-for-{artifact.name}",
        encoding="utf-8",
    )


def test_build_update_manifest_uses_signed_platform_artifacts(tmp_path: Path):
    _write_artifact(tmp_path, "audux-linux-x64/Audux_1.0.1_amd64.AppImage")
    _write_artifact(tmp_path, "audux-windows-x64/Audux_1.0.1_x64-setup.exe")
    _write_artifact(tmp_path, "audux-macos-arm64/Audux_arm64.app.tar.gz")

    manifest = build_manifest(
        tmp_path,
        version="1.0.1",
        repository="luke-tangh/audux",
        tag="v1.0.1",
        notes="安全更新",
    )

    assert manifest["version"] == "1.0.1"
    assert manifest["notes"] == "安全更新"
    assert set(manifest["platforms"]) == {
        "linux-x86_64",
        "windows-x86_64",
        "darwin-aarch64",
    }
    assert manifest["platforms"]["windows-x86_64"]["url"].endswith(
        "/Audux_1.0.1_x64-setup.exe"
    )
    assert manifest["platforms"]["darwin-aarch64"]["signature"] == (
        "signature-for-Audux_arm64.app.tar.gz"
    )


def test_build_update_manifest_rejects_missing_signature(tmp_path: Path):
    artifact = tmp_path / "audux-linux-x64" / "Audux_1.0.1_amd64.AppImage"
    artifact.parent.mkdir(parents=True)
    artifact.write_bytes(b"unsigned")

    with pytest.raises(ValueError, match="Missing updater signature"):
        build_manifest(
            tmp_path,
            version="1.0.1",
            repository="luke-tangh/audux",
            tag="v1.0.1",
            notes="",
        )
