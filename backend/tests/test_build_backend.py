import build_backend
import build_browser_lite
import build_whisper_companion
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


class TestBuildBackend:
    def test_target_triple_rejects_intel_macos(self, monkeypatch):
        monkeypatch.setattr(build_backend.platform, "system", lambda: "Darwin")
        monkeypatch.setattr(build_backend.platform, "machine", lambda: "x86_64")

        with pytest.raises(RuntimeError, match="Apple Silicon only"):
            build_backend.tauri_target_triple()

    def test_main_sidecar_excludes_asr_by_default(self, monkeypatch):
        monkeypatch.delenv("AUDUX_BUILD_WITH_ASR", raising=False)
        assert build_backend.build_with_asr() is False

    def test_public_release_requires_whisper_manifest_key(self, monkeypatch):
        monkeypatch.delenv(build_backend.WHISPER_PUBLIC_KEY_ENV, raising=False)
        monkeypatch.setenv(build_backend.REQUIRE_WHISPER_SIGNATURE_ENV, "1")

        with pytest.raises(RuntimeError, match=build_backend.WHISPER_PUBLIC_KEY_ENV):
            build_backend.prepare_whisper_manifest_public_key()

    def test_whisper_manifest_key_is_validated_and_normalized(
        self, monkeypatch, tmp_path
    ):
        private_key = Ed25519PrivateKey.generate()
        public_pem = private_key.public_key().public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        output = tmp_path / "whisper.pem"
        monkeypatch.setenv(build_backend.WHISPER_PUBLIC_KEY_ENV, public_pem.decode())
        monkeypatch.setattr(build_backend, "WHISPER_PUBLIC_KEY_PATH", output)

        assert build_backend.prepare_whisper_manifest_public_key() == output
        assert output.read_bytes() == public_pem

    def test_command_collects_dynamic_app_imports(self):
        command = build_backend.build_pyinstaller_command(
            "audux-backend",
            include_asr=False,
        )

        collected_modules = {
            command[index + 1]
            for index, argument in enumerate(command)
            if argument == "--collect-submodules"
        }
        assert "app" in collected_modules
        assert any(
            value.endswith(f"{build_backend.os.pathsep}app/assets")
            for value in command
        )
        assert any(
            value.endswith(
                f"ThirdPartyNotices.txt{build_backend.os.pathsep}app/assets/onnxruntime"
            )
            for value in command
        )
        assert command[-1] == "run.py"

        excluded_modules = {
            command[index + 1]
            for index, argument in enumerate(command)
            if argument == "--exclude-module"
        }
        assert excluded_modules == {
            "faster_whisper",
            "ctranslate2",
            "tokenizers",
            "av",
        }

    def test_sidecar_embeds_release_trust_and_notice_assets(self, tmp_path):
        public_key = tmp_path / "whisper.pem"
        notices = tmp_path / "THIRD_PARTY_NOTICES.txt"
        command = build_backend.build_pyinstaller_command(
            "audux-backend",
            include_asr=False,
            whisper_public_key=public_key,
            release_notices=notices,
        )

        assert f"{public_key}{build_backend.os.pathsep}app/assets" in command
        assert (
            f"{notices}{build_backend.os.pathsep}app/assets/licenses" in command
        )

    def test_whisper_companion_collects_asr_runtime(self):
        command = build_whisper_companion.build_command("audux-whisper")

        assert "--onefile" in command
        assert "faster_whisper" in command
        assert "ctranslate2" in command
        assert command[-1] == "run_whisper_companion.py"

    def test_browser_lite_embeds_frontend_and_excludes_asr(self):
        command = build_browser_lite.build_command("audux-lite")

        assert "--onefile" in command
        add_data_index = command.index("--add-data")
        assert command[add_data_index + 1].endswith(
            f"{build_browser_lite.os.pathsep}browser_frontend"
        )
        excluded_modules = {
            command[index + 1]
            for index, argument in enumerate(command)
            if argument == "--exclude-module"
        }
        assert excluded_modules == set(build_browser_lite.ASR_MODULES)
        assert command[-1] == "run_browser_lite.py"

    def test_browser_lite_uses_platform_executable_icon(self, monkeypatch):
        for system, icon_name in [
            ("Windows", "icon.ico"),
            ("Darwin", "icon.icns"),
        ]:
            monkeypatch.setattr(build_browser_lite.platform, "system", lambda: system)
            command = build_browser_lite.build_command("audux-lite")

            icon_index = command.index("--icon")
            assert command[icon_index + 1] == str(
                build_browser_lite.TAURI_ICONS / icon_name
            )

    def test_browser_lite_skips_embedded_icon_on_linux(self, monkeypatch):
        monkeypatch.setattr(build_browser_lite.platform, "system", lambda: "Linux")
        command = build_browser_lite.build_command("audux-lite")

        assert "--icon" not in command
