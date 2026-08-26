import importlib.util
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from build_third_party_notices import build_notices

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent
FRONTEND_TAURI = PROJECT_ROOT / "frontend" / "src-tauri"
BINARIES_DIR = FRONTEND_TAURI / "binaries"
ASSETS_DIR = ROOT / "app" / "assets"
PROJECT_LICENSE_PATH = PROJECT_ROOT / "LICENSE"
RELEASE_ASSETS_DIR = ROOT / "build" / "release-assets"
PYTHON_NOTICES_PATH = RELEASE_ASSETS_DIR / "THIRD_PARTY_NOTICES.txt"
TAURI_NOTICES_PATH = (
    PROJECT_ROOT
    / "frontend"
    / "src-tauri"
    / "build-resources"
    / "THIRD_PARTY_NOTICES.txt"
)
TAURI_LICENSE_PATH = TAURI_NOTICES_PATH.with_name("LICENSE")
WHISPER_PUBLIC_KEY_PATH = RELEASE_ASSETS_DIR / "whisper_manifest_public_key.pem"
WHISPER_PUBLIC_KEY_ENV = "AUDUX_WHISPER_MANIFEST_PUBLIC_KEY"
REQUIRE_WHISPER_SIGNATURE_ENV = "AUDUX_REQUIRE_WHISPER_MANIFEST_SIGNATURE"

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

        AUDUX_BUILD_WITH_ASR=0 \\
          uv run --locked --group build python backend/build_backend.py
    """
    value = os.getenv("AUDUX_BUILD_WITH_ASR")

    if _env_falsey(value):
        return False

    return _env_truthy(value, default=False)


def module_available(module_name: str) -> bool:
    return importlib.util.find_spec(module_name) is not None


def onnxruntime_notice_files() -> list[Path]:
    spec = importlib.util.find_spec("onnxruntime")
    if spec is None or spec.origin is None:
        raise RuntimeError("onnxruntime is required for bundled Silero VAD")

    package_dir = Path(spec.origin).resolve().parent
    notice_files = [package_dir / "LICENSE", package_dir / "ThirdPartyNotices.txt"]
    missing = [path.name for path in notice_files if not path.is_file()]
    if missing:
        raise RuntimeError(
            "onnxruntime license files are missing: " + ", ".join(missing)
        )
    return notice_files


def prepare_whisper_manifest_public_key() -> Path | None:
    value = os.getenv(WHISPER_PUBLIC_KEY_ENV, "").strip()
    if not value:
        if _env_truthy(os.getenv(REQUIRE_WHISPER_SIGNATURE_ENV)):
            raise RuntimeError(
                f"{WHISPER_PUBLIC_KEY_ENV} is required for a public release build"
            )
        return None

    key = serialization.load_pem_public_key(value.encode("utf-8"))
    if not isinstance(key, Ed25519PublicKey):
        raise RuntimeError("Whisper manifest public key must be an Ed25519 public key")
    WHISPER_PUBLIC_KEY_PATH.parent.mkdir(parents=True, exist_ok=True)
    WHISPER_PUBLIC_KEY_PATH.write_bytes(
        key.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
    )
    WHISPER_PUBLIC_KEY_PATH.chmod(0o600)
    return WHISPER_PUBLIC_KEY_PATH


def prepare_python_notices() -> Path:
    return build_notices(
        PYTHON_NOTICES_PATH,
        include_python=True,
        include_npm=False,
        include_cargo=False,
    )


def prepare_tauri_notices() -> Path:
    notices = build_notices(
        TAURI_NOTICES_PATH,
        include_python=True,
        include_npm=True,
        include_cargo=True,
    )
    shutil.copy2(PROJECT_LICENSE_PATH, TAURI_LICENSE_PATH)
    return notices


def build_pyinstaller_command(
    name: str,
    include_asr: bool,
    *,
    whisper_public_key: Path | None = None,
    release_notices: Path | None = None,
) -> list[str]:
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
                "AUDUX_BUILD_WITH_ASR is enabled, but faster-whisper "
                "is not installed.\n\n"
                "For an embedded-ASR sidecar:\n"
                "  uv sync --locked --extra asr --group build\n"
                "  AUDUX_BUILD_WITH_ASR=1 uv run --locked --extra asr "
                "--group build python backend/build_backend.py\n\n"
                "For a lite build without embedded faster-whisper:\n"
                "  AUDUX_BUILD_WITH_ASR=0 "
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

    for notice_file in onnxruntime_notice_files():
        cmd.extend(
            [
                "--add-data",
                f"{notice_file}{os.pathsep}app/assets/onnxruntime",
            ]
        )

    if whisper_public_key is not None:
        cmd.extend(
            [
                "--add-data",
                f"{whisper_public_key}{os.pathsep}app/assets",
            ]
        )
    if release_notices is not None:
        cmd.extend(
            [
                "--add-data",
                f"{release_notices}{os.pathsep}app/assets/licenses",
            ]
        )

    cmd.extend(
        [
            "--add-data",
            f"{PROJECT_LICENSE_PATH}{os.pathsep}app/assets/licenses",
        ]
    )

    cmd.extend(
        [
            "--add-data",
            f"{ASSETS_DIR}{os.pathsep}app/assets",
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

    name = "audux-backend"
    target = tauri_target_triple()
    include_asr = build_with_asr()
    whisper_public_key = prepare_whisper_manifest_public_key()
    notices_file = prepare_python_notices()
    if _env_truthy(os.getenv("AUDUX_BUILD_TAURI_NOTICES")):
        prepare_tauri_notices()

    dist_dir = ROOT / "dist"

    cmd = build_pyinstaller_command(
        name,
        include_asr=include_asr,
        whisper_public_key=whisper_public_key,
        release_notices=notices_file,
    )

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
