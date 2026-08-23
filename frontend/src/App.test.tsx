import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DialogProvider } from "./components/dialog/UnifiedDialog";
import "./i18n";

const controllerMock = vi.hoisted(() => vi.fn());

vi.mock("./hooks/useLibraryController", () => ({
  useLibraryController: controllerMock
}));
vi.mock("./hooks/useActivityCenterPreference", () => ({
  useActivityCenterPreference: () => ({ enabled: false, updateEnabled: vi.fn() })
}));
vi.mock("./components/Sidebar", () => ({ default: () => <aside>sidebar</aside> }));
vi.mock("./components/TopBar", () => ({ default: () => <header>topbar</header> }));
vi.mock("./components/AudioList", () => ({ default: () => <main>audio-list</main> }));
vi.mock("./components/PlayerBar", () => ({ default: () => <footer>player</footer> }));
vi.mock("./components/ToastStack", () => ({ default: () => null }));
vi.mock("./components/ActivityCenter", () => ({ default: () => null }));
vi.mock("./components/OnboardingWizard", () => ({ default: () => null }));
vi.mock("./components/StartupScreen", () => ({
  default: ({ state, error }: { state: string; error: string }) => (
    <div>{state}:{error}</div>
  )
}));

import App from "./App";

function controller(overrides: Record<string, unknown> = {}) {
  const noop = vi.fn();
  return {
    view: "library",
    setView: noop,
    audioItems: [],
    audioTotal: 0,
    audioHasMore: false,
    searchLimited: false,
    searchLimit: null,
    facets: { tags: [], roots: [] },
    selected: null,
    setSelected: noop,
    selectionMode: false,
    selectedAudioIds: new Set<number>(),
    playing: null,
    playbackQueue: [],
    playingIndex: -1,
    playRequestId: 0,
    q: "",
    selectedTag: undefined,
    includedTagIds: [],
    excludedTagIds: [],
    tagMode: "and",
    selectedLibraryRootId: undefined,
    selectedPlaylistId: null,
    hasTranscriptFilter: "all",
    missingFilter: "all",
    sortMode: "default",
    tags: [],
    roots: [{ id: 1, path: "/audio", is_enabled: true }],
    playlists: [],
    manualPlaylists: [],
    savedViews: [],
    activeSavedViewId: null,
    savedViewDirty: false,
    canSaveView: true,
    isSmartPlaylist: false,
    loading: false,
    refreshing: false,
    loadingMore: false,
    loadError: "",
    initialized: true,
    startupState: "ready",
    startupError: "",
    listTitle: "Library",
    listSubtitle: "All audio",
    hasActiveFilter: false,
    toasts: [],
    notify: noop,
    closeToast: noop,
    refresh: noop,
    retryStartup: noop,
    clearFilters: noop,
    openSettings: noop,
    ...Object.fromEntries([
      "setQ", "setSelectedTag", "setTagMode", "setTagFilterState",
      "setSelectedLibraryRootId", "setSelectedPlaylistId", "setHasTranscriptFilter",
      "setMissingFilter", "setSortMode", "deactivateSavedView", "applySavedView",
      "openPlaylist", "createPlaylist", "createSmartPlaylist", "saveCurrentView",
      "updateActiveSavedView", "renameSavedView", "copySavedView", "deleteSavedView",
      "moveSavedView", "loadMoreAudioItems", "enterSelectionMode", "exitSelectionMode",
      "toggleAudioSelection", "toggleSelectAllLoaded", "clearAudioSelection", "playAudio",
      "playAudioAt", "addToQueue", "playNextAudio", "playPrevious", "playNext",
      "removeQueueItem", "moveQueueItem", "clearQueue", "handlePlaybackPositionSaved",
      "batchTranscribeCurrentList", "batchAnalyzeCurrentList", "batchAddTags",
      "batchRemoveTag", "batchAddToPlaylist", "batchSetFavorite",
      "removeFromCurrentPlaylist", "movePlaylistItem", "movePlaylistItemTo",
      "handleAudioDeleted"
    ].map((key) => [key, noop])),
    ...overrides
  };
}

function renderApp() {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DialogProvider>{children}</DialogProvider>
  );
  return render(<App />, { wrapper });
}

describe("App", () => {
  beforeEach(() => {
    controllerMock.mockReset();
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }));
  });

  it("renders the library workspace when startup is ready", () => {
    controllerMock.mockReturnValue(controller());
    renderApp();
    expect(screen.getByText("sidebar")).toBeInTheDocument();
    expect(screen.getByText("topbar")).toBeInTheDocument();
    expect(screen.getByText("audio-list")).toBeInTheDocument();
    expect(screen.getByText("player")).toBeInTheDocument();
  });

  it("renders startup failure state before the workspace", () => {
    controllerMock.mockReturnValue(controller({
      startupState: "error",
      startupError: "backend unavailable"
    }));
    renderApp();
    expect(screen.getByText("error:backend unavailable")).toBeInTheDocument();
    expect(screen.queryByText("audio-list")).not.toBeInTheDocument();
  });
});
