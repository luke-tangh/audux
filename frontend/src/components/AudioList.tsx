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

function CoverThumb({ item }: { item: AudioItem }) {
  return (
    <div className="cover-thumb">
      <span>♪</span>
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
      <div className="toolbar">
        <div className="toolbar-title">
          <strong>{title}</strong>
          <span>{items.length} items</span>
        </div>

        <input
          className="search-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索 title / description / tags / transcript"
        />

        <label className="toolbar-check">
          <input
            type="checkbox"
            checked={missingDescriptionOnly}
            onChange={(e) => setMissingDescriptionOnly(e.target.checked)}
          />
          缺描述
        </label>

        <div className="toolbar-actions">
          <button onClick={onBatchTranscribe} disabled={items.length === 0}>
            批量转写
          </button>
          <button onClick={onBatchAnalyze} disabled={items.length === 0}>
            批量 AI 分析
          </button>
        </div>
      </div>

      <div className="list">
        {items.length === 0 && <div className="empty">暂无音频。请在 Settings 添加目录并扫描。</div>}

        {items.map((item) => (
          <div
            key={item.id}
            className={`audio-row ${selectedId === item.id ? "selected" : ""}`}
            onClick={() => onSelect(item)}
            onDoubleClick={() => onPlay(item)}
          >
            <CoverThumb item={item} />

            <div className="audio-info">
              <div className="title">
                {item.is_favorite ? "★ " : ""}
                {displayTitle(item)}
                {item.is_missing ? <span className="badge danger">missing</span> : null}
              </div>

              <div className="meta">
                {displayAuthor(item) || "Unknown"} · {formatDuration(item.duration_seconds)}
              </div>

              <div className="status">
                transcript: {item.transcript_status} · ai: {item.ai_status}
              </div>
            </div>

            <button
              onClick={(e) => {
                e.stopPropagation();
                onPlay(item);
              }}
            >
              Play
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
