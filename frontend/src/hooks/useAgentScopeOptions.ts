import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type {
  AgentScope,
  AudioItem,
  LibraryRoot,
  Playlist,
  SavedView,
  Tag
} from "../types";

export function serializeAgentScope(scope: AgentScope): string {
  return JSON.stringify(scope);
}

type AgentScopeContext = {
  scope: AgentScope;
  selected: AudioItem | null;
  selectedAudioIds: ReadonlySet<number>;
  selectedPlaylistId: number | null;
  activeSavedViewId: number | null;
  selectedTag?: string;
  selectedLibraryRootId?: number;
  playlists: Playlist[];
  savedViews: SavedView[];
  tags: Tag[];
  roots: LibraryRoot[];
  currentLabel?: string;
};

export function useAgentScopeOptions({
  scope,
  selected,
  selectedAudioIds,
  selectedPlaylistId,
  activeSavedViewId,
  selectedTag,
  selectedLibraryRootId,
  playlists,
  savedViews,
  tags,
  roots,
  currentLabel
}: AgentScopeContext) {
  const { t } = useTranslation();

  return useMemo(() => {
    const values = [
      { value: serializeAgentScope({ kind: "library" }), label: t("agent.scope.library") }
    ];

    if (selected) {
      values.push({
        value: serializeAgentScope({ kind: "audio", audio_id: selected.id }),
        label: t("agent.scope.audio", {
          title: selected.title_user || selected.title_original || selected.file_name
        })
      });
    }
    if (selectedAudioIds.size > 0) {
      values.push({
        value: serializeAgentScope({
          kind: "selection",
          audio_ids: [...selectedAudioIds].sort((a, b) => a - b)
        }),
        label: t("agent.scope.selection", { count: selectedAudioIds.size })
      });
    }
    if (selectedPlaylistId) {
      const playlist = playlists.find((row) => row.id === selectedPlaylistId);
      values.push({
        value: serializeAgentScope({ kind: "playlist", playlist_id: selectedPlaylistId }),
        label: t("agent.scope.playlist", { name: playlist?.name || selectedPlaylistId })
      });
    }
    if (activeSavedViewId) {
      const view = savedViews.find((row) => row.id === activeSavedViewId);
      values.push({
        value: serializeAgentScope({ kind: "saved_view", saved_view_id: activeSavedViewId }),
        label: t("agent.scope.savedView", { name: view?.name || activeSavedViewId })
      });
    }
    const tag = tags.find((row) => row.name === selectedTag);
    if (tag) {
      values.push({
        value: serializeAgentScope({ kind: "tag", tag_id: tag.id }),
        label: t("agent.scope.tag", { name: tag.name })
      });
    }
    if (selectedLibraryRootId) {
      const root = roots.find((row) => row.id === selectedLibraryRootId);
      values.push({
        value: serializeAgentScope({
          kind: "library_root",
          library_root_id: selectedLibraryRootId
        }),
        label: t("agent.scope.root", { path: root?.path || selectedLibraryRootId })
      });
    }

    const serializedScope = serializeAgentScope(scope);
    if (!values.some((option) => option.value === serializedScope)) {
      values.push({
        value: serializedScope,
        label: currentLabel || t("agent.scope.current")
      });
    }
    return values;
  }, [
    activeSavedViewId,
    currentLabel,
    playlists,
    roots,
    savedViews,
    scope,
    selected,
    selectedAudioIds,
    selectedLibraryRootId,
    selectedPlaylistId,
    selectedTag,
    tags,
    t
  ]);
}
