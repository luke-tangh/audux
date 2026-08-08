import hashlib
import json
import platform
import subprocess
import sys
import zipfile
from pathlib import Path

from build_backend import (
    ensure_pyinstaller_available,
    exe_suffix,
    module_available,
    tauri_target_triple,
)


ROOT = Path(__file__).resolve().parent
OUTPUT_DIR = ROOT / "dist" / "whisper-components"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_command(name: str) -> list[str]:
    return [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onefile",
        "--name",
        name,
        "--collect-all",
        "faster_whisper",
        "--collect-submodules",
        "ctranslate2",
        "--collect-submodules",
        "tokenizers",
        "--collect-submodules",
        "av",
        "run_whisper_companion.py",
    ]


def main() -> None:
    ensure_pyinstaller_available()
    if not module_available("faster_whisper"):
        raise RuntimeError(
            "faster-whisper is not installed. Run: "
            "uv sync --locked --extra asr --group build"
        )

    target = tauri_target_triple()
    executable_name = f"local-audio-whisper{exe_suffix()}"
    command = build_command("local-audio-whisper")

    subprocess.check_call(command, cwd=ROOT)

    executable = ROOT / "dist" / executable_name
    if not executable.exists():
        raise RuntimeError(f"Whisper companion output not found: {executable}")

    if platform.system().lower() != "windows":
        executable.chmod(executable.stat().st_mode | 0o111)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    asset_name = f"local-audio-whisper-{target}.zip"
    archive = OUTPUT_DIR / asset_name
    compression = zipfile.ZIP_DEFLATED
    compresslevel = 9

    with zipfile.ZipFile(
        archive,
        "w",
        compression=compression,
        compresslevel=compresslevel,
    ) as bundle:
        bundle.write(executable, arcname=executable_name)

    descriptor = {
        "target": target,
        "asset_name": asset_name,
        "archive_sha256": _sha256(archive),
        "archive_size": archive.stat().st_size,
        "executable_name": executable_name,
        "executable_sha256": _sha256(executable),
        "executable_size": executable.stat().st_size,
    }
    descriptor_path = OUTPUT_DIR / f"whisper-component-{target}.json"
    descriptor_path.write_text(
        json.dumps(descriptor, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"Whisper companion archive: {archive}")
    print(f"Whisper component descriptor: {descriptor_path}")


if __name__ == "__main__":
    main()
