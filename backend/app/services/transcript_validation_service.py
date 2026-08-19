import json
import re
from dataclasses import dataclass

from sqlmodel import Session

from ..models import AudioItem, Transcript, TranscriptIssue, TranscriptSegment, now_iso


@dataclass(frozen=True)
class ValidationFinding:
    code: str
    severity: str
    segment_id: int | None
    evidence: dict


def _normalized_text(value: str) -> str:
    return " ".join(value.split())


def validate_transcript(
    transcript: Transcript,
    segments: list[TranscriptSegment],
    audio: AudioItem,
) -> list[ValidationFinding]:
    """Return stable, deterministic findings without changing stored content."""
    findings: list[ValidationFinding] = []
    ordered = sorted(segments, key=lambda item: item.segment_index)
    previous: TranscriptSegment | None = None

    for segment in ordered:
        segment_id = int(segment.id) if segment.id is not None else None
        if segment.end_seconds <= segment.start_seconds:
            findings.append(
                ValidationFinding(
                    "timeline.reversed",
                    "error",
                    segment_id,
                    {
                        "segment_index": segment.segment_index,
                        "start_seconds": segment.start_seconds,
                        "end_seconds": segment.end_seconds,
                    },
                )
            )

        if segment.start_seconds < 0 or (
            audio.duration_seconds is not None
            and segment.end_seconds > audio.duration_seconds + 0.05
        ):
            findings.append(
                ValidationFinding(
                    "timeline.out_of_bounds",
                    "error",
                    segment_id,
                    {
                        "segment_index": segment.segment_index,
                        "start_seconds": segment.start_seconds,
                        "end_seconds": segment.end_seconds,
                        "audio_duration_seconds": audio.duration_seconds,
                    },
                )
            )

        if previous is not None and segment.start_seconds < previous.end_seconds - 0.05:
            findings.append(
                ValidationFinding(
                    "timeline.overlap",
                    "warning",
                    segment_id,
                    {
                        "segment_index": segment.segment_index,
                        "previous_segment_index": previous.segment_index,
                        "overlap_seconds": round(
                            previous.end_seconds - segment.start_seconds,
                            6,
                        ),
                    },
                )
            )

        if not segment.text.strip():
            findings.append(
                ValidationFinding(
                    "segment.empty",
                    "warning",
                    segment_id,
                    {"segment_index": segment.segment_index},
                )
            )
        previous = segment

    if ordered:
        rebuilt = "\n".join(item.text.strip() for item in ordered)
        if _normalized_text(rebuilt) != _normalized_text(transcript.full_text):
            findings.append(
                ValidationFinding(
                    "transcript.full_text_mismatch",
                    "error",
                    None,
                    {
                        "segment_count": len(ordered),
                        "stored_length": len(transcript.full_text),
                        "rebuilt_length": len(rebuilt),
                    },
                )
            )

    sample = transcript.full_text[:4000]
    if len(sample.strip()) >= 20 and transcript.language:
        cjk_count = len(re.findall(r"[\u3400-\u9fff]", sample))
        latin_count = len(re.findall(r"[A-Za-z]", sample))
        comparable = cjk_count + latin_count
        language = transcript.language.lower()
        suspicious = (
            comparable >= 20
            and (
                (language.startswith("zh") and latin_count / comparable > 0.9)
                or (language.startswith("en") and cjk_count / comparable > 0.5)
            )
        )
        if suspicious:
            findings.append(
                ValidationFinding(
                    "language.suspected_mismatch",
                    "warning",
                    None,
                    {
                        "declared_language": transcript.language,
                        "cjk_characters": cjk_count,
                        "latin_characters": latin_count,
                    },
                )
            )

    metrics = {}
    if transcript.quality_metrics_json:
        try:
            parsed = json.loads(transcript.quality_metrics_json)
            if isinstance(parsed, dict):
                metrics = parsed
        except (TypeError, ValueError):
            metrics = {}
    confidence = metrics.get("average_confidence")
    if isinstance(confidence, (int, float)) and confidence < 0.5:
        findings.append(
            ValidationFinding(
                "review.low_confidence",
                "warning",
                None,
                {"average_confidence": confidence},
            )
        )

    segment_by_index = {segment.segment_index: segment for segment in ordered}
    suspect_segments = metrics.get("suspect_segments")
    if isinstance(suspect_segments, list):
        for suspect in suspect_segments:
            if isinstance(suspect, int):
                segment_index = suspect
                reason = "provider_flagged"
            elif isinstance(suspect, dict) and isinstance(
                suspect.get("segment_index"), int
            ):
                segment_index = suspect["segment_index"]
                reason = str(suspect.get("reason") or "provider_flagged")
            else:
                continue
            segment = segment_by_index.get(segment_index)
            if segment is None:
                continue
            findings.append(
                ValidationFinding(
                    "review.required",
                    "warning",
                    int(segment.id) if segment.id is not None else None,
                    {"segment_index": segment_index, "reason": reason},
                )
            )

    return findings


def store_validation_issues(
    session: Session,
    transcript: Transcript,
    segments: list[TranscriptSegment],
    audio: AudioItem,
) -> list[TranscriptIssue]:
    if transcript.id is None or audio.id is None:
        raise ValueError("Transcript and audio must be persisted before validation")

    rows: list[TranscriptIssue] = []
    for finding in validate_transcript(transcript, segments, audio):
        row = TranscriptIssue(
            audio_id=audio.id,
            transcript_id=transcript.id,
            segment_id=finding.segment_id,
            code=finding.code,
            severity=finding.severity,
            evidence_json=json.dumps(
                finding.evidence,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ),
            created_at=now_iso(),
            updated_at=now_iso(),
        )
        session.add(row)
        rows.append(row)
    session.flush()
    return rows
