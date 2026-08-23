import { useState } from "react";
import { useTranslation } from "react-i18next";

import { MAX_BATCH_SELECTION } from "../../constants";
import type { AudioItem } from "../../types";

type UseAudioSelectionOptions = {
  items: AudioItem[];
  notify: (message: string, tone?: "info" | "success" | "error") => void;
};

export function useAudioSelection({ items, notify }: UseAudioSelectionOptions) {
  const { t } = useTranslation();
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedAudioIds, setSelectedAudioIds] = useState<Set<number>>(
    () => new Set()
  );

  function clear() {
    setSelectedAudioIds(new Set());
  }

  function enter() {
    setSelectionMode(true);
  }

  function exit() {
    setSelectionMode(false);
    clear();
  }

  function reset() {
    setSelectionMode(false);
    clear();
  }

  function toggle(audioId: number) {
    if (
      !selectedAudioIds.has(audioId) &&
      selectedAudioIds.size >= MAX_BATCH_SELECTION
    ) {
      notify(t("library.selection.maximum", { count: MAX_BATCH_SELECTION }), "info");
      return;
    }

    setSelectedAudioIds((current) => {
      const next = new Set(current);
      if (next.has(audioId)) next.delete(audioId);
      else next.add(audioId);
      return next;
    });
  }

  function toggleAllLoaded() {
    const selectableItems = items.slice(0, MAX_BATCH_SELECTION);
    const allSelectableSelected =
      selectableItems.length > 0 &&
      selectableItems.every((item) => selectedAudioIds.has(item.id));

    if (!allSelectableSelected && items.length > MAX_BATCH_SELECTION) {
      notify(t("library.selection.firstSelected", { count: MAX_BATCH_SELECTION }), "info");
    }

    setSelectedAudioIds((current) => {
      const allLoadedSelected =
        selectableItems.length > 0 &&
        selectableItems.every((item) => current.has(item.id));
      return allLoadedSelected
        ? new Set()
        : new Set(selectableItems.map((item) => item.id));
    });
  }

  function remove(audioId: number) {
    setSelectedAudioIds((current) => {
      if (!current.has(audioId)) return current;
      const next = new Set(current);
      next.delete(audioId);
      return next;
    });
  }

  return {
    selectionMode,
    selectedAudioIds,
    clear,
    enter,
    exit,
    reset,
    toggle,
    toggleAllLoaded,
    remove
  };
}
