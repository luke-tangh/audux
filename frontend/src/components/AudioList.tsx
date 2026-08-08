import { useState } from "react";
import { api } from "../api";
import type { AudioItem } from "../types";
import { displayAuthor, displayDescription, displayTitle, formatDuration } from "../types";
import { Button, StatusPill, MaterialIcon } from "./ui";

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
              aria-label={`从 ${formatDuration(hit.start_seconds)} 开始播放 ${displayTitle(item)}`}
              onClick={(e) => {
                e.stopPropagation();
                onPlayAt(item, hit.start_seconds || 0);
              }}
              title="从该 transcript 命中位置播放"
            >
              {formatDuration(hit.start_seconds)}
            </Button>
          ) : (
            <strong>{hit.label}</strong>
          )}

          <span>
            {hit.start_seconds !== undefined && <strong>{hit.label}</strong>}
            <HighlightText text={hit.text} query={query} />
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
  return (
    <div className="empty-state">
      <div className="empty-illustration" aria-hidden="true">
        <MaterialIcon name="music_note" size={42} />
      </div>

      <div className="empty-title">
        {hasActiveFilter ? "没有找到匹配的音频" : "还没有导入音频"}
      </div>

      <div className="empty-subtitle">
        {hasActiveFilter
          ? "当前搜索或筛选条件没有命中结果。可以清空筛选后重新浏览。"
          : "添加本地媒体库目录后，系统会自动读取 metadata、封面，并支持转写和 AI 标签整理。"}
      </div>

      <div className="empty-actions">
        {hasActiveFilter ? (
          <Button variant="filled" onClick={onClearFilters}>
            清空筛选
          </Button>
        ) : (
          <Button variant="filled" onClick={onOpenSettings}>
            添加媒体库
          </Button>
        )}

        <Button variant="outlined" onClick={onOpenSettings}>
          打开设置
        </Button>
      </div>

      <div className="empty-support">
        支持 MP3 / M4A / FLAC / WAV / OGG · 可转写 · 可 AI 生成描述和标签
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="list-skeleton" aria-label="正在加载音频列表">
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
  const [draggedPlaylistItemId, setDraggedPlaylistItemId] = useState<number | null>(null);

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
          <strong>列表加载失败</strong>
          <span>{loadError}</span>
          <Button preserveChildren onClick={onClearFilters}>清空筛选后重试</Button>
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
          aria-label="批量整理"
        >
          {!selectionMode ? (
            <Button variant="outlined" size="sm" onClick={onEnterSelectionMode}>
              多选整理
            </Button>
          ) : (
            <>
              <strong aria-live="polite">已选择 {selectedCount} 个</strong>
              <Button variant="text" size="sm" onClick={onToggleSelectAllLoaded}>
                {allLoadedSelected
                  ? "取消全选"
                  : items.length > MAX_BATCH_SELECTION
                    ? `选择前 ${MAX_BATCH_SELECTION} 个`
                    : `全选已加载 (${items.length})`}
              </Button>
              <Button
                variant="text"
                size="sm"
                onClick={onClearAudioSelection}
                disabled={selectedCount === 0}
              >
                清空选择
              </Button>
              <span className="batch-selection-divider" aria-hidden="true" />
              <Button size="sm" onClick={onBatchAddTags} disabled={selectedCount === 0}>
                添加标签
              </Button>
              <Button size="sm" onClick={onBatchRemoveTag} disabled={selectedCount === 0}>
                移除标签
              </Button>
              <Button
                size="sm"
                onClick={onBatchAddToPlaylist}
                disabled={selectedCount === 0}
              >
                加入 Playlist
              </Button>
              <Button
                variant="tonal"
                size="sm"
                onClick={() => onBatchSetFavorite(true)}
                disabled={selectedCount === 0}
              >
                收藏
              </Button>
              <Button
                variant="tonal"
                size="sm"
                onClick={() => onBatchSetFavorite(false)}
                disabled={selectedCount === 0}
              >
                取消收藏
              </Button>
              <Button variant="outlined" size="sm" onClick={onExitSelectionMode}>
                完成
              </Button>
            </>
          )}
        </div>
      )}

      <div className="audio-scroll-list" role="list" aria-label={`${title} 音频列表`}>
        {items.map((item, index) => {
          const draggable = Boolean(
            !selectionMode && isPlaylistView && item.playlist_item_id
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
              aria-label={`音频：${displayTitle(item)}`}
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
                    aria-label={`选择 ${displayTitle(item)}`}
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

                  {item.is_missing ? <span className="badge danger">missing</span> : null}

                  {draggable && (
                    <span className="drag-hint" title="拖拽可调整 playlist 顺序">
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
                  <StatusPill label="转写" value={item.transcript_status} />
                  <StatusPill label="AI" value={item.ai_status} />
                </div>

                <SearchHits item={item} query={q} onPlayAt={onPlayAt} />
              </div>

              <div className="row-actions">
                <Button
                  type="button"
                  variant="filled"
                  className="row-play-button"
                  aria-label={`播放 ${displayTitle(item)}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPlay(item);
                  }}
                >
                  播放
                </Button>

                {isPlaylistView && item.playlist_item_id && (
                  <>
                    <Button preserveChildren
                      type="button"
                      aria-label={`在当前 playlist 中上移 ${displayTitle(item)}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onMovePlaylistItem?.(item, "up");
                      }}
                      title="在当前 playlist 中上移"
                    >
                      <MaterialIcon name="keyboard_arrow_up" size={18} />
                    </Button>

                    <Button preserveChildren
                      type="button"
                      aria-label={`在当前 playlist 中下移 ${displayTitle(item)}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onMovePlaylistItem?.(item, "down");
                      }}
                      title="在当前 playlist 中下移"
                    >
                      <MaterialIcon name="keyboard_arrow_down" size={18} />
                    </Button>

                    <Button preserveChildren
                      type="button"
                      aria-label={`从当前 playlist 移除 ${displayTitle(item)}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveFromPlaylist?.(item);
                      }}
                      title="从当前 playlist 移除"
                    >
                      移除
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
              已加载 {items.length}
              {typeof totalCount === "number" ? ` / ${totalCount}` : ""} 个音频
            </span>

            {hasMore && (
              <Button variant="outlined" onClick={onLoadMore} disabled={isLoadingMore}>
                {isLoadingMore ? "加载中..." : "加载更多"}
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
