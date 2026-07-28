import { useCallback, useState } from "react";
import { api } from "../../api";
import type { Playlist, Tag } from "../../types";

export function useNavigationData() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);

  const loadNavigation = useCallback(async () => {
    const [tagRows, playlistRows] = await Promise.all([
      api.listTags().catch(() => []),
      api.listPlaylists().catch(() => [])
    ]);

    setTags(tagRows);
    setPlaylists(playlistRows);
  }, []);

  return {
    tags,
    playlists,
    loadNavigation
  };
}
