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

    const nextTags = Array.isArray(tagRows) ? tagRows : [];
    const nextPlaylists = Array.isArray(playlistRows) ? playlistRows : [];
    const nextRoots = Array.isArray(rootRows) ? rootRows : [];
    const nextSavedViews = Array.isArray(savedViewRows) ? savedViewRows : [];
    setTags(nextTags);
    setPlaylists(nextPlaylists);
    setRoots(nextRoots);
    setSavedViews(nextSavedViews);
    return {
      tags: nextTags,
      playlists: nextPlaylists,
      roots: nextRoots,
      savedViews: nextSavedViews
    };
  }, []);

  return {
    tags,
    playlists,
    roots,
    savedViews,
    loadNavigation
  };
}
