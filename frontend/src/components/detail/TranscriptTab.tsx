import { useEffect, useState } from "react";
import type {
  Transcript,
  TranscriptSegment,
  TranscriptSegmentEdit
} from "../../types";
import { formatDuration } from "../../types";
import { useDialog } from "../dialog/UnifiedDialog";
import { Button, PanelCard, TextareaField } from "../ui";

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
        title: "放弃未保存修改？",
        message: "当前 Transcript 草稿尚未保存，放弃后无法恢复。",
        confirmLabel: "放弃修改",
        cancelLabel: "继续编辑",
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
    ? "服务器版本已更新，当前草稿未保存"
    : isDirty
      ? "有未保存修改"
      : "尚未修改";

  return (
    <div className="inspector-section-stack">
      <PanelCard
        title="Transcript"
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
                  编辑分段
                </Button>
              )}
              {editMode === null && (
                <Button
                  variant="text"
                  size="sm"
                  onClick={() => beginEditing("full")}
                  disabled={!canEdit}
                >
                  {transcript.segments.length > 0 ? "替换全文" : "编辑全文"}
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
            <p>暂无 transcript。</p>
            <Button variant="filled" onClick={onTranscribe}>
              开始转写
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
              {!canEdit && <span>转写任务进行中，暂时无法保存。</span>}
            </div>

            {hasConflict && (
              <div className="transcript-conflict" role="alert">
                <p>
                  服务器上的 Transcript 已在你编辑期间更新。为避免覆盖新内容，请加载最新版本后重新检查。
                </p>
                <Button variant="outlined" size="sm" onClick={loadLatestVersion}>
                  放弃草稿并加载最新版本
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
                      aria-label={`从 ${formatDuration(segment.start_seconds)} 开始播放`}
                      onClick={() => onJumpToSegment(segment.start_seconds)}
                    >
                      {formatDuration(segment.start_seconds)}
                    </Button>
                    <TextareaField
                      label={`第 ${segment.segment_index + 1} 段文本`}
                      value={segmentDrafts[segment.id] ?? segment.text}
                      rows={3}
                      wide
                      disabled={saving || !canEdit || hasConflict}
                      errorText={
                        !(segmentDrafts[segment.id] ?? segment.text).trim()
                          ? "分段文本不能为空"
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
                label="Transcript 全文（高级替换）"
                value={fullDraft}
                rows={18}
                wide
                disabled={saving || !canEdit || hasConflict}
                helperText={
                  transcript.segments.length > 0
                    ? "这是高级操作：保存后会清除现有时间轴分段。优先使用“编辑分段”保留时间轴。"
                    : "修改会同步更新全文搜索索引。"
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
                  ? "保存中…"
                  : editMode === "segments"
                    ? "保存分段修订"
                    : "保存全文替换"}
              </Button>
              <Button
                variant="text"
                onClick={() => void cancelEditing()}
                disabled={saving}
              >
                取消
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
                    aria-label={`从 ${formatDuration(segment.start_seconds)} 开始播放`}
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
