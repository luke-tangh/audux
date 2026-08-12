import { useEffect, useRef } from "react";
import type { AudioItem } from "../../types";
import { Button, MaterialIcon, SelectField } from "../ui";
import QueuePopover from "./QueuePopover";
import { useTranslation } from "react-i18next";

const PLAYBACK_RATE_OPTIONS = [0.75, 1, 1.25, 1.5, 2].map((value) => ({
  value: String(value),
  label: `${value}x`
}));

type PlayerOptionsProps = {
  rate: number;
  volume: number;
  queue: AudioItem[];
  queueIndex: number;
  queueOpen: boolean;
  onRateChange: (value: number) => void;
  onVolumeChange: (value: number) => void;
  onQueueOpenChange: (value: boolean | ((current: boolean) => boolean)) => void;
  onQueueSelect: (index: number) => void;
  onQueueRemove: (index: number) => void;
  onQueueMove: (sourceIndex: number, targetIndex: number) => void;
  onQueueClear: () => void;
};

export default function PlayerOptions({
  rate,
  volume,
  queue,
  queueIndex,
  queueOpen,
  onRateChange,
  onVolumeChange,
  onQueueOpenChange,
  onQueueSelect,
  onQueueRemove,
  onQueueMove,
  onQueueClear
}: PlayerOptionsProps) {
  const { t } = useTranslation();
  const queueToggleRef = useRef<HTMLButtonElement | null>(null);
  const previousVolumeRef = useRef(volume > 0 ? volume : 1);
  const volumeIcon =
    volume === 0 ? "volume_off" : volume < 0.5 ? "volume_down" : "volume_up";

  useEffect(() => {
    if (volume > 0) previousVolumeRef.current = volume;
  }, [volume]);

  function closeQueue(restoreFocus = false) {
    onQueueOpenChange(false);

    if (restoreFocus) {
      window.requestAnimationFrame(() => {
        queueToggleRef.current?.focus();
      });
    }
  }

  function selectQueueItem(index: number) {
    onQueueSelect(index);
    closeQueue(true);
  }

  useEffect(() => {
    if (queueOpen && queue.length === 0) {
      closeQueue(true);
    }
  }, [queue.length, queueOpen]);

  return (
    <div className="player-options">
      <SelectField
        density="compact"
        controlSize="mini"
        controlWidth={118}
        controlMinWidth={112}
        controlMaxWidth={132}
        controlRadius="var(--md-sys-shape-corner-full)"
        menuWidth="control"
        menuMinWidth={118}
        label={t("player.speed")}
        value={String(rate)}
        options={PLAYBACK_RATE_OPTIONS}
        aria-label={t("player.playbackSpeed")}
        title={t("player.playbackSpeed")}
        onValueChange={(value) => onRateChange(Number(value))}
      />

      <div className="player-volume-control">
        <Button
          preserveChildren
          type="button"
          className="player-volume-toggle"
          aria-label={volume === 0 ? t("player.unmute") : t("player.mute")}
          title={volume === 0 ? t("player.unmute") : t("player.mute")}
          onClick={() =>
            onVolumeChange(volume === 0 ? previousVolumeRef.current : 0)
          }
        >
          <MaterialIcon name={volumeIcon} size={18} />
        </Button>

        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          aria-label={t("player.volume")}
          aria-valuetext={t("player.volumeValue", {
            value: Math.round(volume * 100)
          })}
          onChange={(e) => onVolumeChange(Number(e.target.value))}
        />
      </div>

      <div className="queue-control">
        <Button
          ref={queueToggleRef}
          preserveChildren
          type="button"
          className="queue-toggle-button"
          aria-label={queueOpen ? t("player.closeQueue") : t("player.openQueue")}
          aria-haspopup="dialog"
          aria-expanded={queueOpen}
          aria-controls="player-queue-popover"
          onClick={() => onQueueOpenChange((value) => !value)}
          disabled={queue.length === 0}
        >
          {t("player.queue")} {queue.length > 0 ? `${queueIndex + 1}/${queue.length}` : ""}
        </Button>

        {queueOpen && (
          <QueuePopover
            queue={queue}
            queueIndex={queueIndex}
            triggerRef={queueToggleRef}
            onClose={closeQueue}
            onSelect={selectQueueItem}
            onRemove={onQueueRemove}
            onMove={onQueueMove}
            onClear={() => {
              onQueueClear();
              closeQueue(true);
            }}
          />
        )}
      </div>
    </div>
  );
}
