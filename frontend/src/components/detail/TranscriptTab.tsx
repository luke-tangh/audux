import type { Transcript } from "../../types";
import { formatDuration } from "../../types";
import { Button, PanelCard } from "../ui";

type TranscriptTabProps = {
  transcript: Transcript | null;
  onTranscribe: () => void;
  onExportTranscript: (format: "txt" | "json" | "srt") => void;
  onJumpToSegment: (startSeconds: number) => void;
};

export default function TranscriptTab({
  transcript,
  onTranscribe,
  onExportTranscript,
  onJumpToSegment
}: TranscriptTabProps) {
  return (
    <div className="inspector-section-stack">
      <PanelCard
        title="Transcript"
        actions={
          transcript ? (
            <div className="compact-actions">
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

        {transcript && (
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
