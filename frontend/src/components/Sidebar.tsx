import type { Playlist, Tag } from "../types";

type ViewMode = "library" | "favorites" | "playlist" | "settings";

type Props = {
  view: ViewMode;
  setView: (v: ViewMode) => void;
  tags: Tag[];
  selectedTag?: string;
  setSelectedTag: (tag?: string) => void;
  playlists: Playlist[];
  selectedPlaylistId: number | null;
  setSelectedPlaylistId: (id: number | null) => void;
  refresh: () => void;
};

export default function Sidebar(props: Props) {
  const allAudioActive = props.view === "library" && !props.selectedTag;
  const favoriteActive = props.view === "favorites";
  const settingsActive = props.view === "settings";

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-logo">♪</div>

        <div className="brand-text">
          <h2>Local Audio</h2>
          <p>私人音频知识库</p>
        </div>
      </div>

      <nav className="nav-section">
        <button
          className={allAudioActive ? "nav-button active" : "nav-button"}
          onClick={() => {
            props.setView("library");
            props.setSelectedTag(undefined);
            props.setSelectedPlaylistId(null);
          }}
        >
          <span className="nav-icon">⌂</span>
          <span className="nav-main">
            <span className="nav-title">资料库</span>
            <span className="nav-subtitle">全部音频</span>
          </span>
        </button>

        <button
          className={favoriteActive ? "nav-button active" : "nav-button"}
          onClick={() => {
            props.setView("favorites");
            props.setSelectedTag(undefined);
            props.setSelectedPlaylistId(null);
          }}
        >
          <span className="nav-icon">★</span>
          <span className="nav-main">
            <span className="nav-title">收藏</span>
            <span className="nav-subtitle">常听内容</span>
          </span>
        </button>

        <button
          className={settingsActive ? "nav-button active" : "nav-button"}
          onClick={() => {
            props.setView("settings");
            props.setSelectedPlaylistId(null);
          }}
        >
          <span className="nav-icon">⚙</span>
          <span className="nav-main">
            <span className="nav-title">设置</span>
            <span className="nav-subtitle">扫描 / AI / 导出</span>
          </span>
        </button>
      </nav>

      <div className="section sidebar-section">
        <div className="sidebar-section-title">
          <h3>标签</h3>
          <span>{props.tags.length}</span>
        </div>

        <div className="sidebar-pills">
          <button
            className={allAudioActive ? "active small" : "small"}
            onClick={() => {
              props.setView("library");
              props.setSelectedTag(undefined);
              props.setSelectedPlaylistId(null);
            }}
          >
            全部标签
          </button>

          {props.tags.map((tag) => (
            <button
              key={tag.id}
              className={props.selectedTag === tag.name ? "active small" : "small"}
              onClick={() => {
                props.setView("library");
                props.setSelectedPlaylistId(null);
                props.setSelectedTag(tag.name);
              }}
              title={`查看标签：${tag.name}`}
            >
              #{tag.name}
            </button>
          ))}
        </div>
      </div>

      <div className="section sidebar-section">
        <div className="sidebar-section-title">
          <h3>播放列表</h3>
          <span>{props.playlists.length}</span>
        </div>

        {props.playlists.length === 0 && (
          <div className="playlist-empty">
            暂无播放列表
            <br />
            可在设置中创建
          </div>
        )}

        <div className="sidebar-scroll-list">
          {props.playlists.map((p) => (
            <button
              key={p.id}
              className={
                props.view === "playlist" && props.selectedPlaylistId === p.id
                  ? "active small playlist-button"
                  : "small playlist-button"
              }
              title={p.description || p.name}
              onClick={() => {
                props.setView("playlist");
                props.setSelectedTag(undefined);
                props.setSelectedPlaylistId(p.id);
              }}
            >
              <span>▸</span>
              {p.name}
            </button>
          ))}
        </div>
      </div>

      <div className="sidebar-footer">
        <div className="sidebar-hint">
          <strong>提示</strong>
          <span>双击音频可快速播放，AI 分析完成后可一键接受描述与标签。</span>
        </div>
      </div>
    </aside>
  );
}
