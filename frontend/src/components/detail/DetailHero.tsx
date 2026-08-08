import { api } from "../../api";
import type { AudioItem } from "../../types";
import { displayAuthor, displayTitle, formatDuration } from "../../types";
import { Button, MaterialIcon, StatusPill } from "../ui";

type DetailHeroProps = {
  audio: AudioItem;
  coverVersion: number;
  onPlay: (audio: AudioItem) => void;
  onAddToQueue: (audio: AudioItem) => void;
  onPlayNext: (audio: AudioItem) => void;
  onTranscribe: () => void;
  onAnalyze: () => void;
  onUploadCover: (file?: File) => void;
};

export default function DetailHero({
  audio,
  coverVersion,
  onPlay,
  onAddToQueue,
  onPlayNext,
  onTranscribe,
  onAnalyze,
  onUploadCover
}: DetailHeroProps) {
  return (
    <div className="inspector-hero">
      <div className="inspector-cover">
        {audio.cover_path ? (
          <img
            key={`${audio.id}-${coverVersion}`}
            src={api.coverUrl(audio.id, coverVersion)}
            alt=""
            onLoad={(e) => {
              e.currentTarget.style.display = "";
            }}
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        ) : (
          <MaterialIcon name="music_note" size={50} />
        )}
      </div>

      <div className="inspector-title">
        <h2>{displayTitle(audio)}</h2>
        <p>
          {displayAuthor(audio) || "Unknown"} · {formatDuration(audio.duration_seconds)}
        </p>

        <div className="detail-meta-strip">
          <span>{audio.file_ext || "audio"}</span>
          <span>{audio.is_missing ? "文件缺失" : "文件可用"}</span>
          <StatusPill label="转写" value={audio.transcript_status} />
          <StatusPill label="AI" value={audio.ai_status} />
        </div>
      </div>

      <div className="inspector-actions">
        <Button variant="filled" onClick={() => onPlay(audio)} disabled={audio.is_missing}>
          播放
        </Button>
        <Button
          variant="tonal"
          onClick={() => onPlayNext(audio)}
          disabled={audio.is_missing}
        >
          下一首播放
        </Button>
        <Button
          variant="outlined"
          onClick={() => onAddToQueue(audio)}
          disabled={audio.is_missing}
        >
          加入队列
        </Button>
        <Button variant="text" onClick={onTranscribe}>
          转写
        </Button>
        <Button variant="text" onClick={onAnalyze}>
          AI 分析
        </Button>
        <label className="upload-button">
          封面
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => onUploadCover(e.currentTarget.files?.[0])}
          />
        </label>
      </div>
    </div>
  );
}
