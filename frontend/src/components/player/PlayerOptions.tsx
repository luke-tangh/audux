import { useEffect, useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import type { AudioItem } from "../../types";
import { Button, MaterialIcon } from "../ui";
import QueuePopover from "./QueuePopover";
import { PLAYBACK_RATES } from "./playerPreferences";

type OpenOption = "speed" | "volume" | null;

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
  const [openOption, setOpenOption] = useState<OpenOption>(null);
  const speedControlRef = useRef<HTMLDivElement | null>(null);
  const speedToggleRef = useRef<HTMLButtonElement | null>(null);
  const speedOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const volumeControlRef = useRef<HTMLDivElement | null>(null);
  const volumeToggleRef = useRef<HTMLButtonElement | null>(null);
  const volumeSliderRef = useRef<HTMLInputElement | null>(null);
  const queueToggleRef = useRef<HTMLButtonElement | null>(null);
  const previousVolumeRef = useRef(volume > 0 ? volume : 1);
  const volumeIcon =
    volume === 0 ? "volume_off" : volume < 0.5 ? "volume_down" : "volume_up";

  useEffect(() => {
    if (volume > 0) previousVolumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    if (!openOption) return;

    const focusTarget = openOption === "speed"
      ? speedOptionRefs.current[
          Math.max(0, PLAYBACK_RATES.findIndex((value) => value === rate))
        ]
      : volumeSliderRef.current;
    window.requestAnimationFrame(() => focusTarget?.focus());

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (speedControlRef.current?.contains(target)) return;
      if (volumeControlRef.current?.contains(target)) return;
      setOpenOption(null);
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [openOption, rate]);

  useEffect(() => {
    if (queueOpen) setOpenOption(null);
  }, [queueOpen]);

  function closeOption(restoreFocus = false) {
    const option = openOption;
    setOpenOption(null);

    if (restoreFocus) {
      window.requestAnimationFrame(() => {
        if (option === "speed") speedToggleRef.current?.focus();
        if (option === "volume") volumeToggleRef.current?.focus();
      });
    }
  }

  function toggleOption(option: Exclude<OpenOption, null>) {
    onQueueOpenChange(false);
    setOpenOption((current) => current === option ? null : option);
  }

  function handlePopoverKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    closeOption(true);
  }

  function handleOptionBlur(
    option: Exclude<OpenOption, null>,
    event: FocusEvent<HTMLDivElement>
  ) {
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && event.currentTarget.contains(nextTarget)) return;
    if (openOption === option) setOpenOption(null);
  }

  function handleSpeedKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    handlePopoverKeyDown(event);
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      return;
    }

    event.preventDefault();
    const currentIndex = speedOptionRefs.current.findIndex(
      (element) => element === document.activeElement
    );
    const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const nextIndex =
      (Math.max(0, currentIndex) + direction + PLAYBACK_RATES.length) %
      PLAYBACK_RATES.length;
    speedOptionRefs.current[nextIndex]?.focus();
  }

  function closeQueue(restoreFocus = false) {
    onQueueOpenChange(false);

    if (restoreFocus) {
      window.requestAnimationFrame(() => queueToggleRef.current?.focus());
    }
  }

  function selectQueueItem(index: number) {
    onQueueSelect(index);
    closeQueue(true);
  }

  useEffect(() => {
    if (queueOpen && queue.length === 0) closeQueue(true);
  }, [queue.length, queueOpen]);

  return (
    <div className="player-options">
      <div
        ref={speedControlRef}
        className="player-option-control"
        onBlur={(event) => handleOptionBlur("speed", event)}
      >
        <Button
          ref={speedToggleRef}
          preserveChildren
          type="button"
          className="player-option-trigger player-speed-toggle"
          aria-label={
            openOption === "speed"
              ? t("player.closeSpeedControl")
              : t("player.openSpeedControl")
          }
          aria-haspopup="dialog"
          aria-expanded={openOption === "speed"}
          aria-controls={openOption === "speed" ? "player-speed-popover" : undefined}
          title={t("player.playbackSpeed")}
          onClick={() => toggleOption("speed")}
        >
          <MaterialIcon name="speed" size={18} />
          <span>{rate}x</span>
        </Button>

        {openOption === "speed" && (
          <div
            id="player-speed-popover"
            className="player-option-popover player-speed-popover"
            role="dialog"
            aria-label={t("player.playbackSpeed")}
            onKeyDown={handleSpeedKeyDown}
          >
            <strong>{t("player.playbackSpeed")}</strong>
            <div
              className="player-speed-options"
              role="radiogroup"
              aria-label={t("player.playbackSpeed")}
            >
              {PLAYBACK_RATES.map((value, index) => (
                <button
                  key={value}
                  ref={(element) => {
                    speedOptionRefs.current[index] = element;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={rate === value}
                  className={rate === value ? "selected" : ""}
                  onClick={() => {
                    onRateChange(value);
                    closeOption(true);
                  }}
                >
                  {value}x
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div
        ref={volumeControlRef}
        className="player-option-control"
        onBlur={(event) => handleOptionBlur("volume", event)}
      >
        <Button
          ref={volumeToggleRef}
          preserveChildren
          type="button"
          className="player-option-trigger player-volume-toggle"
          aria-label={
            openOption === "volume"
              ? t("player.closeVolumeControl")
              : t("player.openVolumeControl")
          }
          aria-haspopup="dialog"
          aria-expanded={openOption === "volume"}
          aria-controls={openOption === "volume" ? "player-volume-popover" : undefined}
          title={t("player.volume")}
          onClick={() => toggleOption("volume")}
        >
          <MaterialIcon name={volumeIcon} size={18} />
        </Button>

        {openOption === "volume" && (
          <div
            id="player-volume-popover"
            className="player-option-popover player-volume-popover"
            role="dialog"
            aria-label={t("player.volume")}
            onKeyDown={handlePopoverKeyDown}
          >
            <div className="player-volume-header">
              <strong>{t("player.volume")}</strong>
              <span>{Math.round(volume * 100)}%</span>
            </div>
            <div className="player-volume-slider-row">
              <Button
                preserveChildren
                type="button"
                className="player-volume-mute"
                aria-label={volume === 0 ? t("player.unmute") : t("player.mute")}
                title={volume === 0 ? t("player.unmute") : t("player.mute")}
                onClick={() =>
                  onVolumeChange(volume === 0 ? previousVolumeRef.current : 0)
                }
              >
                <MaterialIcon name={volumeIcon} size={20} />
              </Button>
              <input
                ref={volumeSliderRef}
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                aria-label={t("player.volume")}
                aria-valuetext={t("player.volumeValue", {
                  value: Math.round(volume * 100)
                })}
                onChange={(event) => onVolumeChange(Number(event.target.value))}
              />
            </div>
          </div>
        )}
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
          onClick={() => {
            setOpenOption(null);
            onQueueOpenChange((value) => !value);
          }}
          disabled={queue.length === 0}
        >
          <MaterialIcon name="queue_music" size={18} />
          <span>{queue.length > 0 ? `${queueIndex + 1}/${queue.length}` : "0"}</span>
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
