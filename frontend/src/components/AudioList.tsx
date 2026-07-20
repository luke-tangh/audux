import { api } from "../api";
import type { AudioItem } from "../types";
import { displayAuthor, displayTitle, formatDuration } from "../types";

type Props = {
  title: string;
  q: string;
  setQ: (q: string) => void;
  missingDescriptionOnly: boolean;
  setMissingDescriptionOnly: (v: boolean) => void;
  items: AudioItem[];
  selectedId?: number;
  onSelect: (item: AudioItem) => void;
  onPlay: (item: AudioItem) => void;
  onBatchTranscribe: () => void;
  onBatchAnalyze: () => void;
};

const STATUS_TEXT: Record<string, string> = {
  none: "未开始",
  pending: "等待中",
  running: "进行中",
  done: "已完成",
  failed: "失败",
  canceled: "已取消"
};

function statusClass(value?: string): string {
  return (value || "none").toLowerCase().replace(/[^a-z0-9_-]/g, "") || "none";
}

function StatusPill({
  label,
  value
}: {
  label: string;
  value?: string;
}) {
  const cls = statusClass(value);
  const text = STATUS_TEXT[cls] || value || "未开始";

  return (
    <span className={`status-pill ${cls}`}>
      <span>{label}</span>
      {text}
    </span>
  );
}

function CoverThumb({ item }: { item: AudioItem }) {
  return (
    <div className={`cover-thumb ${item.is_missing ? "missing" : ""}`}>
      <span aria-hidden="true">♪</span>

      {item.cover_path && (
        <img
          src={api.coverUrl(item.id, item.updated_at)}
          alt=""
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      )}
    </div>
  );
}

function EmptyState({
  q,
  missingDescriptionOnly
}: {
  q: string;
  missingDescriptionOnly: boolean;
}) {
  const hasFilter = Boolean(q.trim()) || missingDescriptionOnly;

  return (
    <div className="empty-state">
      <div className="empty-icon">🎧</div>

      <div className="empty-title">
        {hasFilter ? "没有找到匹配的音频" : "还没有导入音频"}
      </div>

      <div className="empty-subtitle">
        {hasFilter
          ? "可以尝试清空搜索关键词，或关闭“缺描述”筛选。"
          : "请进入设置添加媒体库目录，然后点击扫描。"}
      </div>
    </div>
  );
}

export default function AudioList({
  title,
  q,
  setQ,
  missingDescriptionOnly,
  setMissingDescriptionOnly,
  items,
  selectedId,
  onSelect,
  onPlay,
  onBatchTranscribe,
  onBatchAnalyze
}: Props) {
  return (
    <section className="audio-list">
      <div className="library-header">
        <div className="toolbar-title">
          <div>
            <span className="eyebrow">当前视图</span>
            <strong>{title}</strong>
          </div>

          <span className="count-chip">{items.length} 个音频</span>
        </div>

        <div className="toolbar-controls">
          <div className="search-box">
            <span aria-hidden="true">⌕</span>

            <input
              className="search-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索标题、作者、描述、标签或转写文本"
            />
          </div>

          <label className="filter-pill">
            <input
              type="checkbox"
              checked={missingDescriptionOnly}
              onChange={(e) => setMissingDescriptionOnly(e.target.checked)}
            />
            只看缺描述
          </label>
        </div>

        <div className="toolbar-actions">
          <button
            className="ghost-button"
            onClick={onBatchTranscribe}
            disabled={items.length === 0}
          >
            批量转写
          </button>

          <button
            className="primary-soft-button"
            onClick={onBatchAnalyze}
            disabled={items.length === 0}
          >
            批量 AI 分析
          </button>
        </div>
      </div>

      <div className="list">
        {items.length === 0 && (
          <EmptyState q={q} missingDescriptionOnly={missingDescriptionOnly} />
        )}

        {items.map((item) => (
          <div
            key={item.id}
            className={`audio-row ${selectedId === item.id ? "selected" : ""}`}
            onClick={() => onSelect(item)}
            onDoubleClick={() => onPlay(item)}
          >
            <CoverThumb item={item} />

            <div className="audio-info">
              <div className="title-line">
                <div className="title">
                  {item.is_favorite ? "★ " : ""}
                  {displayTitle(item)}
                </div>

                {item.is_missing ? <span className="badge danger">missing</span> : null}
              </div>

              <div className="meta-line">
                <span>{displayAuthor(item) || "Unknown"}</span>
                <span className="meta-dot">·</span>
                <span>{formatDuration(item.duration_seconds)}</span>
                {item.language && (
                  <>
                    <span className="meta-dot">·</span>
                    <span>{item.language}</span>
                  </>
                )}
              </div>

              <div className="row-status">
                <StatusPill label="转写" value={item.transcript_status} />
                <StatusPill label="AI" value={item.ai_status} />
              </div>
            </div>

            <button
              className="row-play-button"
              onClick={(e) => {
                e.stopPropagation();
                onPlay(item);
              }}
            >
              播放
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
