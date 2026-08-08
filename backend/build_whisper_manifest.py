import argparse
import json
from pathlib import Path


def build_manifest(input_dir: Path, version: str) -> dict:
    components: dict[str, dict] = {}

    for path in sorted(input_dir.rglob("whisper-component-*.json")):
        descriptor = json.loads(path.read_text(encoding="utf-8"))
        target = str(descriptor["target"])
        if target in components:
            raise ValueError(f"Duplicate Whisper component target: {target}")
        components[target] = {
            key: descriptor[key]
            for key in [
                "asset_name",
                "archive_sha256",
                "archive_size",
                "executable_name",
                "executable_sha256",
                "executable_size",
            ]
        }

    if not components:
        raise ValueError("No Whisper component descriptors found")

    return {
        "schema_version": 1,
        "app_version": version,
        "components": components,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--version", required=True)
    args = parser.parse_args()

    manifest = build_manifest(args.input, args.version)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
