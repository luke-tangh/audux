import { useEffect, useState } from "react";
import type {
  Transcript,
  TranscriptRevisionSummary,
  TranscriptSegment,
  TranscriptSegmentEdit
} from "../../types";
import { api } from "../../api";
import { formatDuration } from "../../types";
import { useDialog } from "../dialog/UnifiedDialog";
import { Button, PanelCard, TextareaField } from "../ui";
import { useTranslation } from "react-i18next";

type SaveOutcome = "saved" | "conflict" | "error";
type EditMode = "segments" | "full" | null;

type TranscriptTabProps = {
  audioId: number;
  transcript: Transcript | null;
  onTranscriptChanged: (transcript: Transcript) => void;
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
  audioId,
  transcript,
  onTranscriptChanged,
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
  const [revisions, setRevisions] = useState<TranscriptRevisionSummary[]>([]);
  const [selectedChapterIds, setSelectedChapterIds] = useState<number[]>([]);
  const [managing, setManaging] = useState(false);

  useEffect(() => {
    if (!transcript) {
      setRevisions([]);
      return;
    }
    void api.listTranscriptRevisions(audioId).then(setRevisions).catch(() => setRevisions([]));
  }, [audioId, transcript?.transcript.id]);

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

  async function reloadAfterManagement() {
    const latest = await api.getTranscript(audioId);
    onTranscriptChanged(latest);
  }

  async function runManagement(action: () => Promise<unknown>) {
    setManaging(true);
    try {
      await action();
      await reloadAfterManagement();
    } catch (error) {
      await dialog.alert({
        title: t("detail.transcript.managementFailed"),
        message: error instanceof Error ? error.message : String(error),
        tone: "warning"
      });
    } finally {
      setManaging(false);
    }
  }

  async function addChapter() {
    if (!transcript || transcript.segments.length === 0) return;
    const title = await dialog.prompt({
      title: t("detail.transcript.addChapter"),
      inputLabel: t("detail.transcript.chapterTitle"),
      required: true
    });
    if (!title?.trim()) return;
    const first = transcript.segments[0];
    const last = transcript.segments[transcript.segments.length - 1];
    await runManagement(() =>
      api.createTranscriptChapter(audioId, {
        expected_revision_id: transcript.transcript.id,
        title: title.trim(),
        start_seconds: first.start_seconds,
        end_seconds: last.end_seconds
      })
    );
  }

  async function editChapter(chapterId: number) {
    const chapter = transcript?.chapters?.find((row) => row.id === chapterId);
    if (!chapter) return;
    const value = await dialog.prompt({
      title: t("detail.transcript.editChapter"),
      message: t("detail.transcript.chapterEditHint"),
      defaultValue: `${chapter.title} | ${chapter.start_seconds} | ${chapter.end_seconds}`,
      required: true,
      validate: (input) => {
        const parts = input.split("|").map((part) => part.trim());
        const start = Number(parts[1]);
        const end = Number(parts[2]);
        return parts.length === 3 && parts[0] && Number.isFinite(start) && end > start
          ? null
          : t("detail.transcript.chapterEditInvalid");
      }
    });
    if (!value) return;
    const [title, start, end] = value.split("|").map((part) => part.trim());
    await runManagement(() =>
      api.updateTranscriptChapter(audioId, chapterId, {
        title,
        start_seconds: Number(start),
        end_seconds: Number(end)
      })
    );
  }

  async function removeChapter(chapterId: number) {
    const confirmed = await dialog.confirm({
      title: t("detail.transcript.deleteChapter"),
      message: t("detail.transcript.deleteChapterMessage"),
      confirmLabel: t("common.actions.delete"),
      tone: "danger",
      destructive: true
    });
    if (!confirmed) return;
    await runManagement(() => api.deleteTranscriptChapter(audioId, chapterId));
  }

  async function mergeSelectedChapters() {
    if (selectedChapterIds.length < 2) return;
    await runManagement(() =>
      api.mergeTranscriptChapters(audioId, selectedChapterIds)
    );
    setSelectedChapterIds([]);
  }

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

      {transcript && (
        <PanelCard
          title={t("detail.transcript.revisionTitle")}
          actions={
            <Button
              variant="outlined"
              size="sm"
              disabled={managing}
              onClick={() => void runManagement(() => api.validateTranscript(audioId))}
            >
              {t("detail.transcript.validate")}
            </Button>
          }
        >
          <dl className="transcript-revision-metadata">
            <div>
              <dt>{t("detail.transcript.revisionNumber")}</dt>
              <dd>#{transcript.transcript.revision_number}</dd>
            </div>
            <div>
              <dt>{t("detail.transcript.source")}</dt>
              <dd>{transcript.transcript.source_type}</dd>
            </div>
            <div>
              <dt>{t("detail.transcript.provider")}</dt>
              <dd>{transcript.transcript.provider_name || transcript.transcript.model_name || "—"}</dd>
            </div>
          </dl>
          {revisions.length > 1 && (
            <details className="transcript-revision-history">
              <summary>{t("detail.transcript.history", { count: revisions.length })}</summary>
              <ol>
                {revisions.map((revision) => (
                  <li key={revision.id}>
                    #{revision.revision_number} · {revision.source_type} · {revision.generated_at}
                  </li>
                ))}
              </ol>
            </details>
          )}
          {(transcript.issues || []).length === 0 ? (
            <p>{t("detail.transcript.noIssues")}</p>
          ) : (
            <ul className="transcript-issue-list">
              {(transcript.issues || []).map((issue) => (
                <li key={issue.id}>
                  <span>{issue.severity} · {issue.code} · {issue.status}</span>
                  {issue.status === "open" && (
                    <div className="compact-actions">
                      <Button
                        variant="text"
                        size="sm"
                        disabled={managing}
                        onClick={() => void runManagement(() =>
                          api.updateTranscriptIssue(audioId, issue.id, "resolved", "user_confirmed")
                        )}
                      >
                        {t("detail.transcript.resolveIssue")}
                      </Button>
                      <Button
                        variant="text"
                        size="sm"
                        disabled={managing}
                        onClick={() => void runManagement(() =>
                          api.updateTranscriptIssue(audioId, issue.id, "dismissed", "user_dismissed")
                        )}
                      >
                        {t("detail.transcript.dismissIssue")}
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </PanelCard>
      )}

      {transcript && transcript.segments.length > 0 && (
        <PanelCard
          title={t("detail.transcript.chapters")}
          actions={
            <div className="compact-actions">
              <Button variant="outlined" size="sm" disabled={managing} onClick={() => void addChapter()}>
                {t("detail.transcript.addChapter")}
              </Button>
              <Button
                variant="text"
                size="sm"
                disabled={managing || selectedChapterIds.length < 2}
                onClick={() => void mergeSelectedChapters()}
              >
                {t("detail.transcript.mergeChapters")}
              </Button>
            </div>
          }
        >
          {(transcript.chapters || []).length === 0 ? (
            <p>{t("detail.transcript.noChapters")}</p>
          ) : (
            <ul className="transcript-chapter-list">
              {(transcript.chapters || []).map((chapter) => (
                <li key={chapter.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedChapterIds.includes(chapter.id)}
                      onChange={(event) => setSelectedChapterIds((current) =>
                        event.target.checked
                          ? [...current, chapter.id]
                          : current.filter((id) => id !== chapter.id)
                      )}
                    />
                    <button type="button" onClick={() => onJumpToSegment(chapter.start_seconds)}>
                      {formatDuration(chapter.start_seconds)}–{formatDuration(chapter.end_seconds)}
                    </button>
                    <span>{chapter.title}</span>
                  </label>
                  <div className="compact-actions">
                    <Button variant="text" size="sm" onClick={() => void editChapter(chapter.id)}>
                      {t("common.actions.edit")}
                    </Button>
                    <Button variant="text" size="sm" onClick={() => void removeChapter(chapter.id)}>
                      {t("common.actions.delete")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </PanelCard>
      )}
    </div>
  );
}
