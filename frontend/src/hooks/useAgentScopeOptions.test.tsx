import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { AudioItem } from "../types";
import "../i18n";
import { serializeAgentScope, useAgentScopeOptions } from "./useAgentScopeOptions";

describe("useAgentScopeOptions", () => {
  it("builds available scopes and preserves an unavailable current scope", () => {
    const selected = {
      id: 7,
      file_name: "episode.mp3",
      title_original: "Episode"
    } as AudioItem;
    const scope = { kind: "playlist", playlist_id: 99 } as const;
    const { result } = renderHook(() => useAgentScopeOptions({
      scope,
      selected,
      selectedAudioIds: new Set([9, 3]),
      selectedPlaylistId: null,
      activeSavedViewId: null,
      playlists: [],
      savedViews: [],
      tags: [],
      roots: [],
      currentLabel: "Archived playlist"
    }));

    expect(result.current.map((option) => option.value)).toContain(
      serializeAgentScope({ kind: "selection", audio_ids: [3, 9] })
    );
    expect(result.current).toContainEqual({
      value: serializeAgentScope(scope),
      label: "Archived playlist"
    });
  });
});
