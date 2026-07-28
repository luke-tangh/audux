import type { AudioItem } from "../../types";
import { Button, MaterialIcon, SelectField } from "../ui";
import QueuePopover from "./QueuePopover";

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
  onQueueClear
}: PlayerOptionsProps) {
  function closeQueue() {
    onQueueOpenChange(false);
  }

  function selectQueueItem(index: number) {
    onQueueSelect(index);
    closeQueue();
  }

  return (
    <div className="player-options">
      <SelectField
        density="compact"
        controlSize="mini"
        controlWidth={92}
        controlMinWidth={88}
        controlMaxWidth={104}
        controlRadius="var(--md-sys-shape-corner-full)"
        menuWidth="control"
        menuMinWidth={92}
        label="速度"
        value={String(rate)}
        options={PLAYBACK_RATE_OPTIONS}
        aria-label="播放速度"
        title="播放速度"
        onValueChange={(value) => onRateChange(Number(value))}
      />

      <label className="player-volume-control">
        <span className="player-volume-icon" aria-hidden="true">
          <MaterialIcon name="volume_up" size={18} />
        </span>

        <span className="sr-only">音量</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => onVolumeChange(Number(e.target.value))}
        />
      </label>

      <div className="queue-control">
        <Button
          preserveChildren
          type="button"
          className="queue-toggle-button"
          aria-label="打开播放队列"
          aria-haspopup="dialog"
          aria-expanded={queueOpen}
          aria-controls="player-queue-popover"
          onClick={() => onQueueOpenChange((value) => !value)}
          disabled={queue.length === 0}
        >
          队列 {queue.length > 0 ? `${queueIndex + 1}/${queue.length}` : ""}
        </Button>

        {queueOpen && (
          <QueuePopover
            queue={queue}
            queueIndex={queueIndex}
            onClose={closeQueue}
            onSelect={selectQueueItem}
            onRemove={onQueueRemove}
            onClear={() => {
              onQueueClear();
              closeQueue();
            }}
          />
        )}
      </div>
    </div>
  );
}
