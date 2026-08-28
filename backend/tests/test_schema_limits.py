import pytest
from pydantic import ValidationError

from app.schemas import (
    BatchOrganizationRequest,
    LibraryRootCreate,
    LLMConfig,
    MAX_STRUCTURED_METADATA_BYTES,
    MAX_TRANSCRIPT_SEGMENT_CHARACTERS,
    OrganizationProposalDecision,
    PlaylistCreate,
    SettingUpdate,
    TagsAddRequest,
    TranscriptSegmentCreate,
)


@pytest.mark.parametrize(
    "payload",
    [
        lambda: LibraryRootCreate(path="x" * 4097),
        lambda: TagsAddRequest(tags=["x" * 81]),
        lambda: PlaylistCreate(name="x" * 81),
        lambda: SettingUpdate(key="key", value="x" * 16_385),
        lambda: LLMConfig(endpoint="http://localhost", model_name="x" * 257),
        lambda: TranscriptSegmentCreate(
            segment_index=0,
            start_seconds=0,
            end_seconds=1,
            text="x" * (MAX_TRANSCRIPT_SEGMENT_CHARACTERS + 1),
        ),
        lambda: BatchOrganizationRequest(
            audio_ids=[1],
            action="add_tags",
            tag_names=["x" * 81],
        ),
        lambda: OrganizationProposalDecision(
            decision="accepted",
            edited_value={"text": "x" * MAX_STRUCTURED_METADATA_BYTES},
        ),
    ],
)
def test_public_request_schemas_reject_oversized_values(payload):
    with pytest.raises(ValidationError):
        payload()
