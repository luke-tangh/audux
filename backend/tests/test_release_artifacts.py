import hashlib
import json
import zipfile
from pathlib import Path

import pytest

from release_artifacts import (
    CHECKSUMS_NAME,
    PLATFORMS,
    assemble_release,
    stage_platform,
    validate_whisper_descriptor,
    verify_checksums,
)


def _write_zip(path: Path, files: dict[str, bytes]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w") as bundle:
        for name, content in files.items():
            bundle.writestr(name, content)


def _write_platform_files(root: Path, platform: str, *, signed: bool) -> None:
    spec = PLATFORMS[platform]
    bundle_root = root / "frontend/src-tauri/target/release/bundle"
    bundle_root.mkdir(parents=True, exist_ok=True)
    bundle_names = {
        "linux-x64": ("Audux.AppImage", "Audux.deb", "Audux.rpm"),
        "windows-x64": ("Audux_1.0.0_x64-setup.exe",),
        "macos-x64": ("Audux_1.0.0_x64.dmg",),
        "macos-arm64": ("Audux_1.0.0_aarch64.dmg",),
    }[platform]
    for name in bundle_names:
        (bundle_root / name).write_bytes(name.encode())

    if signed:
        updater_name = {
            "linux-x64": "Audux.AppImage",
            "windows-x64": "Audux_1.0.0_x64-setup.exe",
            "macos-x64": "Audux_1.0.0_x64.app.tar.gz",
            "macos-arm64": "Audux_1.0.0_arm64.app.tar.gz",
        }[platform]
        updater = bundle_root / updater_name
        if not updater.exists():
            updater.write_bytes(b"updater")
        updater.with_name(f"{updater.name}.sig").write_text("signature", encoding="utf-8")

    browser = root / f"backend/dist/browser-lite/audux-lite-{spec.target}.zip"
    _write_zip(
        browser,
        {
            f"audux-lite{spec.executable_suffix}": b"browser-lite",
            "LICENSE": b"license",
            "THIRD_PARTY_NOTICES.txt": b"notices",
        },
    )

    executable_name = f"audux-whisper{spec.executable_suffix}"
    executable = b"whisper"
    whisper = root / f"backend/dist/whisper-components/audux-whisper-{spec.target}.zip"
    _write_zip(
        whisper,
        {
            executable_name: executable,
            "LICENSE": b"license",
            "THIRD_PARTY_NOTICES.txt": b"notices",
        },
    )
    descriptor = {
        "target": spec.target,
        "asset_name": whisper.name,
        "archive_sha256": hashlib.sha256(whisper.read_bytes()).hexdigest(),
        "archive_size": whisper.stat().st_size,
        "executable_name": executable_name,
        "executable_sha256": hashlib.sha256(executable).hexdigest(),
        "executable_size": len(executable),
    }
    descriptor_path = whisper.parent / f"whisper-component-{spec.target}.json"
    descriptor_path.write_text(json.dumps(descriptor), encoding="utf-8")


def test_stage_platform_requires_and_validates_signed_assets(tmp_path: Path):
    _write_platform_files(tmp_path, "windows-x64", signed=True)
    output = tmp_path / "stage"

    staged = stage_platform(
        "windows-x64",
        output,
        signed=True,
        repository_root=tmp_path,
    )

    names = {path.name for path in staged}
    assert "Audux_1.0.0_x64-setup.exe" in names
    assert "Audux_1.0.0_x64-setup.exe.sig" in names
    assert "audux-lite-x86_64-pc-windows-msvc.zip" in names
    assert "audux-whisper-x86_64-pc-windows-msvc.zip" in names
    assert "whisper-component-x86_64-pc-windows-msvc.json" in names


def test_whisper_descriptor_rejects_modified_archive(tmp_path: Path):
    _write_platform_files(tmp_path, "linux-x64", signed=False)
    descriptor = next(
        (tmp_path / "backend/dist/whisper-components").glob("whisper-component-*.json")
    )
    archive = descriptor.parent / json.loads(descriptor.read_text())["asset_name"]
    archive.write_bytes(b"modified")

    with pytest.raises(ValueError, match="size mismatch"):
        validate_whisper_descriptor(descriptor)


def test_assemble_release_enforces_complete_set_and_checksums(tmp_path: Path):
    downloaded = tmp_path / "downloaded"
    for platform in PLATFORMS:
        platform_root = tmp_path / f"source-{platform}"
        _write_platform_files(platform_root, platform, signed=True)
        stage_platform(
            platform,
            downloaded / f"audux-{platform}",
            signed=True,
            repository_root=platform_root,
        )

    metadata = tmp_path / "metadata"
    metadata.mkdir()
    output_names = {
        path.name
        for directory in downloaded.iterdir()
        for path in directory.iterdir()
        if not path.name.startswith("whisper-component-")
    }
    updater_assets = {
        "linux-x86_64": "Audux.AppImage",
        "windows-x86_64": "Audux_1.0.0_x64-setup.exe",
        "darwin-x86_64": "Audux_1.0.0_x64.app.tar.gz",
        "darwin-aarch64": "Audux_1.0.0_arm64.app.tar.gz",
    }
    (metadata / "latest.json").write_text(
        json.dumps(
            {
                "version": "1.0.0",
                "platforms": {
                    target: {
                        "url": f"https://example.test/{asset}",
                        "signature": "signature",
                    }
                    for target, asset in updater_assets.items()
                },
            }
        ),
        encoding="utf-8",
    )
    (metadata / "whisper-components.json").write_text(
        json.dumps(
            {
                "app_version": "1.0.0",
                "components": {
                    spec.target: {
                        "asset_name": f"audux-whisper-{spec.target}.zip",
                    }
                    for spec in PLATFORMS.values()
                },
            }
        ),
        encoding="utf-8",
    )
    (metadata / "whisper-components.json.sig").write_text("signature", encoding="utf-8")

    output = tmp_path / "release"
    assembled = assemble_release(
        downloaded,
        metadata,
        output,
        version="1.0.0",
    )

    assert CHECKSUMS_NAME in {path.name for path in assembled}
    assert output_names <= {path.name for path in assembled}
    verify_checksums(output)

    next(path for path in output.iterdir() if path.name != CHECKSUMS_NAME).write_bytes(b"tampered")
    with pytest.raises(ValueError, match="checksum mismatch"):
        verify_checksums(output)
