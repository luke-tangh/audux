import { useCallback, useState } from "react";
import { api } from "../../api";
import type { LibraryRoot, Playlist, SavedView, Tag } from "../../types";

export function useNavigationData() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [roots, setRoots] = useState<LibraryRoot[]>([]);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);

  const loadNavigation = useCallback(async () => {
    const [tagRows, playlistRows, rootRows, savedViewRows] = await Promise.all([
      api.listTags().catch(() => []),
      api.listPlaylists().catch(() => []),
      api.listLibraryRoots().catch(() => []),
      api.listSavedViews().catch(() => [])
    ]);

    setTags(Array.isArray(tagRows) ? tagRows : []);
    setPlaylists(Array.isArray(playlistRows) ? playlistRows : []);
    setRoots(Array.isArray(rootRows) ? rootRows : []);
    setSavedViews(Array.isArray(savedViewRows) ? savedViewRows : []);
  }, []);

  return {
    tags,
    playlists,
    roots,
    savedViews,
    loadNavigation
  };
}
