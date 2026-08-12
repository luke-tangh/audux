import { api } from "../../api";
import type { AudioItem } from "../../types";
import { displayAuthor, displayTitle, formatDuration } from "../../types";
import { ActionMenu, Button, IconButton, MaterialIcon, StatusPill } from "../ui";
import { useTranslation } from "react-i18next";

type DetailHeroProps = {
  audio: AudioItem;
  coverVersion: number;
  onPlay: (audio: AudioItem) => void;
  onAddToQueue: (audio: AudioItem) => void;
  onPlayNext: (audio: AudioItem) => void;
  onTranscribe: () => void;
  onAnalyze: () => void;
  onClose: () => void;
};

export default function DetailHero({
  audio,
  coverVersion,
  onPlay,
  onAddToQueue,
  onPlayNext,
  onTranscribe,
  onAnalyze,
  onClose
}: DetailHeroProps) {
  const { t } = useTranslation();
  return (
    <div className="inspector-hero">
      <IconButton
        className="inspector-close-button"
        variant="soft"
        label={t("detail.close")}
        onClick={onClose}
      >
        <MaterialIcon name="close" size={20} />
      </IconButton>

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
          {displayAuthor(audio) || t("common.empty.unknownAuthor")} ·{" "}
          {formatDuration(audio.duration_seconds)}
        </p>

        <div className="detail-meta-strip">
          <span>{audio.file_ext || t("common.media.audio")}</span>
          <span>
            {audio.is_missing ? t("detail.hero.missing") : t("detail.hero.available")}
          </span>
          <StatusPill label={t("detail.hero.transcript")} value={audio.transcript_status} />
          <StatusPill label={t("common.technical.ai")} value={audio.ai_status} />
        </div>
      </div>

      <div className="inspector-actions">
        <Button variant="filled" onClick={() => onPlay(audio)} disabled={audio.is_missing}>
          {t("detail.hero.play")}
        </Button>
        <Button
          variant="tonal"
          onClick={() => onPlayNext(audio)}
          disabled={audio.is_missing}
        >
          {t("detail.hero.playNext")}
        </Button>
        <Button
          variant="outlined"
          onClick={() => onAddToQueue(audio)}
          disabled={audio.is_missing}
        >
          {t("detail.hero.addQueue")}
        </Button>
        <ActionMenu
          label={t("detail.hero.moreActions")}
          buttonText={t("common.actions.more")}
          items={[
            {
              id: "transcribe",
              label: t("detail.hero.transcript"),
              icon: "subtitles",
              onSelect: onTranscribe
            },
            {
              id: "analyze",
              label: t("detail.hero.analyze"),
              icon: "auto_awesome",
              onSelect: onAnalyze
            }
          ]}
        />
      </div>
    </div>
  );
}
