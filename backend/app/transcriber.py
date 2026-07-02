from pathlib import Path


def transcribe_audio_stub(file_path: str) -> dict:
    """
    MVP 占位实现。

    真实实现可替换为 faster-whisper：

    from faster_whisper import WhisperModel

    model = WhisperModel("small", device="cpu", compute_type="int8")
    segments, info = model.transcribe(file_path, beam_size=5)
    """
    p = Path(file_path)

    return {
        "language": "unknown",
        "model_name": "stub",
        "full_text": f"这是 {p.name} 的占位 transcript。请安装 faster-whisper 后替换真实转写逻辑。",
        "segments": [
            {
                "segment_index": 0,
                "start_seconds": 0,
                "end_seconds": 5,
                "text": f"这是 {p.name} 的占位 transcript。",
            }
        ],
    }
