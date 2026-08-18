import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import AudioList from "./components/AudioList";
import DetailPanel from "./components/DetailPanel";
import PlayerBar from "./components/PlayerBar";
import SettingsPanel from "./components/SettingsPanel";
import StatisticsPage from "./components/StatisticsPage";
import ToastStack from "./components/ToastStack";
import { useDialog } from "./components/dialog/UnifiedDialog";
import { IconButton, MaterialIcon } from "./components/ui";
import { useLibraryController } from "./hooks/useLibraryController";

export default function App() {
  const { t } = useTranslation();
  const dialog = useDialog();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorDirty, setInspectorDirty] = useState(false);
  const [compactNavigation, setCompactNavigation] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 860px)").matches
  );
  const [navigationOpen, setNavigationOpen] = useState(false);
  const {
    view,
    setView,

    audioItems,
    audioTotal,
    audioHasMore,
    searchLimited,
    searchLimit,
    selected,
    setSelected,
    selectionMode,
    selectedAudioIds,

    playing,
    playbackQueue,
    playingIndex,
    playRequestId,

    q,
    setQ,
    selectedTag,
    setSelectedTag,
    selectedPlaylistId,
    setSelectedPlaylistId,

    hasTranscriptFilter,
    setHasTranscriptFilter,
    missingFilter,
    setMissingFilter,
    sortMode,
    setSortMode,

    tags,
    playlists,
    manualPlaylists,
    savedViews,
    activeSavedViewId,
    savedViewDirty,
    canSaveView,
    isSmartPlaylist,

    loading,
    refreshing,
    loadingMore,
    loadError,

    listTitle,
    listSubtitle,
    hasActiveFilter,

    toasts,
    notify,
    closeToast,

    refresh,
    clearFilters,
    openSettings,
    deactivateSavedView,
    applySavedView,
    openPlaylist,
    createPlaylist,
    createSmartPlaylist,
    saveCurrentView,
    updateActiveSavedView,
    renameSavedView,
    copySavedView,
    deleteSavedView,
    moveSavedView,
    loadMoreAudioItems,
    enterSelectionMode,
    exitSelectionMode,
    toggleAudioSelection,
    toggleSelectAllLoaded,
    clearAudioSelection,

    playAudio,
    playAudioAt,
    addToQueue,
    playNextAudio,
    playPrevious,
    playNext,
    removeQueueItem,
    moveQueueItem,
    clearQueue,
    handlePlaybackPositionSaved,

    batchTranscribeCurrentList,
    batchAnalyzeCurrentList,
    batchAddTags,
    batchRemoveTag,
    batchAddToPlaylist,
    batchSetFavorite,

    removeFromCurrentPlaylist,
    movePlaylistItem,
    movePlaylistItemTo,
    handleAudioDeleted
  } = useLibraryController();

  useEffect(() => {
    if (!selected) {
      setInspectorOpen(false);
      setInspectorDirty(false);
    }
  }, [selected]);

  useEffect(() => {
    if (!inspectorDirty) return;

    function preventWindowClose(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", preventWindowClose);
    return () => window.removeEventListener("beforeunload", preventWindowClose);
  }, [inspectorDirty]);

  useEffect(() => {
    if (!inspectorOpen || !window.matchMedia("(max-width: 1040px)").matches) return;

    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(".inspector-close-button")?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [inspectorOpen, selected?.id]);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 860px)");
    const update = () => {
      setCompactNavigation(query.matches);
      if (!query.matches) setNavigationOpen(false);
    };

    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!compactNavigation) return;
    setNavigationOpen(false);
  }, [
    activeSavedViewId,
    compactNavigation,
    selectedPlaylistId,
    selectedTag,
    view
  ]);

  async function confirmDiscardInspectorChanges() {
    if (!inspectorDirty) return true;

    return dialog.confirm({
      title: t("detail.overview.discardTitle"),
      message: t("detail.overview.discardMessage"),
      confirmLabel: t("detail.overview.discardChanges"),
      cancelLabel: t("detail.overview.keepEditing"),
      tone: "warning",
      destructive: true
    });
  }

  async function openInspector(item: NonNullable<typeof selected>) {
    if (selected?.id !== item.id && !(await confirmDiscardInspectorChanges())) return;

    setInspectorDirty(false);
    setSelected(item);
    setInspectorOpen(true);
  }

  async function closeInspector() {
    if (!(await confirmDiscardInspectorChanges())) return;

    setInspectorDirty(false);
    setInspectorOpen(false);
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(".audio-row.selected .audio-row-primary")?.focus();
    });
  }

  async function prepareInspectorNavigation() {
    if (!inspectorDirty) return true;

    const allowed = await confirmDiscardInspectorChanges();
    if (!allowed) return false;

    setInspectorDirty(false);
    setInspectorOpen(false);
    return true;
  }

  async function requestOpenSettings() {
    if (!(await confirmDiscardInspectorChanges())) return;
    setInspectorDirty(false);
    openSettings();
  }

  function closeNavigation(restoreFocus = false) {
    setNavigationOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(".app-navigation-toggle")?.focus();
      });
    }
  }

  return (
    <div className="app-shell">
      <div
        className={[
          "main-shell",
          view === "settings" || view === "statistics" ? "settings-mode" : "",
          view !== "settings" && !inspectorOpen ? "inspector-closed" : ""
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <IconButton
          className="app-navigation-toggle"
          label={t("navigation.openNavigation")}
          aria-controls="app-navigation"
          aria-expanded={navigationOpen}
          onClick={() => setNavigationOpen(true)}
        >
          <MaterialIcon name="menu" size={22} />
        </IconButton>

        <Sidebar
          compactNavigation={compactNavigation}
          navigationOpen={navigationOpen}
          onCloseNavigation={() => closeNavigation(true)}
          onBeforeNavigate={prepareInspectorNavigation}
          view={view}
          setView={setView}
          tags={tags}
          selectedTag={selectedTag}
          setSelectedTag={setSelectedTag}
          playlists={playlists}
          selectedPlaylistId={selectedPlaylistId}
          setSelectedPlaylistId={setSelectedPlaylistId}
          savedViews={savedViews}
          activeSavedViewId={activeSavedViewId}
          onApplySavedView={applySavedView}
          onRenameSavedView={(savedView) => void renameSavedView(savedView)}
          onCopySavedView={(savedView) => void copySavedView(savedView)}
          onCreateSmartPlaylist={(savedView) => void createSmartPlaylist(savedView)}
          onDeleteSavedView={(savedView) => void deleteSavedView(savedView)}
          onMoveSavedView={(savedViewId, direction) => void moveSavedView(savedViewId, direction)}
          onDeactivateSavedView={deactivateSavedView}
          onOpenPlaylist={openPlaylist}
          onCreatePlaylist={createPlaylist}
        />

        {compactNavigation && navigationOpen && (
          <button
            type="button"
            className="navigation-scrim"
            aria-label={t("navigation.closeNavigation")}
            onClick={() => closeNavigation(true)}
          />
        )}

        {view === "settings" ? (
          <main className="workspace settings-workspace">
            <SettingsPanel refresh={refresh} notify={notify} />
          </main>
        ) : view === "statistics" ? (
          <main className="workspace statistics-workspace">
            <StatisticsPage
              onOpenMissing={() => {
                clearFilters();
                setView("missing");
              }}
              onOpenUntranscribed={() => {
                clearFilters();
                setHasTranscriptFilter("no");
                setView("library");
              }}
              onOpenMissingDescription={() => {
                clearFilters();
                setView("missingDescription");
              }}
              onOpenAiFailed={() => {
                clearFilters();
                setView("aiFailed");
              }}
              onOpenSettings={() => void requestOpenSettings()}
            />
          </main>
        ) : (
          <>
            <main className="workspace">
              <TopBar
                title={listTitle}
                subtitle={listSubtitle}
                totalCount={audioTotal}
                searchLimited={searchLimited}
                searchLimit={searchLimit}
                q={q}
                setQ={setQ}
                isLoading={loading}
                queryLocked={isSmartPlaylist}
                hasActiveFilter={hasActiveFilter}
                onClearFilters={clearFilters}
                hasTranscriptFilter={hasTranscriptFilter}
                setHasTranscriptFilter={setHasTranscriptFilter}
                missingFilter={missingFilter}
                setMissingFilter={setMissingFilter}
                sortMode={sortMode}
                setSortMode={setSortMode}
                activeSavedViewName={savedViews.find((row) => row.id === activeSavedViewId)?.name}
                savedViewDirty={savedViewDirty}
                canSaveView={canSaveView}
                onSaveView={() => void saveCurrentView()}
                onUpdateSavedView={() => void updateActiveSavedView()}
              />

              <AudioList
                title={listTitle}
                q={q}
                isLoading={loading}
                isRefreshing={refreshing}
                loadError={loadError}
                onOpenSettings={() => void requestOpenSettings()}
                onClearFilters={clearFilters}
                hasActiveFilter={hasActiveFilter}
                items={audioItems}
                totalCount={audioTotal}
                hasMore={audioHasMore}
                isLoadingMore={loadingMore}
                onLoadMore={loadMoreAudioItems}
                selectedId={selected?.id}
                selectionMode={selectionMode}
                selectedAudioIds={selectedAudioIds}
                onSelect={openInspector}
                onPlay={(item) => playAudio(item, audioItems)}
                onPlayAt={(item, seconds) => playAudioAt(item, seconds, audioItems)}
                onAddToQueue={addToQueue}
                onPlayNext={playNextAudio}
                isPlaylistView={view === "playlist" && !isSmartPlaylist}
                onRemoveFromPlaylist={
                  view === "playlist" && !isSmartPlaylist
                    ? removeFromCurrentPlaylist
                    : undefined
                }
                onMovePlaylistItem={
                  view === "playlist" && !isSmartPlaylist && sortMode === "default"
                    ? movePlaylistItem
                    : undefined
                }
                onMovePlaylistItemTo={
                  view === "playlist" && !isSmartPlaylist && sortMode === "default"
                    ? movePlaylistItemTo
                    : undefined
                }
                onEnterSelectionMode={enterSelectionMode}
                onExitSelectionMode={exitSelectionMode}
                onToggleAudioSelection={toggleAudioSelection}
                onToggleSelectAllLoaded={toggleSelectAllLoaded}
                onClearAudioSelection={clearAudioSelection}
                onBatchAddTags={() => void batchAddTags()}
                onBatchRemoveTag={() => void batchRemoveTag()}
                onBatchAddToPlaylist={() => void batchAddToPlaylist()}
                onBatchSetFavorite={(isFavorite) => void batchSetFavorite(isFavorite)}
                onBatchTranscribe={batchTranscribeCurrentList}
                onBatchAnalyze={batchAnalyzeCurrentList}
              />
            </main>

            {inspectorOpen && selected && (
              <>
                <button
                  type="button"
                  className="inspector-scrim"
                  aria-label={t("detail.dismiss")}
                  onClick={() => void closeInspector()}
                />
                <DetailPanel
                  audio={selected}
                  refresh={refresh}
                  onPlay={(item) => playAudio(item, audioItems)}
                  onAddToQueue={addToQueue}
                  onPlayNext={playNextAudio}
                  playlists={manualPlaylists}
                  selectedPlaylistId={selectedPlaylistId}
                  onDeleted={handleAudioDeleted}
                  onClose={() => void closeInspector()}
                  onDirtyChange={setInspectorDirty}
                  notify={notify}
                />
              </>
            )}
          </>
        )}
      </div>

      <PlayerBar
        audio={playing}
        queue={playbackQueue}
        queueIndex={playingIndex}
        playRequestId={playRequestId}
        canPrevious={playingIndex > 0}
        canNext={playingIndex >= 0 && playingIndex < playbackQueue.length - 1}
        onPrevious={playPrevious}
        onNext={playNext}
        onQueueSelect={(index) => void playAudio(playbackQueue[index], playbackQueue)}
        onQueueRemove={(index) => void removeQueueItem(index)}
        onQueueMove={moveQueueItem}
        onQueueClear={clearQueue}
        onPositionSaved={handlePlaybackPositionSaved}
      />

      <ToastStack toasts={toasts} onClose={closeToast} />
    </div>
  );
}
