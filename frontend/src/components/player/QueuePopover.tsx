import { useEffect, useLayoutEffect, useRef } from "react";
import type { FocusEvent, KeyboardEvent, RefObject } from "react";
import type { AudioItem } from "../../types";
import { displayTitle } from "../../types";
import { Button, MaterialIcon } from "../ui";

type QueuePopoverProps = {
  queue: AudioItem[];
  queueIndex: number;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: (restoreFocus?: boolean) => void;
  onSelect: (index: number) => void;
  onRemove: (index: number) => void;
  onClear: () => void;
};

export default function QueuePopover({
  queue,
  queueIndex,
  triggerRef,
  onClose,
  onSelect,
  onRemove,
  onClear
}: QueuePopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const initialCurrentFocusPlacedRef = useRef(false);

  useLayoutEffect(() => {
    const popover = popoverRef.current;
    if (!popover) return;

    const currentQueueItem = popover.querySelector<HTMLElement>(
      '[aria-current="true"]'
    );
    const shouldPlaceCurrentFocus =
      Boolean(currentQueueItem) && !initialCurrentFocusPlacedRef.current;

    if (
      popover.contains(document.activeElement) &&
      !shouldPlaceCurrentFocus
    ) {
      return;
    }

    const firstControl = popover.querySelector<HTMLElement>(
      'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );

    (currentQueueItem || firstControl || popover).focus();

    if (currentQueueItem) {
      initialCurrentFocusPlacedRef.current = true;
    }
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
