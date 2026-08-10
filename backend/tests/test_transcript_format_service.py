import pytest

from app.asr_config import DEFAULT_CASE_GLOSSARY
from app.services.transcript_format_service import (
    format_transcript_segments,
    format_transcript_text,
    format_transcription_result,
    parse_case_glossary,
)


def test_only_restores_sentence_case_without_hidden_word_substitutions():
    assert format_transcript_text(
        "we use pytorch and i prefer cuda. openai uses ffmpeg."
    ) == "We use pytorch and i prefer cuda. Openai uses ffmpeg."


def test_visible_default_glossary_restores_current_casing_terms():
    assert parse_case_glossary(DEFAULT_CASE_GLOSSARY) == {
        "i": "I",
        "mr": "Mr",
        "mrs": "Mrs",
        "dr": "Dr",
    }
    assert format_transcript_text(
        "i spoke with mr smith. mrs jones met dr lee.",
        custom_glossary=DEFAULT_CASE_GLOSSARY,
    ) == "I spoke with Mr smith. Mrs jones met Dr lee."


def test_custom_glossary_applies_visible_terms_and_respects_word_boundaries():
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

    format_transcript_segments(
        segments,
        custom_glossary=(
            "pytorch=PyTorch\ncuda=CUDA\nopenai=OpenAI\ngithub=GitHub"
        ),
    )

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
