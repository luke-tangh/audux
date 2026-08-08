import build_backend
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
