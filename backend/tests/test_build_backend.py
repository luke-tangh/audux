import build_backend


class TestBuildBackend:
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
