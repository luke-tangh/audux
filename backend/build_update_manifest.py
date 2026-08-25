import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote


PLATFORM_ARTIFACTS = {
    "linux-x86_64": ("audux-linux-x64", "*.AppImage"),
    "windows-x86_64": ("audux-windows-x64", "*.exe"),
    "darwin-x86_64": ("audux-macos-x64", "*.app.tar.gz"),
    "darwin-aarch64": ("audux-macos-arm64", "*.app.tar.gz"),
}


def _single_artifact(input_dir: Path, pattern: str) -> Path:
    matches = sorted(
        path
        for path in input_dir.rglob(pattern)
        if path.is_file() and not path.name.endswith(".sig")
    )
    if len(matches) != 1:
        raise ValueError(
            f"Expected exactly one updater artifact matching {pattern}, found {len(matches)}"
        )
    return matches[0]


def build_manifest(
    input_dir: Path,
    *,
    version: str,
    repository: str,
    tag: str,
    notes: str,
) -> dict:
    platforms: dict[str, dict[str, str]] = {}
    for target, (artifact_dir, pattern) in PLATFORM_ARTIFACTS.items():
        artifact = _single_artifact(input_dir / artifact_dir, pattern)
        signature_path = artifact.with_name(f"{artifact.name}.sig")
        if not signature_path.is_file():
            raise ValueError(f"Missing updater signature: {signature_path.name}")
        signature = signature_path.read_text(encoding="utf-8").strip()
        if not signature:
            raise ValueError(f"Updater signature is empty: {signature_path.name}")
        asset_name = quote(artifact.name, safe="")
        platforms[target] = {
            "signature": signature,
            "url": (
                f"https://github.com/{repository}/releases/download/"
                f"{quote(tag, safe='')}/{asset_name}"
            ),
        }

    return {
        "version": version,
        "notes": notes,
        "pub_date": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "platforms": platforms,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--notes", default="Audux signed application update")
    args = parser.parse_args()

    manifest = build_manifest(
        args.input,
        version=args.version,
        repository=args.repository,
        tag=args.tag,
        notes=args.notes,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
