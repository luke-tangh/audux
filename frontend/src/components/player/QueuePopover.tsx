import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DragEvent, FocusEvent, KeyboardEvent, RefObject } from "react";
import type { AudioItem } from "../../types";
import { displayTitle } from "../../types";
import { Button, MaterialIcon } from "../ui";

const QUEUE_DRAG_TYPE = "application/x-local-audio-queue-index";

type QueuePopoverProps = {
  queue: AudioItem[];
  queueIndex: number;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: (restoreFocus?: boolean) => void;
  onSelect: (index: number) => void;
  onRemove: (index: number) => void;
  onMove: (sourceIndex: number, targetIndex: number) => void;
  onClear: () => void;
};

export default function QueuePopover({
  queue,
  queueIndex,
  triggerRef,
  onClose,
  onSelect,
  onRemove,
  onMove,
  onClear
}: QueuePopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const managedCurrentItemRef = useRef<HTMLElement | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  useLayoutEffect(() => {
    const popover = popoverRef.current;
    if (!popover) return;

    const currentQueueItem = popover.querySelector<HTMLElement>(
      '[aria-current="true"]'
    );
    const shouldPlaceInitialFocus = managedCurrentItemRef.current === null;
    const shouldFollowCurrentItem =
      document.activeElement === managedCurrentItemRef.current;

    if (!shouldPlaceInitialFocus && !shouldFollowCurrentItem) return;

    const firstControl = popover.querySelector<HTMLElement>(
      'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );

    (currentQueueItem || firstControl || popover).focus();
    managedCurrentItemRef.current = currentQueueItem;
  }, [queue.length, queueIndex]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;

      if (!target) return;
      if (popoverRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;

      onClose(false);
    }

    document.addEventListener("pointerdown", handlePointerDown, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [onClose, triggerRef]);

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    const nextTarget = event.relatedTarget as Node | null;

    if (!nextTarget || event.currentTarget.contains(nextTarget)) return;

    window.setTimeout(() => {
      if (!popoverRef.current?.contains(document.activeElement)) {
        onClose(false);
      }
    }, 0);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
      return;
    }

    if (event.key !== "Tab") return;

    const controls = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );

    const firstControl = controls[0];
    const lastControl = controls[controls.length - 1];
    const leavingPopover =
      controls.length === 0 ||
      (event.shiftKey && document.activeElement === firstControl) ||
      (!event.shiftKey && document.activeElement === lastControl);

    if (leavingPopover) {
      window.setTimeout(() => onClose(false), 0);
    }
  }

  function handleDragStart(event: DragEvent<HTMLButtonElement>, index: number) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(QUEUE_DRAG_TYPE, String(index));
    setDraggingIndex(index);
    setDropIndex(index);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>, targetIndex: number) {
    const transferredValue = event.dataTransfer.getData(QUEUE_DRAG_TYPE);
    if (draggingIndex === null && transferredValue === "") return;

    event.preventDefault();
    const transferredIndex = Number(transferredValue);
    const sourceIndex = draggingIndex ?? transferredIndex;

    if (Number.isInteger(sourceIndex)) {
      onMove(sourceIndex, targetIndex);
    }

    setDraggingIndex(null);
    setDropIndex(null);
  }

  return (
    <div
      ref={popoverRef}
      id="player-queue-popover"
      className="queue-popover"
      role="dialog"
      aria-label="播放队列"
      tabIndex={-1}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
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
              key={item.playlist_item_id ?? `${item.id}-${index}`}
              className={[
                "queue-row",
                index === queueIndex ? "active" : "",
                index === draggingIndex ? "dragging" : "",
                index === dropIndex && index !== draggingIndex ? "drop-target" : ""
              ].filter(Boolean).join(" ")}
              role="listitem"
              onDragOver={(event) => {
                if (
                  draggingIndex === null &&
                  !event.dataTransfer.types.includes(QUEUE_DRAG_TYPE)
                ) {
                  return;
                }

                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropIndex(index);
              }}
              onDrop={(event) => handleDrop(event, index)}
            >
              <Button
                preserveChildren
                type="button"
                className="queue-drag-handle"
                draggable
                aria-label={`调整 ${displayTitle(item)} 的队列顺序`}
                title="拖拽排序；也可使用上下方向键"
                onDragStart={(event) => handleDragStart(event, index)}
                onDragEnd={() => {
                  setDraggingIndex(null);
                  setDropIndex(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowUp" && index > 0) {
                    event.preventDefault();
                    onMove(index, index - 1);
                  }

                  if (event.key === "ArrowDown" && index < queue.length - 1) {
                    event.preventDefault();
                    onMove(index, index + 1);
                  }
                }}
              >
                <MaterialIcon name="drag_indicator" size={17} />
              </Button>

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
