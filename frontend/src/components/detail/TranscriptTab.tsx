import { useEffect, useState } from "react";
import type { Transcript } from "../../types";
import { formatDuration } from "../../types";
import { Button, PanelCard, TextareaField } from "../ui";

type TranscriptTabProps = {
  transcript: Transcript | null;
  onTranscribe: () => void;
  onExportTranscript: (format: "txt" | "json" | "srt") => void;
  onJumpToSegment: (startSeconds: number) => void;
  onSaveTranscript: (fullText: string) => Promise<boolean>;
  canEdit: boolean;
};

export default function TranscriptTab({
  transcript,
  onTranscribe,
  onExportTranscript,
  onJumpToSegment,
  onSaveTranscript,
  canEdit
}: TranscriptTabProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEditing(false);
    setDraft(transcript?.transcript.full_text || "");
  }, [transcript?.transcript.id, transcript?.transcript.updated_at]);

  async function saveTranscript() {
    const normalized = draft.trim();
    if (!normalized || normalized === transcript?.transcript.full_text) return;

    setSaving(true);
    try {
      const saved = await onSaveTranscript(normalized);
      if (saved) setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="inspector-section-stack">
      <PanelCard
        title="Transcript"
        actions={
          transcript ? (
            <div className="compact-actions">
              <Button
                variant="outlined"
                size="sm"
                onClick={() => {
                  setDraft(transcript.transcript.full_text);
                  setEditing(true);
                }}
                disabled={!canEdit || editing}
              >
                编辑
              </Button>
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

        {transcript && editing && (
          <div className="transcript-editor">
            <TextareaField
              label="Transcript 全文"
              value={draft}
              rows={18}
              wide
              disabled={saving}
              helperText={
                transcript.segments.length > 0
                  ? "保存手动全文后，现有时间轴分段会清除，避免时间戳与文字不一致。"
                  : "修改会同步更新全文搜索索引。"
              }
              onValueChange={setDraft}
            />

            <div className="section-actions">
              <Button
                variant="filled"
                onClick={() => void saveTranscript()}
                disabled={saving || !draft.trim() || draft.trim() === transcript.transcript.full_text}
              >
                {saving ? "保存中…" : "保存修订"}
              </Button>
              <Button
                variant="text"
                onClick={() => {
                  setDraft(transcript.transcript.full_text);
                  setEditing(false);
                }}
                disabled={saving}
              >
                取消
              </Button>
            </div>
          </div>
        )}

        {transcript && !editing && (
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
