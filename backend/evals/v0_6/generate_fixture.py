"""Generate a deterministic, privacy-free WAV used by the v0.6 eval manifest."""

import math
import struct
import sys
import wave
from pathlib import Path


def generate(output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / "audux-v0.6-synthetic.wav"
    sample_rate = 16_000
    duration_seconds = 12
    with wave.open(str(output), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        for index in range(sample_rate * duration_seconds):
            second = index / sample_rate
            # Alternating tone and long silence exercise duration/VAD paths without speech.
            amplitude = 0 if 3 <= second < 8 else int(2500 * math.sin(2 * math.pi * 440 * second))
            wav.writeframesraw(struct.pack("<h", amplitude))
    return output


if __name__ == "__main__":
    destination = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/audux-v0.6-eval")
    print(generate(destination))
