import importlib.util
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

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
            "PyInstaller is not installed. Sync the build dependencies first:\n"
            "  uv sync --locked --group build"
        ) from e


def _env_truthy(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default

    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_falsey(value: str | None) -> bool:
    return bool(value and value.strip().lower() in {"0", "false", "no", "off"})


def build_with_asr() -> bool:
    """
    Whether to include the embedded faster-whisper provider and its native
    dependencies in the PyInstaller sidecar.

    External ASR uses the base httpx dependency and remains available when this
    option is disabled.

    Default: false. Release builds keep the main sidecar lightweight and ship
    faster-whisper as an optional companion component.

    To create a lite/smoke build without faster-whisper:

        LOCAL_AUDIO_LIBRARY_BUILD_WITH_ASR=0 \\
          uv run --locked --group build python backend/build_backend.py
    """
    value = os.getenv("LOCAL_AUDIO_LIBRARY_BUILD_WITH_ASR")

    if _env_falsey(value):
        return False

    return _env_truthy(value, default=False)


def module_available(module_name: str) -> bool:
    return importlib.util.find_spec(module_name) is not None


def build_pyinstaller_command(name: str, include_asr: bool) -> list[str]:
    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onefile",
        "--name",
        name,
    ]

    if include_asr:
        if not module_available("faster_whisper"):
            raise RuntimeError(
                "LOCAL_AUDIO_LIBRARY_BUILD_WITH_ASR is enabled, but faster-whisper "
                "is not installed.\n\n"
                "For full release build:\n"
                "  uv sync --locked --extra asr --group build\n\n"
                "For a lite build without embedded faster-whisper:\n"
                "  LOCAL_AUDIO_LIBRARY_BUILD_WITH_ASR=0 "
                "uv run --locked --group build python backend/build_backend.py"
            )

        cmd.extend(
            [
                "--collect-all",
                "faster_whisper",
                "--collect-submodules",
                "ctranslate2",
                "--collect-submodules",
                "tokenizers",
                "--collect-submodules",
                "av",
            ]
        )
    else:
        for module_name in ["faster_whisper", "ctranslate2", "tokenizers", "av"]:
            cmd.extend(["--exclude-module", module_name])

        print(
            "Building backend sidecar WITHOUT embedded faster-whisper support. "
            "The external ASR provider remains available; install the optional "
            "Whisper companion to enable local transcription."
        )

    cmd.extend(
        [
            "--collect-submodules",
            "app",
            "--hidden-import",
            "sqlite3",
            "run.py",
        ]
    )

    return cmd


def main():
    ensure_pyinstaller_available()

    name = "local-audio-backend"
    target = tauri_target_triple()
    include_asr = build_with_asr()

    dist_dir = ROOT / "dist"

    cmd = build_pyinstaller_command(name, include_asr=include_asr)

    print("Building backend sidecar...")
    print(f"include_asr={include_asr}")
    print(" ".join(cmd))

    subprocess.check_call(cmd, cwd=ROOT)

    built = dist_dir / f"{name}{exe_suffix()}"
    if not built.exists():
        raise RuntimeError(f"PyInstaller output not found: {built}")

    out_name = f"{name}-{target}{exe_suffix()}"
    out_path = BINARIES_DIR / out_name

    shutil.copy2(built, out_path)

    if platform.system().lower() != "windows":
        out_path.chmod(out_path.stat().st_mode | 0o111)

    print(f"Backend sidecar generated: {out_path}")


if __name__ == "__main__":
    main()
