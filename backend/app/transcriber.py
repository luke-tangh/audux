from pathlib import Path
from typing import Any


_MODEL_CACHE: dict[tuple[str, str, str, str | None], Any] = {}


def _get_whisper_model(
    model_name: str,
    device: str,
    compute_type: str,
    download_root: str | None = None,
):
    try:
        from faster_whisper import WhisperModel
    except Exception as e:
        raise RuntimeError(
            "faster-whisper is not installed. "
            "Sync the ASR dependencies with: uv sync --locked --extra asr"
        ) from e

    key = (model_name, device, compute_type, download_root)

    if key not in _MODEL_CACHE:
        _MODEL_CACHE[key] = WhisperModel(
            model_name,
            device=device,
            compute_type=compute_type,
            download_root=download_root,
        )

    return _MODEL_CACHE[key]


def transcribe_audio(
    file_path: str,
    model_name: str = "small",
    device: str = "cpu",
    compute_type: str = "int8",
    beam_size: int = 5,
    download_root: str | None = None,
) -> dict:
    path = Path(file_path)

    if not path.exists() or not path.is_file():
        raise FileNotFoundError(f"Audio file not found: {file_path}")

    model = _get_whisper_model(
        model_name,
        device,
        compute_type,
        download_root,
    )

    segments_iter, info = model.transcribe(
        str(path),
        beam_size=beam_size,
    )

    segments = []
    full_text_parts = []

    for idx, seg in enumerate(segments_iter):
        text = (seg.text or "").strip()
        if text:
            full_text_parts.append(text)

        segments.append(
            {
                "segment_index": idx,
                "start_seconds": float(seg.start),
                "end_seconds": float(seg.end),
                "text": text,
            }
        )

    full_text = "\n".join(full_text_parts).strip()

    return {
        "language": getattr(info, "language", None),
        "model_name": model_name,
        "full_text": full_text,
        "segments": segments,
    }


def transcribe_audio_stub(file_path: str) -> dict:
    """
    保留给开发测试使用。默认工作流不再调用 stub。
    """
    p = Path(file_path)

    return {
        "language": "unknown",
        "model_name": "stub",
        "full_text": f"这是 {p.name} 的占位转写文本。请安装 faster-whisper 后替换真实转写逻辑。",
        "segments": [
            {
                "segment_index": 0,
                "start_seconds": 0,
                "end_seconds": 5,
                "text": f"这是 {p.name} 的占位转写文本。",
            }
        ],
    }
