"""Validate, stage, assemble, and verify Audux release artifacts."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import zipfile
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urlparse


REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
TAURI_BUNDLE_ROOT = REPOSITORY_ROOT / "frontend" / "src-tauri" / "target" / "release" / "bundle"
BROWSER_LITE_ROOT = REPOSITORY_ROOT / "backend" / "dist" / "browser-lite"
WHISPER_ROOT = REPOSITORY_ROOT / "backend" / "dist" / "whisper-components"
CHECKSUMS_NAME = "SHA256SUMS"
METADATA_NAMES = {
    "latest.json",
    "whisper-components.json",
    "whisper-components.json.sig",
}


@dataclass(frozen=True)
class PlatformSpec:
    name: str
    target: str
    bundle_patterns: tuple[str, ...]
    updater_pattern: str
    executable_suffix: str = ""


PLATFORMS = {
    spec.name: spec
    for spec in (
        PlatformSpec(
            "linux-x64",
            "x86_64-unknown-linux-gnu",
            ("*.AppImage", "*.deb", "*.rpm"),
            "*.AppImage",
        ),
        PlatformSpec(
            "windows-x64",
            "x86_64-pc-windows-msvc",
            ("*-setup.exe",),
            "*-setup.exe",
            ".exe",
        ),
        PlatformSpec(
            "macos-x64",
            "x86_64-apple-darwin",
            ("*.dmg",),
            "*.app.tar.gz",
        ),
        PlatformSpec(
            "macos-arm64",
            "aarch64-apple-darwin",
            ("*.dmg",),
            "*.app.tar.gz",
        ),
    )
}
EXPECTED_TARGETS = {spec.target for spec in PLATFORMS.values()}


def _sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _single_file(root: Path, pattern: str, label: str) -> Path:
    matches = sorted(path for path in root.rglob(pattern) if path.is_file())
    if len(matches) != 1:
        raise ValueError(f"Expected exactly one {label}, found {len(matches)}")
    if matches[0].stat().st_size <= 0:
        raise ValueError(f"Release artifact is empty: {matches[0].name}")
    return matches[0]


def _require_signature(artifact: Path) -> Path:
    signature = artifact.with_name(f"{artifact.name}.sig")
    if not signature.is_file() or not signature.read_text(encoding="utf-8").strip():
        raise ValueError(f"Missing or empty updater signature: {signature.name}")
    return signature


def _validate_zip_members(archive: Path, expected: set[str]) -> dict[str, bytes]:
    with zipfile.ZipFile(archive) as bundle:
        members = {info.filename for info in bundle.infolist() if not info.is_dir()}
        if members != expected:
            raise ValueError(
                f"Unexpected members in {archive.name}: expected {sorted(expected)}, "
                f"found {sorted(members)}"
            )
        content = {name: bundle.read(name) for name in expected}
    empty = sorted(name for name, value in content.items() if not value)
    if empty:
        raise ValueError(f"Empty files in {archive.name}: {empty}")
    return content


def validate_browser_lite_archive(archive: Path, spec: PlatformSpec) -> None:
    expected_name = f"audux-lite-{spec.target}.zip"
    if archive.name != expected_name:
        raise ValueError(f"Unexpected browser-lite archive name: {archive.name}")
    _validate_zip_members(
        archive,
        {
            f"audux-lite{spec.executable_suffix}",
            "LICENSE",
            "THIRD_PARTY_NOTICES.txt",
        },
    )


def validate_whisper_descriptor(descriptor_path: Path) -> dict:
    descriptor = json.loads(descriptor_path.read_text(encoding="utf-8"))
    required = {
        "target",
        "asset_name",
        "archive_sha256",
        "archive_size",
        "executable_name",
        "executable_sha256",
        "executable_size",
    }
    if not isinstance(descriptor, dict) or set(descriptor) != required:
        raise ValueError(f"Invalid Whisper descriptor fields: {descriptor_path.name}")

    target = descriptor["target"]
    matching_specs = [spec for spec in PLATFORMS.values() if spec.target == target]
    if len(matching_specs) != 1:
        raise ValueError(f"Unexpected Whisper target: {target}")
    spec = matching_specs[0]
    expected_asset_name = f"audux-whisper-{target}.zip"
    expected_executable = f"audux-whisper{spec.executable_suffix}"
    if descriptor["asset_name"] != expected_asset_name:
        raise ValueError(f"Unexpected Whisper asset name for {target}")
    if descriptor["executable_name"] != expected_executable:
        raise ValueError(f"Unexpected Whisper executable name for {target}")

    archive = descriptor_path.parent / expected_asset_name
    if not archive.is_file():
        raise ValueError(f"Whisper archive not found: {expected_asset_name}")
    if descriptor["archive_size"] != archive.stat().st_size:
        raise ValueError(f"Whisper archive size mismatch: {expected_asset_name}")
    if descriptor["archive_sha256"] != _sha256_file(archive):
        raise ValueError(f"Whisper archive hash mismatch: {expected_asset_name}")

    content = _validate_zip_members(
        archive,
        {expected_executable, "LICENSE", "THIRD_PARTY_NOTICES.txt"},
    )
    executable = content[expected_executable]
    if descriptor["executable_size"] != len(executable):
        raise ValueError(f"Whisper executable size mismatch: {expected_executable}")
    if descriptor["executable_sha256"] != _sha256_bytes(executable):
        raise ValueError(f"Whisper executable hash mismatch: {expected_executable}")
    return descriptor


def _copy_unique(source: Path, output_dir: Path, copied: dict[str, Path]) -> None:
    previous = copied.get(source.name)
    if previous is not None:
        raise ValueError(
            f"Duplicate public release asset name {source.name}: {previous} and {source}"
        )
    destination = output_dir / source.name
    shutil.copy2(source, destination)
    copied[source.name] = source


def _prepare_empty_directory(path: Path) -> None:
    if path.exists() and any(path.iterdir()):
        raise ValueError(f"Output directory must be empty: {path}")
    path.mkdir(parents=True, exist_ok=True)


def stage_platform(
    platform: str,
    output_dir: Path,
    *,
    signed: bool,
    repository_root: Path = REPOSITORY_ROOT,
) -> list[Path]:
    try:
        spec = PLATFORMS[platform]
    except KeyError as error:
        raise ValueError(f"Unsupported release platform: {platform}") from error

    bundle_root = repository_root / "frontend" / "src-tauri" / "target" / "release" / "bundle"
    browser_root = repository_root / "backend" / "dist" / "browser-lite"
    whisper_root = repository_root / "backend" / "dist" / "whisper-components"
    _prepare_empty_directory(output_dir)

    selected: list[Path] = []
    for pattern in spec.bundle_patterns:
        artifact = _single_file(bundle_root, pattern, f"{platform} bundle matching {pattern}")
        if artifact not in selected:
            selected.append(artifact)

    if signed:
        updater = _single_file(
            bundle_root,
            spec.updater_pattern,
            f"{platform} updater matching {spec.updater_pattern}",
        )
        if updater not in selected:
            selected.append(updater)
        selected.append(_require_signature(updater))

    browser = _single_file(
        browser_root,
        f"audux-lite-{spec.target}.zip",
        f"{platform} browser-lite archive",
    )
    validate_browser_lite_archive(browser, spec)
    selected.append(browser)

    whisper = _single_file(
        whisper_root,
        f"audux-whisper-{spec.target}.zip",
        f"{platform} Whisper archive",
    )
    descriptor = _single_file(
        whisper_root,
        f"whisper-component-{spec.target}.json",
        f"{platform} Whisper descriptor",
    )
    validate_whisper_descriptor(descriptor)
    selected.extend((whisper, descriptor))

    copied: dict[str, Path] = {}
    for artifact in selected:
        _copy_unique(artifact, output_dir, copied)
    return sorted(output_dir.iterdir())


def _validate_staged_platform(stage_dir: Path, spec: PlatformSpec) -> set[Path]:
    selected: set[Path] = set()
    for pattern in spec.bundle_patterns:
        selected.add(_single_file(stage_dir, pattern, f"{spec.name} bundle matching {pattern}"))
    updater = _single_file(
        stage_dir,
        spec.updater_pattern,
        f"{spec.name} updater matching {spec.updater_pattern}",
    )
    selected.add(updater)
    selected.add(_require_signature(updater))

    browser = _single_file(
        stage_dir,
        f"audux-lite-{spec.target}.zip",
        f"{spec.name} browser-lite archive",
    )
    validate_browser_lite_archive(browser, spec)
    selected.add(browser)

    whisper = _single_file(
        stage_dir,
        f"audux-whisper-{spec.target}.zip",
        f"{spec.name} Whisper archive",
    )
    descriptor = _single_file(
        stage_dir,
        f"whisper-component-{spec.target}.json",
        f"{spec.name} Whisper descriptor",
    )
    validate_whisper_descriptor(descriptor)
    selected.update((whisper, descriptor))

    actual = {path for path in stage_dir.iterdir() if path.is_file()}
    if actual != selected:
        extra = sorted(path.name for path in actual - selected)
        missing = sorted(path.name for path in selected - actual)
        raise ValueError(f"Unexpected staged assets for {spec.name}: extra={extra}, missing={missing}")
    return selected


def _validate_metadata(metadata_dir: Path, output_names: set[str], version: str) -> list[Path]:
    metadata = [_single_file(metadata_dir, name, name) for name in sorted(METADATA_NAMES)]
    latest = json.loads((metadata_dir / "latest.json").read_text(encoding="utf-8"))
    if latest.get("version") != version:
        raise ValueError("Application update manifest version mismatch")
    expected_platforms = {
        "linux-x86_64",
        "windows-x86_64",
        "darwin-x86_64",
        "darwin-aarch64",
    }
    if set(latest.get("platforms", {})) != expected_platforms:
        raise ValueError("Application update manifest platform set is incomplete")
    for item in latest["platforms"].values():
        asset_name = Path(unquote(urlparse(item["url"]).path)).name
        if asset_name not in output_names or not item.get("signature", "").strip():
            raise ValueError(f"Invalid updater manifest entry: {asset_name}")

    whisper = json.loads(
        (metadata_dir / "whisper-components.json").read_text(encoding="utf-8")
    )
    if whisper.get("app_version") != version:
        raise ValueError("Whisper component manifest version mismatch")
    if set(whisper.get("components", {})) != EXPECTED_TARGETS:
        raise ValueError("Whisper component manifest target set is incomplete")
    for component in whisper["components"].values():
        if component.get("asset_name") not in output_names:
            raise ValueError("Whisper component manifest references a missing asset")
    return metadata


def _write_checksums(output_dir: Path) -> Path:
    files = sorted(
        path for path in output_dir.iterdir() if path.is_file() and path.name != CHECKSUMS_NAME
    )
    if not files:
        raise ValueError("No release assets available for checksums")
    checksums = output_dir / CHECKSUMS_NAME
    checksums.write_text(
        "".join(f"{_sha256_file(path)}  {path.name}\n" for path in files),
        encoding="utf-8",
    )
    return checksums


def assemble_release(
    input_dir: Path,
    metadata_dir: Path,
    output_dir: Path,
    *,
    version: str,
) -> list[Path]:
    _prepare_empty_directory(output_dir)
    copied: dict[str, Path] = {}
    descriptors: set[str] = set()

    for spec in PLATFORMS.values():
        stage_dir = input_dir / f"audux-{spec.name}"
        if not stage_dir.is_dir():
            raise ValueError(f"Missing staged platform directory: {stage_dir.name}")
        selected = _validate_staged_platform(stage_dir, spec)
        for artifact in sorted(selected):
            if artifact.name.startswith("whisper-component-"):
                descriptors.add(artifact.name)
                continue
            _copy_unique(artifact, output_dir, copied)

    if len(descriptors) != len(PLATFORMS):
        raise ValueError("Whisper descriptor set is incomplete")
    metadata = _validate_metadata(metadata_dir, set(copied), version)
    for artifact in metadata:
        _copy_unique(artifact, output_dir, copied)
    _write_checksums(output_dir)
    return sorted(output_dir.iterdir())


def verify_checksums(input_dir: Path) -> None:
    checksums = input_dir / CHECKSUMS_NAME
    if not checksums.is_file():
        raise ValueError(f"Missing {CHECKSUMS_NAME}")
    expected: dict[str, str] = {}
    for line in checksums.read_text(encoding="utf-8").splitlines():
        digest, separator, name = line.partition("  ")
        if (
            separator != "  "
            or len(digest) != 64
            or Path(name).name != name
            or name == CHECKSUMS_NAME
            or name in expected
        ):
            raise ValueError(f"Invalid checksum entry: {line}")
        expected[name] = digest

    actual = {
        path.name
        for path in input_dir.iterdir()
        if path.is_file() and path.name != CHECKSUMS_NAME
    }
    if actual != set(expected):
        raise ValueError(
            f"Release asset set does not match checksums: "
            f"extra={sorted(actual - set(expected))}, missing={sorted(set(expected) - actual)}"
        )
    for name, digest in expected.items():
        if _sha256_file(input_dir / name) != digest:
            raise ValueError(f"Release checksum mismatch: {name}")


def main() -> None:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    stage_parser = subparsers.add_parser("stage")
    stage_parser.add_argument("--platform", choices=sorted(PLATFORMS), required=True)
    stage_parser.add_argument("--output", type=Path, required=True)
    stage_parser.add_argument("--mode", choices=("unsigned", "signed"), required=True)

    assemble_parser = subparsers.add_parser("assemble")
    assemble_parser.add_argument("--input", type=Path, required=True)
    assemble_parser.add_argument("--metadata", type=Path, required=True)
    assemble_parser.add_argument("--output", type=Path, required=True)
    assemble_parser.add_argument("--version", required=True)

    verify_parser = subparsers.add_parser("verify")
    verify_parser.add_argument("--input", type=Path, required=True)

    args = parser.parse_args()
    if args.command == "stage":
        staged = stage_platform(
            args.platform,
            args.output,
            signed=args.mode == "signed",
        )
        print("Staged release artifacts:")
        for path in staged:
            print(path)
    elif args.command == "assemble":
        assembled = assemble_release(
            args.input,
            args.metadata,
            args.output,
            version=args.version,
        )
        print("Assembled release assets:")
        for path in assembled:
            print(path)
    else:
        verify_checksums(args.input)
        print(f"Release checksums verified: {args.input}")


if __name__ == "__main__":
    main()
