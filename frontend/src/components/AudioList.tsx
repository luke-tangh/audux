import { useState } from "react";
import { api } from "../api";
import type { AudioItem } from "../types";
import { displayAuthor, displayDescription, displayTitle, formatDuration } from "../types";
import { Button, StatusPill, MaterialIcon } from "./ui";
import { useTranslation } from "react-i18next";

const MAX_BATCH_SELECTION = 500;

type Props = {
  title: string;
  q: string;
  isLoading?: boolean;
  isRefreshing?: boolean;
  loadError?: string;
  onOpenSettings: () => void;
  onClearFilters: () => void;
  hasActiveFilter: boolean;
  items: AudioItem[];
  totalCount?: number;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  selectedId?: number;
  selectionMode: boolean;
  selectedAudioIds: ReadonlySet<number>;
  onSelect: (item: AudioItem) => void;
  onPlay: (item: AudioItem) => void;
  onPlayAt: (item: AudioItem, startSeconds: number) => void;
  onAddToQueue: (item: AudioItem) => void;
  onPlayNext: (item: AudioItem) => void;
  isPlaylistView?: boolean;
  onRemoveFromPlaylist?: (item: AudioItem) => void;
  onMovePlaylistItem?: (item: AudioItem, direction: "up" | "down") => void;
  onMovePlaylistItemTo?: (source: AudioItem, target: AudioItem) => void;
  onEnterSelectionMode: () => void;
  onExitSelectionMode: () => void;
  onToggleAudioSelection: (audioId: number) => void;
  onToggleSelectAllLoaded: () => void;
  onClearAudioSelection: () => void;
  onBatchAddTags: () => void;
  onBatchRemoveTag: () => void;
  onBatchAddToPlaylist: () => void;
  onBatchSetFavorite: (isFavorite: boolean) => void;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function HighlightText({
  text,
  query
}: {
  text?: string;
  query: string;
}) {
  const value = text || "";
  const tokens = query
    .trim()
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean);

  if (!value || tokens.length === 0) {
    return <>{value}</>;
  }

  const pattern = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "gi");
  const parts = value.split(pattern);

  return (
    <>
      {parts.map((part, index) => {
        const matched = tokens.some((token) => part.toLowerCase() === token.toLowerCase());

        if (!matched) {
          return <span key={index}>{part}</span>;
        }

        return <mark key={index}>{part}</mark>;
      })}
    </>
  );
}

function CoverThumb({ item }: { item: AudioItem }) {
  return (
    <div className={`cover-thumb ${item.is_missing ? "missing" : ""}`}>
      <MaterialIcon name="music_note" size={24} />

      {item.cover_path && (
        <img
          key={`${item.id}-${item.updated_at}`}
          src={api.coverUrl(item.id, item.updated_at)}
          alt=""
          onLoad={(e) => {
            e.currentTarget.style.display = "";
          }}
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      )}
    </div>
  );
}

function RowTags({
  item,
  query
}: {
  item: AudioItem;
  query: string;
}) {
  const tags = item.tags || [];

  if (tags.length === 0) return null;

  return (
    <div className="row-tags">
      {tags.slice(0, 5).map((tag) => (
        <span className="mini-tag" key={tag.id}>
          #<HighlightText text={tag.name} query={query} />
        </span>
      ))}

      {tags.length > 5 && <span className="mini-tag muted-tag">+{tags.length - 5}</span>}
    </div>
  );
}

function SearchHits({
  item,
  query,
  onPlayAt
}: {
  item: AudioItem;
  query: string;
  onPlayAt: (item: AudioItem, startSeconds: number) => void;
}) {
  const { t } = useTranslation();
  const hits = item.search_hits || [];

  if (!query.trim() || hits.length === 0) return null;

  return (
    <div className="search-hits">
      {hits.map((hit, index) => (
        <div
          key={`${hit.field}-${index}`}
          className={hit.start_seconds !== undefined ? "search-hit timed" : "search-hit"}
        >
          {hit.start_seconds !== undefined ? (
            <Button preserveChildren
              type="button"
              aria-label={t("audioList.playFromHit", { time: formatDuration(hit.start_seconds), title: displayTitle(item) })}
              onClick={(e) => {
                e.stopPropagation();
                onPlayAt(item, hit.start_seconds || 0);
              }}
              title={t("audioList.playFromHitTitle")}
            >
              {formatDuration(hit.start_seconds)}
            </Button>
          ) : (
            <strong>{hit.label}</strong>
          )}

          <span className="search-hit-content">
            {hit.context_before && (
              <span className="search-hit-context">
                <HighlightText text={hit.context_before} query={query} />
              </span>
            )}
            <span className="search-hit-match">
            {hit.start_seconds !== undefined && <strong>{hit.label}</strong>}
            <HighlightText text={hit.text} query={query} />
            </span>
            {hit.context_after && (
              <span className="search-hit-context">
                <HighlightText text={hit.context_after} query={query} />
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  hasActiveFilter,
  onOpenSettings,
  onClearFilters
}: {
  hasActiveFilter: boolean;
  onOpenSettings: () => void;
  onClearFilters: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="empty-state">
      <div className="empty-illustration" aria-hidden="true">
        <MaterialIcon name="music_note" size={42} />
      </div>

      <div className="empty-title">
        {hasActiveFilter ? t("audioList.noMatches") : t("audioList.noAudio")}
      </div>

      <div className="empty-subtitle">
        {hasActiveFilter
          ? t("audioList.noMatchesDescription")
          : t("audioList.noAudioDescription")}
      </div>

      <div className="empty-actions">
        {hasActiveFilter ? (
          <Button variant="filled" onClick={onClearFilters}>
            {t("audioList.clearFilters")}
          </Button>
        ) : (
          <Button variant="filled" onClick={onOpenSettings}>
            {t("audioList.addLibrary")}
          </Button>
        )}

        <Button variant="outlined" onClick={onOpenSettings}>
          {t("audioList.openSettings")}
        </Button>
      </div>

      <div className="empty-support">
        {t("audioList.supportedFormats")}
      </div>
    </div>
  );
}

function ListSkeleton() {
  const { t } = useTranslation();
  return (
    <div className="list-skeleton" aria-label={t("audioList.loadingLabel")}>
      {Array.from({ length: 7 }).map((_, index) => (
        <div className="skeleton-row" key={index}>
          <span className="skeleton-cover" />
          <span className="skeleton-content">
            <span className="skeleton-line long" />
            <span className="skeleton-line medium" />
            <span className="skeleton-line short" />
          </span>
          <span className="skeleton-action" />
        </div>
      ))}
    </div>
  );
}

export default function AudioList({
  title,
  q,
  isLoading = false,
  isRefreshing = false,
  loadError,
  onOpenSettings,
  onClearFilters,
  hasActiveFilter,
  items,
  totalCount,
  hasMore,
  isLoadingMore,
  onLoadMore,
  selectedId,
  selectionMode,
  selectedAudioIds,
  onSelect,
  onPlay,
  onPlayAt,
  onAddToQueue,
  onPlayNext,
  isPlaylistView,
  onRemoveFromPlaylist,
  onMovePlaylistItem,
  onMovePlaylistItemTo,
  onEnterSelectionMode,
  onExitSelectionMode,
  onToggleAudioSelection,
  onToggleSelectAllLoaded,
  onClearAudioSelection,
  onBatchAddTags,
  onBatchRemoveTag,
  onBatchAddToPlaylist,
  onBatchSetFavorite
}: Props) {
  const { t } = useTranslation();
  const [draggedPlaylistItemId, setDraggedPlaylistItemId] = useState<number | null>(null);
  const canReorderPlaylist = Boolean(
    isPlaylistView && onMovePlaylistItem && onMovePlaylistItemTo
  );

  function findDraggedItem(): AudioItem | undefined {
    if (!draggedPlaylistItemId) return undefined;
    return items.find((item) => item.playlist_item_id === draggedPlaylistItemId);
  }

  const selectedRowIndex =
    selectedId !== undefined ? items.findIndex((item) => item.id === selectedId) : -1;
  const selectedCount = selectedAudioIds.size;
  const selectableItems = items.slice(0, MAX_BATCH_SELECTION);
  const allLoadedSelected =
    selectableItems.length > 0 &&
    selectableItems.every((item) => selectedAudioIds.has(item.id));

  function focusAudioRow(index: number) {
    const row = document.querySelector<HTMLElement>(
      `[data-audio-row-index="${index}"]`
    );
    row?.focus();
  }

  return (
    <section
      className="audio-list-panel"
      aria-busy={isLoading || isRefreshing}
    >
      {loadError && (
        <div className="list-error">
          <strong>{t("audioList.loadFailed")}</strong>
          <span>{loadError}</span>
          <Button preserveChildren onClick={onClearFilters}>{t("audioList.clearAndRetry")}</Button>
        </div>
      )}

      {isRefreshing && (
        <div className="list-refresh-indicator" aria-hidden="true">
          <span />
        </div>
      )}

      {isLoading && items.length === 0 && <ListSkeleton />}

      {!isLoading && !loadError && items.length === 0 && (
        <EmptyState
          hasActiveFilter={hasActiveFilter}
          onOpenSettings={onOpenSettings}
          onClearFilters={onClearFilters}
        />
      )}

      {!isLoading && !loadError && items.length > 0 && (
        <div
          className={`batch-selection-toolbar ${selectionMode ? "active" : ""}`}
          aria-label={t("audioList.batchOrganize")}
        >
          {!selectionMode ? (
            <Button variant="outlined" size="sm" onClick={onEnterSelectionMode}>
              {t("audioList.multiSelect")}
            </Button>
          ) : (
            <>
              <strong aria-live="polite">{t("audioList.selectedCount", { count: selectedCount })}</strong>
              <Button variant="text" size="sm" onClick={onToggleSelectAllLoaded}>
                {allLoadedSelected
                  ? t("audioList.deselectAll")
                  : items.length > MAX_BATCH_SELECTION
                    ? t("audioList.selectFirst", { count: MAX_BATCH_SELECTION })
                    : t("audioList.selectAllLoaded", { count: items.length })}
              </Button>
              <Button
                variant="text"
                size="sm"
                onClick={onClearAudioSelection}
                disabled={selectedCount === 0}
              >
                {t("audioList.clearSelection")}
              </Button>
              <span className="batch-selection-divider" aria-hidden="true" />
              <Button size="sm" onClick={onBatchAddTags} disabled={selectedCount === 0}>
                {t("audioList.addTags")}
              </Button>
              <Button size="sm" onClick={onBatchRemoveTag} disabled={selectedCount === 0}>
                {t("audioList.removeTags")}
              </Button>
              <Button
                size="sm"
                onClick={onBatchAddToPlaylist}
                disabled={selectedCount === 0}
              >
                {t("audioList.addPlaylist")}
              </Button>
              <Button
                variant="tonal"
                size="sm"
                onClick={() => onBatchSetFavorite(true)}
                disabled={selectedCount === 0}
              >
                {t("audioList.favorite")}
              </Button>
              <Button
                variant="tonal"
                size="sm"
                onClick={() => onBatchSetFavorite(false)}
                disabled={selectedCount === 0}
              >
                {t("audioList.unfavorite")}
              </Button>
              <Button variant="outlined" size="sm" onClick={onExitSelectionMode}>
                {t("audioList.done")}
              </Button>
            </>
          )}
        </div>
      )}

      <div className="audio-scroll-list" role="list" aria-label={t("audioList.listLabel", { title })}>
        {items.map((item, index) => {
          const draggable = Boolean(
            !selectionMode && canReorderPlaylist && item.playlist_item_id
          );
          const description = displayDescription(item);
          const rowIsSelected = selectedId === item.id;
          const rowIsBatchSelected = selectedAudioIds.has(item.id);
          const rowIsTabbable =
            rowIsSelected || (selectedRowIndex < 0 && index === 0);

          return (
            <div
              key={
                isPlaylistView && item.playlist_item_id
                  ? `${item.id}-${item.playlist_item_id}`
                  : item.id
              }
              className={[
                "audio-row",
                rowIsSelected ? "selected" : "",
                selectionMode ? "selection-mode" : "",
                rowIsBatchSelected ? "batch-selected" : ""
              ].filter(Boolean).join(" ")}
              role="listitem"
              tabIndex={rowIsTabbable ? 0 : -1}
              aria-current={rowIsSelected ? "true" : undefined}
              aria-label={t("audioList.audioLabel", { title: displayTitle(item) })}
              aria-keyshortcuts="Enter Space ArrowUp ArrowDown Home End"
              data-audio-row="true"
              data-audio-row-index={index}
              draggable={draggable}
              onDragStart={(e) => {
                if (!draggable || !item.playlist_item_id) return;
                setDraggedPlaylistItemId(item.playlist_item_id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                if (!draggable) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => {
                if (!draggable) return;
                e.preventDefault();

                const source = findDraggedItem();
                if (source) {
                  onMovePlaylistItemTo?.(source, item);
                }

                setDraggedPlaylistItemId(null);
              }}
              onDragEnd={() => setDraggedPlaylistItemId(null)}
              onClick={() =>
                selectionMode ? onToggleAudioSelection(item.id) : onSelect(item)
              }
              onDoubleClick={() => {
                if (!selectionMode) onPlay(item);
              }}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;

                if (selectionMode && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onToggleAudioSelection(item.id);
                  return;
                }

                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();

                  const nextIndex =
                    e.key === "ArrowDown"
                      ? Math.min(items.length - 1, index + 1)
                      : Math.max(0, index - 1);

                  const nextItem = items[nextIndex];

                  if (nextItem && nextIndex !== index) {
                    onSelect(nextItem);
                    focusAudioRow(nextIndex);
                  }

                  return;
                }

                if (e.key === "Home" || e.key === "End") {
                  e.preventDefault();

                  const nextIndex = e.key === "Home" ? 0 : items.length - 1;
                  const nextItem = items[nextIndex];

                  if (nextItem && nextIndex !== index) {
                    onSelect(nextItem);
                    focusAudioRow(nextIndex);
                  }

                  return;
                }

                if (e.key === "Enter") {
                  onSelect(item);
                  return;
                }

                if (e.key === " ") {
                  e.preventDefault();
                  onPlay(item);
                }
              }}
              style={{
                opacity:
                  draggedPlaylistItemId && draggedPlaylistItemId === item.playlist_item_id
                    ? 0.62
                    : 1
              }}
            >
              {selectionMode && (
                <label
                  className="batch-row-checkbox"
                  onClick={(event) => event.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={rowIsBatchSelected}
                    aria-label={t("audioList.selectAudio", { title: displayTitle(item) })}
                    onChange={() => onToggleAudioSelection(item.id)}
                  />
                </label>
              )}

              <CoverThumb item={item} />

              <div className="audio-info">
                <div className="title-line">
                  <div className="title">
                    {item.is_favorite && <MaterialIcon className="favorite-icon" name="star" size={16} />}
                    <HighlightText text={displayTitle(item)} query={q} />
                  </div>

                  {item.is_missing ? <span className="badge danger">{t("audioList.missingBadge")}</span> : null}

                  {draggable && (
                    <span className="drag-hint" title={t("audioList.dragHint")}>
                      <MaterialIcon name="drag_indicator" size={18} />
                    </span>
                  )}
                </div>

                <div className="meta-line">
                  <span>
                    <HighlightText text={displayAuthor(item) || "Unknown"} query={q} />
                  </span>
                  <span className="meta-dot">·</span>
                  <span>{formatDuration(item.duration_seconds)}</span>
                  {item.language && (
                    <>
                      <span className="meta-dot">·</span>
                      <span>{item.language}</span>
                    </>
                  )}
                </div>

                {description && (
                  <div className="description-line">
                    <HighlightText text={description} query={q} />
                  </div>
                )}

                <RowTags item={item} query={q} />

                <div className="row-status">
                  <StatusPill label={t("audioList.transcript")} value={item.transcript_status} />
                  <StatusPill label={t("common.technical.ai")} value={item.ai_status} />
                </div>

                <SearchHits item={item} query={q} onPlayAt={onPlayAt} />
              </div>

              <div className="row-actions">
                <Button
                  preserveChildren
                  type="button"
                  aria-label={t("audioList.playNextLabel", { title: displayTitle(item) })}
                  title={t("audioList.playNext")}
                  disabled={item.is_missing}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPlayNext(item);
                  }}
                >
                  <MaterialIcon name="playlist_play" size={19} />
                </Button>

                <Button
                  preserveChildren
                  type="button"
                  aria-label={t("audioList.addQueueLabel", { title: displayTitle(item) })}
                  title={t("audioList.addQueue")}
                  disabled={item.is_missing}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddToQueue(item);
                  }}
                >
                  <MaterialIcon name="queue_music" size={19} />
                </Button>

                <Button
                  type="button"
                  variant="filled"
                  className="row-play-button"
                  aria-label={t("audioList.playLabel", { title: displayTitle(item) })}
                  disabled={item.is_missing}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPlay(item);
                  }}
                >
                  {t("audioList.play")}
                </Button>

                {isPlaylistView && item.playlist_item_id && (
                  <>
                    {canReorderPlaylist && (
                      <>
                        <Button preserveChildren
                          type="button"
                          aria-label={t("audioList.moveUpLabel", { title: displayTitle(item) })}
                          onClick={(e) => {
                            e.stopPropagation();
                            onMovePlaylistItem?.(item, "up");
                          }}
                          title={t("audioList.moveUp")}
                        >
                          <MaterialIcon name="keyboard_arrow_up" size={18} />
                        </Button>

                        <Button preserveChildren
                          type="button"
                          aria-label={t("audioList.moveDownLabel", { title: displayTitle(item) })}
                          onClick={(e) => {
                            e.stopPropagation();
                            onMovePlaylistItem?.(item, "down");
                          }}
                          title={t("audioList.moveDown")}
                        >
                          <MaterialIcon name="keyboard_arrow_down" size={18} />
                        </Button>
                      </>
                    )}

                    <Button preserveChildren
                      type="button"
                      aria-label={t("audioList.removePlaylistLabel", { title: displayTitle(item) })}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveFromPlaylist?.(item);
                      }}
                      title={t("audioList.removePlaylist")}
                    >
                      {t("common.actions.remove")}
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        })}

        {items.length > 0 && (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: 12,
              padding: "18px 8px 28px",
              color: "var(--text-muted)",
              fontSize: 13
            }}
          >
            <span>
              {t("audioList.loadedCount", {
                loaded: items.length,
                total: typeof totalCount === "number" ? ` / ${totalCount}` : ""
              })}
            </span>

            {hasMore && (
              <Button variant="outlined" onClick={onLoadMore} disabled={isLoadingMore}>
                {isLoadingMore ? t("audioList.loadingMore") : t("audioList.loadMore")}
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
