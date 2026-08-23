import { useState } from "react";
import { useTranslation } from "react-i18next";

import { api } from "../../api";
import { useDialog } from "../../components/dialog/UnifiedDialog";
import type { SavedView, SavedViewQuery, Tag } from "../../types";
import type { ToastType } from "../useToast";
import { buildSavedViewQuery, savedViewQueriesEqual } from "./filters";
import type { MissingFilter, SortMode, TranscriptFilter, ViewMode } from "./types";

type SavedViewControllerOptions = {
  view: ViewMode;
  setView: (view: ViewMode) => void;
  q: string;
  setQ: (value: string) => void;
  selectedTag?: string;
  setSelectedTag: (tag?: string) => void;
  includedTagIds: number[];
  setIncludedTagIds: (ids: number[]) => void;
  excludedTagIds: number[];
  setExcludedTagIds: (ids: number[]) => void;
  tagMode: "and" | "or";
  setTagMode: (mode: "and" | "or") => void;
  selectedLibraryRootId?: number;
  setSelectedLibraryRootId: (id?: number) => void;
  setSelectedPlaylistId: (id: number | null) => void;
  hasTranscriptFilter: TranscriptFilter;
  setHasTranscriptFilter: (filter: TranscriptFilter) => void;
  missingFilter: MissingFilter;
  setMissingFilter: (filter: MissingFilter) => void;
  sortMode: SortMode;
  setSortMode: (sort: SortMode) => void;
  tags: Tag[];
  savedViews: SavedView[];
  loadNavigation: () => Promise<unknown>;
  notify: (message: string, type?: ToastType) => void;
};

function isSavableView(view: ViewMode): view is SavedViewQuery["view"] {
  return !["playlist", "settings", "statistics", "agent", "organization"].includes(view);
}

export function useSavedViewController({
  view,
  setView,
  q,
  setQ,
  selectedTag,
  setSelectedTag,
  includedTagIds,
  setIncludedTagIds,
  excludedTagIds,
  setExcludedTagIds,
  tagMode,
  setTagMode,
  selectedLibraryRootId,
  setSelectedLibraryRootId,
  setSelectedPlaylistId,
  hasTranscriptFilter,
  setHasTranscriptFilter,
  missingFilter,
  setMissingFilter,
  sortMode,
  setSortMode,
  tags,
  savedViews,
  loadNavigation,
  notify
}: SavedViewControllerOptions) {
  const { t } = useTranslation();
  const dialog = useDialog();
  const [activeSavedViewId, setActiveSavedViewId] = useState<number | null>(null);
  const activeSavedView = savedViews.find((row) => row.id === activeSavedViewId);

  function currentQuery(): SavedViewQuery | null {
    if (!isSavableView(view)) return null;
    const tagId = tags.find((tag) => tag.name === selectedTag)?.id;
    return buildSavedViewQuery({
      view,
      q,
      tagId,
      tagIds: includedTagIds,
      excludedTagIds,
      tagMode,
      libraryRootId: selectedLibraryRootId,
      transcriptFilter: hasTranscriptFilter,
      missingFilter,
      sort: sortMode
    });
  }

  const query = currentQuery();
  const isDirty = Boolean(
    activeSavedView?.query &&
      query &&
      !savedViewQueriesEqual(activeSavedView.query, query)
  );

  function deactivate() {
    setActiveSavedViewId(null);
  }

  function apply(savedView: SavedView) {
    if (!savedView.query) {
      setActiveSavedViewId(savedView.id);
      notify(t("savedViews.definitionInvalid"), "error");
      return;
    }

    const invalidTag = savedView.invalid_references.includes("tag");
    const invalidRoot = savedView.invalid_references.includes("library_root");
    setView(savedView.query.view);
    setQ(savedView.query.q);
    setSelectedTag(invalidTag ? undefined : savedView.tag_name || undefined);
    setIncludedTagIds(invalidTag ? [] : savedView.query.tag_ids || []);
    setExcludedTagIds(invalidTag ? [] : savedView.query.excluded_tag_ids || []);
    setTagMode(savedView.query.tag_mode || "and");
    setSelectedLibraryRootId(
      invalidRoot ? undefined : savedView.query.library_root_id ?? undefined
    );
    setHasTranscriptFilter(savedView.query.transcript_filter);
    setMissingFilter(savedView.query.missing_filter);
    setSortMode(savedView.query.sort);
    setSelectedPlaylistId(null);
    setActiveSavedViewId(savedView.id);

    if (savedView.invalid_references.length > 0) {
      const conditions = savedView.invalid_references
        .map((reference) =>
          reference === "tag"
            ? t("savedViews.tagCondition")
            : t("savedViews.libraryRootCondition")
        )
        .join(t("savedViews.conditionSeparator"));
      notify(t("savedViews.invalidReferences", { conditions }), "info");
    }
  }

  async function saveCurrent() {
    const nextQuery = currentQuery();
    if (!nextQuery) {
      notify(t("savedViews.unsupportedView"), "info");
      return;
    }
    const name = await dialog.prompt({
      title: t("savedViews.createTitle"),
      message: t("savedViews.createMessage"),
      inputLabel: t("savedViews.name"),
      required: true,
      confirmLabel: t("savedViews.createConfirm"),
      cancelLabel: t("common.actions.cancel"),
      validate: (value) => (value.trim() ? null : t("savedViews.nameRequired"))
    });
    if (name === null) return;
    try {
      const created = await api.createSavedView(name.trim(), nextQuery);
      setActiveSavedViewId(created.id);
      await loadNavigation();
      notify(t("savedViews.created"), "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function updateActive() {
    const nextQuery = currentQuery();
    if (!activeSavedView || !nextQuery) return;
    try {
      await api.updateSavedView(activeSavedView.id, { query: nextQuery });
      await loadNavigation();
      notify(t("savedViews.updated"), "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function rename(savedView: SavedView) {
    const name = await dialog.prompt({
      title: t("savedViews.renameTitle"),
      message: t("savedViews.renameMessage", { name: savedView.name }),
      inputLabel: t("savedViews.name"),
      defaultValue: savedView.name,
      required: true,
      confirmLabel: t("common.actions.save"),
      cancelLabel: t("common.actions.cancel"),
      validate: (value) => {
        if (!value.trim()) return t("savedViews.nameRequired");
        if (value.trim() === savedView.name) return t("savedViews.nameDifferent");
        return null;
      }
    });
    if (name === null) return;
    try {
      await api.updateSavedView(savedView.id, { name: name.trim() });
      await loadNavigation();
      notify(t("savedViews.renamed"), "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function copy(savedView: SavedView) {
    const name = await dialog.prompt({
      title: t("savedViews.copyTitle"),
      message: t("savedViews.copyMessage", { name: savedView.name }),
      inputLabel: t("savedViews.name"),
      defaultValue: t("savedViews.copyDefaultName", { name: savedView.name }),
      required: true,
      confirmLabel: t("savedViews.copyConfirm"),
      cancelLabel: t("common.actions.cancel"),
      validate: (value) => (value.trim() ? null : t("savedViews.nameRequired"))
    });
    if (name === null) return;
    try {
      const copied = await api.copySavedView(savedView.id, name.trim());
      await loadNavigation();
      setActiveSavedViewId(copied.id);
      if (copied.query) apply(copied);
      notify(t("savedViews.copied"), "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function remove(savedView: SavedView) {
    const ok = await dialog.confirm({
      title: t("savedViews.deleteTitle"),
      message: t("savedViews.deleteMessage", { name: savedView.name }),
      confirmLabel: t("common.actions.delete"),
      cancelLabel: t("common.actions.cancel"),
      tone: "danger",
      destructive: true
    });
    if (!ok) return;
    try {
      await api.deleteSavedView(savedView.id);
      if (activeSavedViewId === savedView.id) setActiveSavedViewId(null);
      await loadNavigation();
      notify(t("savedViews.deleted"), "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function move(savedViewId: number, direction: -1 | 1) {
    const currentIndex = savedViews.findIndex((row) => row.id === savedViewId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= savedViews.length) return;
    const reordered = [...savedViews];
    [reordered[currentIndex], reordered[targetIndex]] = [
      reordered[targetIndex],
      reordered[currentIndex]
    ];
    try {
      await api.reorderSavedViews(reordered.map((row) => row.id));
      await loadNavigation();
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  }

  return {
    activeSavedView,
    activeSavedViewId,
    setActiveSavedViewId,
    canSave: isSavableView(view),
    isDirty,
    deactivate,
    apply,
    saveCurrent,
    updateActive,
    rename,
    copy,
    remove,
    move
  };
}
