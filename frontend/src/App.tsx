import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import AudioList from "./components/AudioList";
import DetailPanel from "./components/DetailPanel";
import PlayerBar from "./components/PlayerBar";
import SettingsPanel from "./components/SettingsPanel";
import ToastStack from "./components/ToastStack";
import { useLibraryController } from "./hooks/useLibraryController";

export default function App() {
  const { t } = useTranslation();
  const [inspectorOpen, setInspectorOpen] = useState(false);
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
    }
  }, [selected]);

  useEffect(() => {
    if (!inspectorOpen || !window.matchMedia("(max-width: 1040px)").matches) return;

    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(".inspector-close-button")?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [inspectorOpen, selected?.id]);

  function openInspector(item: NonNullable<typeof selected>) {
    setSelected(item);
    setInspectorOpen(true);
  }

  function closeInspector() {
    setInspectorOpen(false);
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(".audio-row.selected")?.focus();
    });
  }

  return (
    <div className="app-shell">
      <div
        className={[
          "main-shell",
          view === "settings" ? "settings-mode" : "",
          view !== "settings" && !inspectorOpen ? "inspector-closed" : ""
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <Sidebar
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

        {view === "settings" ? (
          <main className="workspace settings-workspace">
            <SettingsPanel refresh={refresh} notify={notify} />
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
                onBatchTranscribe={batchTranscribeCurrentList}
                onBatchAnalyze={batchAnalyzeCurrentList}
              />

              <AudioList
                title={listTitle}
                q={q}
                isLoading={loading}
                isRefreshing={refreshing}
                loadError={loadError}
                onOpenSettings={openSettings}
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
              />
            </main>

            {inspectorOpen && selected && (
              <>
                <button
                  type="button"
                  className="inspector-scrim"
                  aria-label={t("detail.dismiss")}
                  onClick={closeInspector}
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
                  onClose={closeInspector}
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
