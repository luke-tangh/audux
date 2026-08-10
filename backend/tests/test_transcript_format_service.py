import pytest

from app.services.transcript_format_service import (
    format_transcript_segments,
    format_transcript_text,
    format_transcription_result,
    parse_case_glossary,
)


def test_restores_sentence_and_built_in_technical_term_casing():
    assert format_transcript_text(
        "we use pytorch on cuda. 我们在 wsl 使用 ffmpeg. i agree."
    ) == "We use PyTorch on CUDA. 我们在 WSL 使用 FFmpeg. I agree."


def test_custom_glossary_overrides_built_ins_and_respects_word_boundaries():
    assert format_transcript_text(
        "ark asr works with onnx runtime, not basra.",
        custom_glossary="ark asr=ARK-ASR-3B\nonnx runtime=ONNX Runtime Custom",
    ) == "ARK-ASR-3B works with ONNX Runtime Custom, not basra."


def test_segment_sentence_state_continues_across_timestamps():
    segments = [
        {"text": "we use pytorch"},
        {"text": "on cuda."},
        {"text": "openai works.\""},
        {"text": ""},
        {"text": "github agrees"},
    ]

    format_transcript_segments(segments)

    assert [segment["text"] for segment in segments] == [
        "We use PyTorch",
        "on CUDA.",
        'OpenAI works."',
        "",
        "GitHub agrees",
    ]


def test_format_result_copies_input_before_updating_text():
    source = {
        "full_text": "ark asr works.",
        "segments": [{"text": "ark asr works."}],
    }

    result = format_transcription_result(
        source,
        custom_glossary="ark asr=ARK-ASR-3B",
    )

    assert result["full_text"] == "ARK-ASR-3B works."
    assert result["segments"][0]["text"] == "ARK-ASR-3B works."
    assert source["segments"][0]["text"] == "ark asr works."


@pytest.mark.parametrize(
    "value",
    ["broken=", f"{'a' * 101}=A", "\n".join(f"term-{index}" for index in range(501))],
)
def test_rejects_invalid_glossary(value: str):
    with pytest.raises(ValueError):
        parse_case_glossary(value)
