import os
import platform
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

from build_backend import (
    ensure_pyinstaller_available,
    exe_suffix,
    tauri_target_triple,
)


ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent
FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"
TAURI_ICONS = PROJECT_ROOT / "frontend" / "src-tauri" / "icons"
OUTPUT_DIR = ROOT / "dist" / "browser-lite"
ASR_MODULES = ["faster_whisper", "ctranslate2", "tokenizers", "av"]


def executable_icon_path(system: str | None = None) -> Path | None:
    current_system = (system or platform.system()).lower()
    icon_name = {
        "windows": "icon.ico",
        "darwin": "icon.icns",
    }.get(current_system)
    return TAURI_ICONS / icon_name if icon_name else None


def build_command(name: str) -> list[str]:
    command = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onefile",
        "--name",
        name,
    ]
    icon_path = executable_icon_path()
    if icon_path is not None:
        if not icon_path.is_file():
            raise RuntimeError(f"Browser-lite executable icon not found: {icon_path}")
        command.extend(["--icon", str(icon_path)])
    command.extend(
        [
            "--add-data",
            f"{FRONTEND_DIST}{os.pathsep}browser_frontend",
        ]
    )
    for module_name in ASR_MODULES:
        command.extend(["--exclude-module", module_name])
    command.extend(
        [
            "--collect-submodules",
            "app",
            "--hidden-import",
            "sqlite3",
            "run_browser_lite.py",
        ]
    )
    return command


def main() -> None:
    ensure_pyinstaller_available()
    if not (FRONTEND_DIST / "index.html").is_file():
        raise RuntimeError(
            "Browser-lite frontend is missing. Run: "
            "cd frontend && npm run build:browser-lite"
        )

    executable_base = "local-audio-library-lite"
    executable_name = f"{executable_base}{exe_suffix()}"
    subprocess.check_call(build_command(executable_base), cwd=ROOT)

    built = ROOT / "dist" / executable_name
    if not built.is_file():
        raise RuntimeError(f"Browser-lite executable not found: {built}")
    if platform.system().lower() != "windows":
        built.chmod(built.stat().st_mode | 0o111)

    target = tauri_target_triple()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    target_executable = OUTPUT_DIR / (
        f"local-audio-library-lite-{target}{exe_suffix()}"
    )
    shutil.copy2(built, target_executable)
    if platform.system().lower() != "windows":
        target_executable.chmod(target_executable.stat().st_mode | 0o111)

    archive = OUTPUT_DIR / f"local-audio-library-lite-{target}.zip"
    with zipfile.ZipFile(
        archive,
        "w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=9,
    ) as bundle:
        bundle.write(target_executable, arcname=executable_name)

    print(f"Browser-lite executable: {target_executable}")
    print(f"Browser-lite release archive: {archive}")


if __name__ == "__main__":
    main()
