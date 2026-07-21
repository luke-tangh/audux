import type { Playlist, Tag } from "../types";

type ViewMode =
  | "library"
  | "favorites"
  | "playlist"
  | "settings"
  | "missingDescription"
  | "transcribed"
  | "missing"
  | "aiFailed";

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
  function openView(view: ViewMode) {
    props.setView(view);
    props.setSelectedPlaylistId(null);

    if (view !== "library") {
      props.setSelectedTag(undefined);
    }
  }

  function navClass(active: boolean) {
    return active ? "nav-card active" : "nav-card";
  }

  function pillClass(active: boolean) {
    return active ? "sidebar-pill active" : "sidebar-pill";
  }

  const allAudioActive = props.view === "library" && !props.selectedTag;
  const favoriteActive = props.view === "favorites";
  const settingsActive = props.view === "settings";

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-orb">♪</div>

        <div className="brand-copy">
          <h2>Local Audio</h2>
          <p>私人音频知识库</p>
        </div>
      </div>

      <nav className="sidebar-nav">
        <button
          className={navClass(allAudioActive)}
          onClick={() => {
            props.setView("library");
            props.setSelectedTag(undefined);
            props.setSelectedPlaylistId(null);
          }}
        >
          <span className="nav-symbol">⌂</span>
          <span>
            <strong>资料库</strong>
            <em>全部音频</em>
          </span>
        </button>

        <button
          className={navClass(favoriteActive)}
          onClick={() => openView("favorites")}
        >
          <span className="nav-symbol">★</span>
          <span>
            <strong>收藏</strong>
            <em>常听内容</em>
          </span>
        </button>

        <button
          className={navClass(props.view === "missingDescription")}
          onClick={() => openView("missingDescription")}
        >
          <span className="nav-symbol">✎</span>
          <span>
            <strong>缺少描述</strong>
            <em>需要整理</em>
          </span>
        </button>

        <button
          className={navClass(props.view === "transcribed")}
          onClick={() => openView("transcribed")}
        >
          <span className="nav-symbol">¶</span>
          <span>
            <strong>已转写</strong>
            <em>可全文检索</em>
          </span>
        </button>

        <button
          className={navClass(props.view === "missing")}
          onClick={() => openView("missing")}
        >
          <span className="nav-symbol">!</span>
          <span>
            <strong>文件缺失</strong>
            <em>需要重新定位</em>
          </span>
        </button>

        <button
          className={navClass(props.view === "aiFailed")}
          onClick={() => openView("aiFailed")}
        >
          <span className="nav-symbol">⚡</span>
          <span>
            <strong>AI 失败</strong>
            <em>重试分析</em>
          </span>
        </button>
      </nav>

      <div className="sidebar-section">
        <div className="sidebar-section-heading">
          <h3>播放列表</h3>
          <span>{props.playlists.length}</span>
        </div>

        {props.playlists.length === 0 && (
          <div className="sidebar-empty">
            暂无播放列表
            <br />
            可在设置中创建
          </div>
        )}

        <div className="sidebar-scroll-area">
          {props.playlists.map((playlist) => (
            <button
              key={playlist.id}
              className={
                props.view === "playlist" && props.selectedPlaylistId === playlist.id
                  ? "playlist-row active"
                  : "playlist-row"
              }
              title={playlist.description || playlist.name}
              onClick={() => {
                props.setView("playlist");
                props.setSelectedTag(undefined);
                props.setSelectedPlaylistId(playlist.id);
              }}
            >
              <span>▸</span>
              <strong>{playlist.name}</strong>
            </button>
          ))}
        </div>
      </div>

      <div className="sidebar-section tag-section">
        <div className="sidebar-section-heading">
          <h3>标签</h3>
          <span>{props.tags.length}</span>
        </div>

        <div className="tag-cloud-nav">
          <button
            className={pillClass(allAudioActive)}
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
              className={pillClass(props.selectedTag === tag.name)}
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

      <div className="sidebar-footer">
        <button
          className={settingsActive ? "settings-nav active" : "settings-nav"}
          onClick={() => {
            props.setView("settings");
            props.setSelectedPlaylistId(null);
          }}
        >
          <span>⚙</span>
          <strong>设置中心</strong>
        </button>

        <div className="privacy-card">
          <strong>本地优先</strong>
          <span>音频文件保留在本机。只有你配置 AI endpoint 后，分析任务才会发送 metadata 与 transcript。</span>
        </div>
      </div>
    </aside>
  );
}
