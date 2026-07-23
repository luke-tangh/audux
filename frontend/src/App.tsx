import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import AudioList from "./components/AudioList";
import DetailPanel from "./components/DetailPanel";
import PlayerBar from "./components/PlayerBar";
import SettingsPanel from "./components/SettingsPanel";
import ToastStack from "./components/ToastStack";
import { useLibraryController } from "./hooks/useLibraryController";

export default function App() {
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

    playing,
    playbackQueue,
    playingIndex,

    q,
    setQ,
    selectedTag,
    setSelectedTag,
    selectedPlaylistId,
    setSelectedPlaylistId,

    missingDescriptionOnly,
    setMissingDescriptionOnly,
    hasTranscriptFilter,
    setHasTranscriptFilter,
    missingFilter,
    setMissingFilter,

    tags,
    playlists,

    loading,
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
    loadMoreAudioItems,

    playAudio,
    playAudioAt,
    playPrevious,
    playNext,
    removeQueueItem,
    clearQueue,
    handlePlaybackPositionSaved,

    batchTranscribeCurrentList,
    batchAnalyzeCurrentList,

    removeFromCurrentPlaylist,
    movePlaylistItem,
    movePlaylistItemTo,
    handleAudioDeleted
  } = useLibraryController();

  return (
    <div className="app-shell">
      <div className={`main-shell ${view === "settings" ? "settings-mode" : ""}`}>
        <Sidebar
          view={view}
          setView={setView}
          tags={tags}
          selectedTag={selectedTag}
          setSelectedTag={setSelectedTag}
          playlists={playlists}
          selectedPlaylistId={selectedPlaylistId}
          setSelectedPlaylistId={setSelectedPlaylistId}
          refresh={refresh}
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
                hasActiveFilter={hasActiveFilter}
                onClearFilters={clearFilters}
                missingDescriptionOnly={missingDescriptionOnly}
                setMissingDescriptionOnly={setMissingDescriptionOnly}
                hasTranscriptFilter={hasTranscriptFilter}
                setHasTranscriptFilter={setHasTranscriptFilter}
                missingFilter={missingFilter}
                setMissingFilter={setMissingFilter}
                onBatchTranscribe={batchTranscribeCurrentList}
                onBatchAnalyze={batchAnalyzeCurrentList}
                onOpenSettings={openSettings}
              />

              <AudioList
                title={listTitle}
                q={q}
                setQ={setQ}
                isLoading={loading}
                loadError={loadError}
                onOpenSettings={openSettings}
                onClearFilters={clearFilters}
                missingDescriptionOnly={missingDescriptionOnly}
                setMissingDescriptionOnly={setMissingDescriptionOnly}
                hasTranscriptFilter={hasTranscriptFilter}
                setHasTranscriptFilter={setHasTranscriptFilter}
                missingFilter={missingFilter}
                setMissingFilter={setMissingFilter}
                items={audioItems}
                totalCount={audioTotal}
                hasMore={audioHasMore}
                isLoadingMore={loadingMore}
                onLoadMore={loadMoreAudioItems}
                selectedId={selected?.id}
                onSelect={setSelected}
                onPlay={(item) => playAudio(item, audioItems)}
                onPlayAt={(item, seconds) => playAudioAt(item, seconds, audioItems)}
                onBatchTranscribe={batchTranscribeCurrentList}
                onBatchAnalyze={batchAnalyzeCurrentList}
                isPlaylistView={view === "playlist"}
                onRemoveFromPlaylist={
                  view === "playlist" ? removeFromCurrentPlaylist : undefined
                }
                onMovePlaylistItem={view === "playlist" ? movePlaylistItem : undefined}
                onMovePlaylistItemTo={
                  view === "playlist" ? movePlaylistItemTo : undefined
                }
              />
            </main>

            <DetailPanel
              audio={selected}
              refresh={refresh}
              onPlay={(item) => playAudio(item, audioItems)}
              playlists={playlists}
              selectedPlaylistId={selectedPlaylistId}
              onDeleted={handleAudioDeleted}
              notify={notify}
            />
          </>
        )}
      </div>

      <PlayerBar
        audio={playing}
        queue={playbackQueue}
        queueIndex={playingIndex}
        canPrevious={playingIndex > 0}
        canNext={playingIndex >= 0 && playingIndex < playbackQueue.length - 1}
        onPrevious={playPrevious}
        onNext={playNext}
        onQueueSelect={(index) => void playAudio(playbackQueue[index], playbackQueue)}
        onQueueRemove={(index) => void removeQueueItem(index)}
        onQueueClear={clearQueue}
        onPositionSaved={handlePlaybackPositionSaved}
      />

      <ToastStack toasts={toasts} onClose={closeToast} />
    </div>
  );
}
