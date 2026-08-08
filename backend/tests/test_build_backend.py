import build_backend
import build_browser_lite
import build_whisper_companion


class TestBuildBackend:
    def test_main_sidecar_excludes_asr_by_default(self, monkeypatch):
        monkeypatch.delenv("LOCAL_AUDIO_LIBRARY_BUILD_WITH_ASR", raising=False)
        assert build_backend.build_with_asr() is False

    def test_command_collects_dynamic_app_imports(self):
        command = build_backend.build_pyinstaller_command(
            "local-audio-backend",
            include_asr=False,
        )

        collect_index = command.index("--collect-submodules")
        assert command[collect_index + 1] == "app"
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

    def test_whisper_companion_collects_asr_runtime(self):
        command = build_whisper_companion.build_command("local-audio-whisper")

        assert "--onefile" in command
        assert "faster_whisper" in command
        assert "ctranslate2" in command
        assert command[-1] == "run_whisper_companion.py"

    def test_browser_lite_embeds_frontend_and_excludes_asr(self):
        command = build_browser_lite.build_command("local-audio-library-lite")

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
            command = build_browser_lite.build_command("local-audio-library-lite")

            icon_index = command.index("--icon")
            assert command[icon_index + 1] == str(
                build_browser_lite.TAURI_ICONS / icon_name
            )

    def test_browser_lite_skips_embedded_icon_on_linux(self, monkeypatch):
        monkeypatch.setattr(build_browser_lite.platform, "system", lambda: "Linux")
        command = build_browser_lite.build_command("local-audio-library-lite")

        assert "--icon" not in command
