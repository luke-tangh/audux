import { formatDuration } from "../../types";
import { Button, MaterialIcon } from "../ui";
import { useTranslation } from "react-i18next";

type PlaybackControlsProps = {
  hasAudio: boolean;
  isPlaying: boolean;
  canPrevious: boolean;
  canNext: boolean;
  current: number;
  duration: number;
  progress: number;
  onPrevious: () => void;
  onNext: () => void;
  onToggle: () => void;
  onStop: () => void;
  onSeek: (value: number) => void;
};

export default function PlaybackControls({
  hasAudio,
  isPlaying,
  canPrevious,
  canNext,
  current,
  duration,
  progress,
  onPrevious,
  onNext,
  onToggle,
  onStop,
  onSeek
}: PlaybackControlsProps) {
  const { t } = useTranslation();
  const safeDuration = Number.isFinite(duration) ? duration : 0;

  return (
    <div className="player-center">
      <div className="player-controls" aria-label={t("player.controls")}>
        <Button
          preserveChildren
          type="button"
          className="icon-button"
          onClick={onPrevious}
          disabled={!hasAudio || !canPrevious}
          aria-label={t("player.previous")}
          title={t("player.previous")}
        >
          <MaterialIcon name="skip_previous" size={24} />
        </Button>

        <Button
          preserveChildren
          type="button"
          className="play-toggle"
          onClick={onToggle}
          disabled={!hasAudio}
          aria-label={isPlaying ? t("player.pausePlayback") : t("player.startPlayback")}
          title={isPlaying ? t("player.pause") : t("player.play")}
        >
          <span className="play-toggle-icon" aria-hidden="true">
            {isPlaying ? (
              <MaterialIcon name="pause" size={26} />
            ) : (
              <MaterialIcon name="play_arrow" size={28} />
            )}
          </span>
        </Button>

        <Button
          preserveChildren
          type="button"
          className="icon-button"
          onClick={onStop}
          disabled={!hasAudio}
          aria-label={t("player.stopLabel")}
          title={t("player.stopTitle")}
        >
          <MaterialIcon name="stop" size={22} />
        </Button>

        <Button
          preserveChildren
          type="button"
          className="icon-button"
          onClick={onNext}
          disabled={!hasAudio || !canNext}
          aria-label={t("player.next")}
          title={t("player.next")}
        >
          <MaterialIcon name="skip_next" size={24} />
        </Button>
      </div>

      <div className="player-progress">
        <span>{formatDuration(current)}</span>

        <input
          type="range"
          min={0}
          max={safeDuration || 0}
          value={Math.min(current, safeDuration || current || 0)}
          onChange={(e) => onSeek(Number(e.target.value))}
          style={{
            background: `linear-gradient(90deg, var(--md-sys-color-primary) 0%, var(--md-sys-color-tertiary) ${progress}%, var(--md-sys-color-surface-container-highest) ${progress}%, var(--md-sys-color-surface-container-highest) 100%)`
          }}
        />

        <span>{formatDuration(safeDuration)}</span>
      </div>
    </div>
  );
}
