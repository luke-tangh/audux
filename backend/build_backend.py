import platform
import subprocess
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent
FRONTEND_TAURI = PROJECT_ROOT / "frontend" / "src-tauri"
BINARIES_DIR = FRONTEND_TAURI / "binaries"

BINARIES_DIR.mkdir(parents=True, exist_ok=True)


def tauri_target_triple() -> str:
    system = platform.system().lower()
    machine = platform.machine().lower()

    if system == "windows":
        if machine in ["arm64", "aarch64"]:
            return "aarch64-pc-windows-msvc"
        return "x86_64-pc-windows-msvc"

    if system == "darwin":
        if machine in ["arm64", "aarch64"]:
            return "aarch64-apple-darwin"
        return "x86_64-apple-darwin"

    if system == "linux":
        if machine in ["arm64", "aarch64"]:
            return "aarch64-unknown-linux-gnu"
        return "x86_64-unknown-linux-gnu"

    raise RuntimeError(f"Unsupported platform: {system} {machine}")


def exe_suffix() -> str:
    return ".exe" if platform.system().lower() == "windows" else ""


def ensure_pyinstaller_available():
    try:
        import PyInstaller  # noqa: F401
    except Exception as e:
        raise RuntimeError(
            "PyInstaller is not installed. Install it before release build:\n"
            "  python -m pip install pyinstaller"
        ) from e


def main():
    ensure_pyinstaller_available()

    name = "local-audio-backend"
    target = tauri_target_triple()

    dist_dir = ROOT / "dist"

    cmd = [
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
        "--hidden-import",
        "sqlite3",
        "run.py",
    ]

    print("Building backend sidecar...")
    print(" ".join(cmd))

    subprocess.check_call(cmd, cwd=ROOT)

    built = dist_dir / f"{name}{exe_suffix()}"
    if not built.exists():
        raise RuntimeError(f"PyInstaller output not found: {built}")

    out_name = f"{name}-{target}{exe_suffix()}"
    out_path = BINARIES_DIR / out_name

    shutil.copy2(built, out_path)

    print(f"Backend sidecar generated: {out_path}")


if __name__ == "__main__":
    main()
