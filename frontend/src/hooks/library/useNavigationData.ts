import { useCallback, useRef, useState } from "react";
import { api } from "../../api";
import type { LibraryRoot, Playlist, SavedView, Tag } from "../../types";

export function useNavigationData() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [roots, setRoots] = useState<LibraryRoot[]>([]);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [navigationReady, setNavigationReady] = useState(false);
  const loadPromiseRef = useRef<Promise<{
    tags: Tag[];
    playlists: Playlist[];
    roots: LibraryRoot[];
    savedViews: SavedView[];
  }> | null>(null);

  const loadNavigation = useCallback(async () => {
    if (loadPromiseRef.current) return loadPromiseRef.current;

    loadPromiseRef.current = (async () => {
      const results = await Promise.allSettled([
        api.listTags(),
        api.listPlaylists(),
        api.listLibraryRoots(),
        api.listSavedViews()
      ]);
      const [tagResult, playlistResult, rootResult, savedViewResult] = results;
      const nextTags = tagResult.status === "fulfilled" && Array.isArray(tagResult.value)
        ? tagResult.value
        : tags;
      const nextPlaylists = playlistResult.status === "fulfilled"
        && Array.isArray(playlistResult.value)
        ? playlistResult.value
        : playlists;
      const nextRoots = rootResult.status === "fulfilled" && Array.isArray(rootResult.value)
        ? rootResult.value
        : roots;
      const nextSavedViews = savedViewResult.status === "fulfilled"
        && Array.isArray(savedViewResult.value)
        ? savedViewResult.value
        : savedViews;
      if (tagResult.status === "fulfilled") setTags(nextTags);
      if (playlistResult.status === "fulfilled") setPlaylists(nextPlaylists);
      if (rootResult.status === "fulfilled") setRoots(nextRoots);
      if (savedViewResult.status === "fulfilled") setSavedViews(nextSavedViews);

      const failure = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected"
      );
      if (failure) throw failure.reason;
      setNavigationReady(true);
      return {
        tags: nextTags,
        playlists: nextPlaylists,
        roots: nextRoots,
        savedViews: nextSavedViews
      };
    })().finally(() => {
      loadPromiseRef.current = null;
    });

    return loadPromiseRef.current;
  }, []);

  return {
    tags,
    playlists,
    roots,
    savedViews,
    navigationReady,
    loadNavigation
  };
}
