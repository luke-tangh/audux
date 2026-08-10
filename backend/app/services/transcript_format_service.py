import re

MAX_GLOSSARY_ENTRIES = 500
MAX_GLOSSARY_TERM_CHARACTERS = 100
MAX_GLOSSARY_SOURCE_CHARACTERS = 20_000
SENTENCE_TERMINATORS = ".!?。！？"


def parse_case_glossary(value: str) -> dict[str, str]:
    if len(value) > MAX_GLOSSARY_SOURCE_CHARACTERS:
        raise ValueError(
            f"case glossary must not exceed {MAX_GLOSSARY_SOURCE_CHARACTERS} characters"
        )

    result: dict[str, str] = {}
    for line_number, raw_line in enumerate(value.splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue

        if "=" in line:
            source, canonical = (part.strip() for part in line.split("=", 1))
        else:
            source = line.casefold()
            canonical = line

        if not source or not canonical:
            raise ValueError(f"case glossary line {line_number} is incomplete")
        if (
            len(source) > MAX_GLOSSARY_TERM_CHARACTERS
            or len(canonical) > MAX_GLOSSARY_TERM_CHARACTERS
        ):
            raise ValueError(
                f"case glossary line {line_number} exceeds "
                f"{MAX_GLOSSARY_TERM_CHARACTERS} characters"
            )

        result[source.casefold()] = canonical
        if len(result) > MAX_GLOSSARY_ENTRIES:
            raise ValueError(
                f"case glossary must not exceed {MAX_GLOSSARY_ENTRIES} entries"
            )
    return result


def _term_pattern(source: str) -> re.Pattern[str]:
    escaped = re.escape(source)
    prefix = (
        r"(?<![A-Za-z0-9_])"
        if source and source[0].isascii() and (source[0].isalnum() or source[0] == "_")
        else ""
    )
    suffix = (
        r"(?![A-Za-z0-9_])"
        if source and source[-1].isascii() and (source[-1].isalnum() or source[-1] == "_")
        else ""
    )
    return re.compile(f"{prefix}{escaped}{suffix}", re.IGNORECASE)


def _restore_case_glossary(value: str, custom_glossary: str) -> str:
    glossary = parse_case_glossary(custom_glossary)

    result = value
    for source, canonical in sorted(
        glossary.items(),
        key=lambda item: len(item[0]),
        reverse=True,
    ):
        result = _term_pattern(source).sub(lambda _: canonical, result)
    return result


def _uppercase_match(match: re.Match[str]) -> str:
    return f"{match.group(1)}{match.group(2).upper()}"


def _restore_sentence_case(value: str, capitalize_start: bool) -> str:
    result = value
    if capitalize_start:
        result = re.sub(
            r"^(\s*[\"'“‘(\[]*)([a-z])",
            _uppercase_match,
            result,
            count=1,
        )

    result = re.sub(
        r"([.!?。！？][\s\"'”’）)\]]*)([a-z])",
        _uppercase_match,
        result,
    )
    return result


def format_transcript_text(
    value: str,
    *,
    custom_glossary: str = "",
    capitalize_start: bool = True,
) -> str:
    restored = _restore_case_glossary(value, custom_glossary)
    return _restore_sentence_case(restored, capitalize_start)


def format_transcript_segments(
    segments: list[dict],
    *,
    custom_glossary: str = "",
) -> None:
    capitalize_next = True
    for segment in segments:
        text = str(segment.get("text") or "").strip()
        segment["text"] = format_transcript_text(
            text,
            custom_glossary=custom_glossary,
            capitalize_start=capitalize_next,
        )
        stripped = segment["text"].rstrip()
        if stripped:
            capitalize_next = bool(
                re.search(
                    rf"[{re.escape(SENTENCE_TERMINATORS)}][\"'”’）)\]]*$",
                    stripped,
                )
            )


def format_transcription_result(result: dict, *, custom_glossary: str = "") -> dict:
    formatted = {
        **result,
        "segments": [dict(segment) for segment in result.get("segments") or []],
    }
    formatted["full_text"] = format_transcript_text(
        str(result.get("full_text") or ""),
        custom_glossary=custom_glossary,
    )
    format_transcript_segments(
        formatted["segments"],
        custom_glossary=custom_glossary,
    )
    return formatted
