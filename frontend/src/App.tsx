import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";

import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import AudioList from "./components/AudioList";
import DetailPanel from "./components/DetailPanel";
import PlayerBar from "./components/PlayerBar";
import ToastStack from "./components/ToastStack";
import ActivityCenter from "./components/ActivityCenter";
import OnboardingWizard from "./components/OnboardingWizard";
import StartupScreen from "./components/StartupScreen";
import { IconButton, MaterialIcon } from "./components/ui";
import { useActivityCenterPreference } from "./hooks/useActivityCenterPreference";
import { useAppShellController } from "./hooks/useAppShellController";
import { useLibraryController } from "./hooks/useLibraryController";
import { api } from "./api";

const SettingsPanel = lazy(() => import("./components/SettingsPanel"));
const StatisticsPage = lazy(() => import("./components/StatisticsPage"));
const AgentPanel = lazy(() => import("./components/AgentPanel"));
const OrganizationPanel = lazy(() => import("./components/OrganizationPanel"));

function WorkspaceLoading() {
  const { t } = useTranslation();
  return <p className="muted" role="status">{t("activities.loading")}</p>;
}

export default function App() {
  const { t } = useTranslation();
  const {
    enabled: activityCenterEnabled,
    updateEnabled: updateActivityCenterEnabled
  } = useActivityCenterPreference();
  const {
    view,
    setView,

    audioItems,
    audioTotal,
    audioHasMore,
    searchLimited,
    searchLimit,
    facets,
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
    includedTagIds,
    excludedTagIds,
    tagMode,
    setTagMode,
    setTagFilterState,
    selectedLibraryRootId,
    setSelectedLibraryRootId,
    selectedPlaylistId,
    setSelectedPlaylistId,

    hasTranscriptFilter,
    setHasTranscriptFilter,
    missingFilter,
    setMissingFilter,
    sortMode,
    setSortMode,

    tags,
    roots,
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
    initialized,
    startupState,
    startupError,

    listTitle,
    listSubtitle,
    hasActiveFilter,

    toasts,
    notify,
    closeToast,

    refresh,
    retryStartup,
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
  const {
    inspectorOpen,
    setInspectorDirty,
    setSettingsDirty,
    compactNavigation,
    navigationOpen,
    setNavigationOpen,
    sidebarCollapsed,
    setSidebarCollapsed,
    onboardingOpen,
    setOnboardingOpen,
    openInspector,
    closeInspector,
    prepareWorkspaceNavigation,
    handleSettingsBeforeLeaveChange,
    requestOpenSettings,
    closeNavigation
  } = useAppShellController({
    selected,
    setSelected,
    view,
    openSettings,
    initialized,
    rootsLength: roots.length,
    activeSavedViewId,
    selectedPlaylistId,
    selectedTag
  });

  async function playReferencedAudio(audioId: number, seconds: number) {
    const existing = playbackQueue.find((row) => row.id === audioId)
      || audioItems.find((row) => row.id === audioId);
    const item = existing || (await api.getAudioDetail(audioId)).audio;
    const queue = playbackQueue.some((row) => row.id === audioId)
      ? playbackQueue
      : [item, ...playbackQueue];
    await playAudioAt(item, seconds, queue);
  }

  if (startupState !== "ready") {
    return (
      <StartupScreen
        state={startupState}
        error={startupError}
        onRetry={retryStartup}
      />
    );
  }

  return (
    <div className="app-shell">
      <div
        className={[
          "main-shell",
          sidebarCollapsed && !compactNavigation ? "navigation-rail" : "",
          view === "settings" || view === "statistics" || view === "agent" || view === "organization" ? "settings-mode" : "",
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
          collapsed={sidebarCollapsed && !compactNavigation}
          onCollapsedChange={setSidebarCollapsed}
          navigationOpen={navigationOpen}
          onCloseNavigation={() => closeNavigation(true)}
          onBeforeNavigate={prepareWorkspaceNavigation}
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
            <Suspense fallback={<WorkspaceLoading />}>
              <SettingsPanel
                refresh={refresh}
                notify={notify}
                activityCenterEnabled={activityCenterEnabled}
                onActivityCenterEnabledChange={updateActivityCenterEnabled}
                onBeforeLeaveChange={handleSettingsBeforeLeaveChange}
                onDirtyChange={setSettingsDirty}
              />
            </Suspense>
          </main>
        ) : view === "statistics" ? (
          <main className="workspace statistics-workspace">
            <Suspense fallback={<WorkspaceLoading />}>
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
            </Suspense>
          </main>
        ) : view === "agent" ? (
          <Suspense fallback={<main className="workspace"><WorkspaceLoading /></main>}>
            <AgentPanel
              selected={selected}
              selectedAudioIds={selectedAudioIds}
              selectedPlaylistId={selectedPlaylistId}
              activeSavedViewId={activeSavedViewId}
              selectedTag={selectedTag}
              selectedLibraryRootId={selectedLibraryRootId}
              playlists={playlists}
              savedViews={savedViews}
              tags={tags}
              roots={roots}
              notify={notify}
              onPlayCitation={playReferencedAudio}
            />
          </Suspense>
        ) : view === "organization" ? (
          <Suspense fallback={<main className="workspace"><WorkspaceLoading /></main>}>
            <OrganizationPanel
              selected={selected}
              selectedAudioIds={selectedAudioIds}
              selectedPlaylistId={selectedPlaylistId}
              activeSavedViewId={activeSavedViewId}
              selectedTag={selectedTag}
              selectedLibraryRootId={selectedLibraryRootId}
              playlists={playlists}
              savedViews={savedViews}
              tags={tags}
              roots={roots}
              notify={notify}
              onPlayEvidence={playReferencedAudio}
            />
          </Suspense>
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
                roots={roots}
                tags={tags}
                facets={facets}
                selectedLibraryRootId={selectedLibraryRootId}
                setSelectedLibraryRootId={setSelectedLibraryRootId}
                includedTagIds={includedTagIds}
                excludedTagIds={excludedTagIds}
                tagMode={tagMode}
                setTagMode={setTagMode}
                setTagFilterState={setTagFilterState}
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
                onOpenSettings={() => {
                  if (roots.length === 0) setOnboardingOpen(true);
                  else void requestOpenSettings();
                }}
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
                  onPlayAt={(item, seconds) => playAudioAt(item, seconds, audioItems)}
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

      {activityCenterEnabled && (
        <ActivityCenter onActivityChanged={refresh} notify={notify} />
      )}

      <OnboardingWizard
        open={onboardingOpen}
        onClose={() => setOnboardingOpen(false)}
        onImported={refresh}
      />

      <ToastStack toasts={toasts} onClose={closeToast} />
    </div>
  );
}
