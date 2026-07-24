import tempfile
import unittest
from pathlib import Path

from app.transcriber import transcribe_audio, transcribe_audio_stub


class TestTranscriber(unittest.TestCase):
    def test_transcribe_audio_missing_file_raises_before_loading_model(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing = Path(tmp) / "missing.mp3"

            with self.assertRaises(FileNotFoundError):
                transcribe_audio(str(missing))

    def test_transcribe_audio_stub_shape(self):
        result = transcribe_audio_stub("/tmp/demo.mp3")

        self.assertEqual(result["language"], "unknown")
        self.assertEqual(result["model_name"], "stub")
        self.assertIn("full_text", result)
        self.assertIsInstance(result["segments"], list)
        self.assertGreaterEqual(len(result["segments"]), 1)

        first_segment = result["segments"][0]
        self.assertEqual(first_segment["segment_index"], 0)
        self.assertIn("start_seconds", first_segment)
        self.assertIn("end_seconds", first_segment)
        self.assertIn("text", first_segment)


if __name__ == "__main__":
    unittest.main()
