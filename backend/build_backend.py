import platform
import subprocess
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent
FRONTEND_TAURI = PROJECT_ROOT / "frontend" / "src-tauri"
BINARIES_DIR = FRONTEND_TAURI / "binaries"

BINARIES_DIR.mkdir(parents=True, exist_ok=True)


def tauri_target_triple() -> str:
    system = platform.system().lower()
    machine = platform.machine().lower()

    if system == "windows":
        return "x86_64-pc-windows-msvc"

    if system == "darwin":
        if machine in ["arm64", "aarch64"]:
            return "aarch64-apple-darwin"
        return "x86_64-apple-darwin"

    if system == "linux":
        return "x86_64-unknown-linux-gnu"

    raise RuntimeError(f"Unsupported platform: {system} {machine}")


def exe_suffix() -> str:
    return ".exe" if platform.system().lower() == "windows" else ""


def main():
    name = "local-audio-backend"
    target = tauri_target_triple()

    dist_dir = ROOT / "dist"
    build_dir = ROOT / "build"

    subprocess.check_call(
        [
            "pyinstaller",
            "--noconfirm",
            "--clean",
            "--onefile",
            "--name",
            name,
            "run.py",
        ],
        cwd=ROOT,
    )

    built = dist_dir / f"{name}{exe_suffix()}"
    if not built.exists():
        raise RuntimeError(f"PyInstaller output not found: {built}")

    # Tauri sidecar 命名规则：
    # externalBin 写 binaries/local-audio-backend
    # 实际文件名需要追加 -target-triple
    out_name = f"{name}-{target}{exe_suffix()}"
    out_path = BINARIES_DIR / out_name

    shutil.copy2(built, out_path)

    print(f"Backend sidecar generated: {out_path}")


if __name__ == "__main__":
    main()
