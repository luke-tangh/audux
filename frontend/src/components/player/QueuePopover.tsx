import type { AudioItem } from "../../types";
import { displayTitle } from "../../types";
import { Button, MaterialIcon } from "../ui";

type QueuePopoverProps = {
  queue: AudioItem[];
  queueIndex: number;
  onClose: () => void;
  onSelect: (index: number) => void;
  onRemove: (index: number) => void;
  onClear: () => void;
};

export default function QueuePopover({
  queue,
  queueIndex,
  onClose,
  onSelect,
  onRemove,
  onClear
}: QueuePopoverProps) {
  return (
    <div
      id="player-queue-popover"
      className="queue-popover"
      role="dialog"
      aria-label="播放队列"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="queue-popover-header">
        <strong>播放队列</strong>

        <Button
          preserveChildren
          type="button"
          aria-label="清空播放队列"
          onClick={onClear}
          disabled={queue.length === 0}
        >
          清空
        </Button>
      </div>

      {queue.length === 0 && <div className="queue-empty">空队列</div>}

      {queue.length > 0 && (
        <div className="queue-list" role="list">
          {queue.map((item, index) => (
            <div
              key={`${item.id}-${index}`}
              className={`queue-row ${index === queueIndex ? "active" : ""}`}
              role="listitem"
            >
              <Button
                preserveChildren
                type="button"
                className="queue-row-main"
                aria-current={index === queueIndex ? "true" : undefined}
                onClick={() => onSelect(index)}
                title={displayTitle(item)}
              >
                <span className="queue-index">
                  {index === queueIndex ? (
                    <MaterialIcon name="play_arrow" size={14} />
                  ) : (
                    index + 1
                  )}
                </span>

                <span className="queue-title">{displayTitle(item)}</span>
              </Button>

              <Button
                preserveChildren
                type="button"
                className="queue-remove"
                aria-label={`从队列移除 ${displayTitle(item)}`}
                onClick={() => onRemove(index)}
                title="从队列移除"
              >
                <MaterialIcon name="close" size={16} />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
