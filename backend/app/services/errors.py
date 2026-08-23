ERROR_CODE_BY_DETAIL = {
    "Audio not found": "audio.not_found",
    "Audio item not found": "audio.not_found",
    "Audio file missing": "audio.file_missing",
    "Audio file path must be within a configured library root": "audio.outside_library",
    "Invalid audio file path": "audio.invalid_path",
    "Unsupported audio format": "audio.unsupported_format",
    "Another audio item already uses this file path": "audio.path_in_use",
    "Cover not found": "cover.not_found",
    "Cover file missing": "cover.file_missing",
    "Unsupported image format": "cover.unsupported_format",
    "Empty cover file": "cover.empty",
    "Cover file is too large": "cover.too_large",
    "Transcript not found": "transcript.not_found",
    "Transcribe task is already pending, running or canceling": "transcript.task_active",
    "Transcript cannot be edited while transcription is active": "transcript.edit_active",
    "Transcript has changed since it was loaded; reload before saving": "transcript.conflict",
    "Transcript text is required": "transcript.text_required",
    "Transcript has no timeline segments to edit": "transcript.no_segments",
    "Transcript segment IDs must be unique": "transcript.duplicate_segments",
    "Transcript segment text is required": "transcript.segment_text_required",
    "Failed to create transcript": "transcript.create_failed",
    "Playlist name is required": "playlist.name_required",
    "Playlist not found": "playlist.not_found",
    "Playlist item not found": "playlist.item_not_found",
    "Duplicate playlist item ids": "playlist.duplicate_items",
    "item_ids must exactly match current playlist items": "playlist.items_mismatch",
    "Smart playlist membership is rule-driven": "playlist.rule_driven",
    "Smart playlist definition is invalid": "playlist.definition_invalid",
    "Tag not found": "tag.not_found",
    "Tag name is required": "tag.name_required",
    "Tag name already exists": "tag.name_exists",
    "Tag is still used by audio items": "tag.in_use",
    "Source and target tags must be different": "tag.same_source_target",
    "Source tag not found": "tag.source_not_found",
    "Target tag not found": "tag.target_not_found",
    "Audio tag relation not found": "tag.relation_not_found",
    "At least one tag name is required": "tag.at_least_one",
    "Invalid directory": "library.invalid_directory",
    "Library root already exists": "library.root_exists",
    "Library root not found": "library.root_not_found",
    "Cancel or finish the active scan task before removing this library root": "library.scan_active_remove",
    "Scan task is already pending or running for this library root": "library.scan_active",
    "Scan task not found": "library.scan_not_found",
    "Scan task cannot be canceled": "library.scan_cannot_cancel",
    "Analyze task is already pending, running or canceling": "ai.task_active",
    "LLM endpoint or model_name is not configured": "ai.not_configured",
    "endpoint and model_name are required": "ai.endpoint_model_required",
    "Task not found": "task.not_found",
    "Only failed/canceled task can be retried": "task.cannot_retry",
    "Another task is already active": "task.active",
    "Task cannot be canceled": "task.cannot_cancel",
    "Whisper component is not installed. Install it from Settings > ASR.": "asr.component_missing",
    "Whisper component installation is already running": "asr.install_active",
    "Whisper component installation is not running": "asr.install_inactive",
    "Cancel the Whisper component installation first": "asr.cancel_install_first",
    "Whisper component is in use by an active task": "asr.component_in_use",
    "Log file not found": "logs.not_found",
    "is_favorite is required": "batch.favorite_required",
    "Unsupported batch organization action": "batch.unsupported_action",
}


def error_code_for_detail(detail: str) -> str:
    if detail.startswith("Transcript segment ") and detail.endswith(" not found"):
        return "transcript.segment_not_found"
    if detail.startswith("Failed to delete file:"):
        return "audio.delete_file_failed"
    if detail.startswith("Tags not found:"):
        return "tag.not_found"
    if detail.startswith("Unsupported Whisper component platform:"):
        return "asr.unsupported_platform"
    return ERROR_CODE_BY_DETAIL.get(detail, "common.request_failed")


class ServiceError(Exception):
    def __init__(
        self,
        status_code: int,
        detail: str,
        code: str | None = None,
        params: dict | None = None,
    ):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.code = code or error_code_for_detail(detail)
        self.params = params or {}

    def structured_detail(self) -> dict:
        return {
            "code": self.code,
            "params": self.params,
            "fallback": self.detail,
        }
