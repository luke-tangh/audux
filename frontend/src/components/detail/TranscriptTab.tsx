import { useEffect, useState } from "react";
import type {
  Transcript,
  TranscriptSegment,
  TranscriptSegmentEdit
} from "../../types";
import { formatDuration } from "../../types";
import { useDialog } from "../dialog/UnifiedDialog";
import { Button, PanelCard, TextareaField } from "../ui";
import { useTranslation } from "react-i18next";

type SaveOutcome = "saved" | "conflict" | "error";
type EditMode = "segments" | "full" | null;

type TranscriptTabProps = {
  transcript: Transcript | null;
  onTranscribe: () => void;
  onExportTranscript: (format: "txt" | "json" | "srt") => void;
  onJumpToSegment: (startSeconds: number) => void;
  onSaveFullTranscript: (
    fullText: string,
    expectedUpdatedAt: string
  ) => Promise<SaveOutcome>;
  onSaveTranscriptSegments: (
    segments: TranscriptSegmentEdit[],
    expectedUpdatedAt: string
  ) => Promise<SaveOutcome>;
  canEdit: boolean;
};

function segmentTextMap(transcript: Transcript | null): Record<number, string> {
  return Object.fromEntries(
    (transcript?.segments || []).map((segment) => [segment.id, segment.text])
  );
}

export default function TranscriptTab({
  transcript,
  onTranscribe,
  onExportTranscript,
  onJumpToSegment,
  onSaveFullTranscript,
  onSaveTranscriptSegments,
  canEdit
}: TranscriptTabProps) {
  const dialog = useDialog();
  const { t } = useTranslation();
  const [editMode, setEditMode] = useState<EditMode>(null);
  const [segmentDrafts, setSegmentDrafts] = useState<Record<number, string>>({});
  const [baseSegmentTexts, setBaseSegmentTexts] = useState<Record<number, string>>({});
  const [draftSegments, setDraftSegments] = useState<TranscriptSegment[]>([]);
  const [fullDraft, setFullDraft] = useState("");
  const [baseFullText, setBaseFullText] = useState("");
  const [baseTranscriptId, setBaseTranscriptId] = useState<number | null>(null);
  const [baseUpdatedAt, setBaseUpdatedAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [hasConflict, setHasConflict] = useState(false);

  const segmentEdits: TranscriptSegmentEdit[] = Object.entries(segmentDrafts)
    .filter(([id, text]) => text.trim() !== (baseSegmentTexts[Number(id)] || ""))
    .map(([id, text]) => ({ id: Number(id), text: text.trim() }));
  const segmentDraftHasEmptyText = Object.values(segmentDrafts).some(
    (text) => !text.trim()
  );
  const fullTextChanged = fullDraft.trim() !== baseFullText;
  const isDirty = editMode === "segments" ? segmentEdits.length > 0 : fullTextChanged;

  useEffect(() => {
    if (!transcript) return;

    const incomingChanged =
      transcript.transcript.id !== baseTranscriptId ||
      transcript.transcript.updated_at !== baseUpdatedAt;

    if (editMode && incomingChanged) {
      setHasConflict(true);
      return;
    }

    if (!editMode) {
      const texts = segmentTextMap(transcript);
      setSegmentDrafts(texts);
      setBaseSegmentTexts(texts);
      setDraftSegments(transcript.segments);
      setFullDraft(transcript.transcript.full_text);
      setBaseFullText(transcript.transcript.full_text);
      setBaseTranscriptId(transcript.transcript.id);
      setBaseUpdatedAt(transcript.transcript.updated_at);
      setHasConflict(false);
    }
  }, [
    transcript?.transcript.id,
    transcript?.transcript.updated_at,
    editMode,
    baseTranscriptId,
    baseUpdatedAt
  ]);

  function beginEditing(mode: Exclude<EditMode, null>) {
    if (!transcript) return;

    const texts = segmentTextMap(transcript);
    setSegmentDrafts(texts);
    setBaseSegmentTexts(texts);
    setDraftSegments(transcript.segments);
    setFullDraft(transcript.transcript.full_text);
    setBaseFullText(transcript.transcript.full_text);
    setBaseTranscriptId(transcript.transcript.id);
    setBaseUpdatedAt(transcript.transcript.updated_at);
    setHasConflict(false);
    setEditMode(mode);
  }

  function loadLatestVersion() {
    if (!transcript) return;

    const texts = segmentTextMap(transcript);
    setSegmentDrafts(texts);
    setBaseSegmentTexts(texts);
    setDraftSegments(transcript.segments);
    setFullDraft(transcript.transcript.full_text);
    setBaseFullText(transcript.transcript.full_text);
    setBaseTranscriptId(transcript.transcript.id);
    setBaseUpdatedAt(transcript.transcript.updated_at);
    setHasConflict(false);
  }

  async function cancelEditing() {
    if (isDirty) {
      const discard = await dialog.confirm({
        title: t("detail.transcript.discardTitle"),
        message: t("detail.transcript.discardMessage"),
        confirmLabel: t("detail.transcript.discardConfirm"),
        cancelLabel: t("detail.transcript.keepEditing"),
        tone: "warning"
      });
      if (!discard) return;
    }

    setEditMode(null);
    setHasConflict(false);
  }

  async function saveSegmentEdits() {
    if (
      !transcript ||
      segmentEdits.length === 0 ||
      segmentDraftHasEmptyText ||
      hasConflict
    ) {
      return;
    }

    setSaving(true);
    try {
      const outcome = await onSaveTranscriptSegments(segmentEdits, baseUpdatedAt);
      if (outcome === "saved") setEditMode(null);
      if (outcome === "conflict") setHasConflict(true);
    } finally {
      setSaving(false);
    }
  }

  async function saveFullTranscript() {
    const normalized = fullDraft.trim();
    if (!normalized || !fullTextChanged || hasConflict) return;

    setSaving(true);
    try {
      const outcome = await onSaveFullTranscript(normalized, baseUpdatedAt);
      if (outcome === "saved") setEditMode(null);
      if (outcome === "conflict") setHasConflict(true);
    } finally {
      setSaving(false);
    }
  }

  const editStatus = hasConflict
    ? t("detail.transcript.conflictStatus")
    : isDirty
      ? t("detail.transcript.dirtyStatus")
      : t("detail.transcript.cleanStatus");

  return (
    <div className="inspector-section-stack">
      <PanelCard
        title={t("common.technical.transcript")}
        actions={
          transcript ? (
            <div className="compact-actions">
              {editMode === null && transcript.segments.length > 0 && (
                <Button
                  variant="outlined"
                  size="sm"
                  onClick={() => beginEditing("segments")}
                  disabled={!canEdit}
                >
                  {t("detail.transcript.editSegments")}
                </Button>
              )}
              {editMode === null && (
                <Button
                  variant="text"
                  size="sm"
                  onClick={() => beginEditing("full")}
                  disabled={!canEdit}
                >
                  {transcript.segments.length > 0 ? t("detail.transcript.replaceFull") : t("detail.transcript.editFull")}
                </Button>
              )}
              <Button variant="outlined" size="sm" onClick={() => onExportTranscript("txt")}>
                TXT
              </Button>
              <Button variant="outlined" size="sm" onClick={() => onExportTranscript("json")}>
                JSON
              </Button>
              <Button variant="outlined" size="sm" onClick={() => onExportTranscript("srt")}>
                SRT
              </Button>
            </div>
          ) : null
        }
      >
        {!transcript && (
          <div className="transcript-empty">
            <p>{t("detail.transcript.empty")}</p>
            <Button variant="filled" onClick={onTranscribe}>
              {t("detail.transcript.start")}
            </Button>
          </div>
        )}

        {transcript && editMode && (
          <div className="transcript-editor">
            <div
              className={`transcript-edit-status ${isDirty ? "dirty" : ""} ${hasConflict ? "conflict" : ""}`}
              aria-live="polite"
            >
              <span>{editStatus}</span>
              {!canEdit && <span>{t("detail.transcript.activeTask")}</span>}
            </div>

            {hasConflict && (
              <div className="transcript-conflict" role="alert">
                <p>
                  {t("detail.transcript.conflictMessage")}
                </p>
                <Button variant="outlined" size="sm" onClick={loadLatestVersion}>
                  {t("detail.transcript.loadLatest")}
                </Button>
              </div>
            )}

            {editMode === "segments" && (
              <div className="transcript-segment-editors">
                {draftSegments.map((segment) => (
                  <div className="transcript-segment-editor" key={segment.id}>
                    <Button
                      preserveChildren
                      type="button"
                      aria-label={t("detail.transcript.playFrom", { time: formatDuration(segment.start_seconds) })}
                      onClick={() => onJumpToSegment(segment.start_seconds)}
                    >
                      {formatDuration(segment.start_seconds)}
                    </Button>
                    <TextareaField
                      label={t("detail.transcript.segmentLabel", { number: segment.segment_index + 1 })}
                      value={segmentDrafts[segment.id] ?? segment.text}
                      rows={3}
                      wide
                      disabled={saving || !canEdit || hasConflict}
                      errorText={
                        !(segmentDrafts[segment.id] ?? segment.text).trim()
                          ? t("detail.transcript.segmentRequired")
                          : undefined
                      }
                      onValueChange={(value) => {
                        setSegmentDrafts((current) => ({
                          ...current,
                          [segment.id]: value
                        }));
                      }}
                    />
                  </div>
                ))}
              </div>
            )}

            {editMode === "full" && (
              <TextareaField
                label={t("detail.transcript.fullLabel")}
                value={fullDraft}
                rows={18}
                wide
                disabled={saving || !canEdit || hasConflict}
                helperText={
                  transcript.segments.length > 0
                    ? t("detail.transcript.fullWarning")
                    : t("detail.transcript.fullHelper")
                }
                onValueChange={setFullDraft}
              />
            )}

            <div className="section-actions">
              <Button
                variant="filled"
                onClick={() =>
                  void (editMode === "segments" ? saveSegmentEdits() : saveFullTranscript())
                }
                disabled={
                  saving ||
                  !canEdit ||
                  hasConflict ||
                  !isDirty ||
                  (editMode === "segments" && segmentDraftHasEmptyText) ||
                  (editMode === "full" && !fullDraft.trim())
                }
              >
                {saving
                  ? t("detail.transcript.saving")
                  : editMode === "segments"
                    ? t("detail.transcript.saveSegments")
                    : t("detail.transcript.saveFull")}
              </Button>
              <Button
                variant="text"
                onClick={() => void cancelEditing()}
                disabled={saving}
              >
                {t("common.actions.cancel")}
              </Button>
            </div>
          </div>
        )}

        {transcript && !editMode && (
          <div className="transcript-timeline">
            {transcript.segments.length > 0 ? (
              transcript.segments.map((segment) => (
                <div key={segment.id} className="segment">
                  <Button
                    preserveChildren
                    type="button"
                    aria-label={t("detail.transcript.playFrom", { time: formatDuration(segment.start_seconds) })}
                    onClick={() => onJumpToSegment(segment.start_seconds)}
                  >
                    {formatDuration(segment.start_seconds)}
                  </Button>
                  <span>{segment.text}</span>
                </div>
              ))
            ) : (
              <p>{transcript.transcript.full_text}</p>
            )}
          </div>
        )}
      </PanelCard>
    </div>
  );
}
