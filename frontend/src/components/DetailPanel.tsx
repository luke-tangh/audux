import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { AISuggestions, AudioItem, Playlist, Tag, Transcript } from "../types";
import { displayDescription, displayTitle, formatDuration } from "../types";

type Props = {
  audio: AudioItem | null;
  refresh: () => void;
  onPlay: (a: AudioItem) => void;
  playlists: Playlist[];
};

export default function DetailPanel({ audio, refresh, onPlay, playlists }: Props) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [editing, setEditing] = useState<Partial<AudioItem>>({});
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<AISuggestions | null>(null);
  const [selectedPlaylist, setSelectedPlaylist] = useState<number | "">("");

  const acceptedTagNames = useMemo(() => {
    return new Set(tags.map((t) => t.name));
  }, [tags]);

  useEffect(() => {
    async function load() {
      setTranscript(null);
      setAiSuggestions(null);

      if (!audio) return;

      const detail = await api.getAudioDetail(audio.id);
      setTags(detail.tags);
      setEditing({
        title_user: detail.audio.title_user || "",
        author_user: detail.audio.author_user || "",
        album_user: detail.audio.album_user || "",
        description_user: detail.audio.description_user || "",
        language: detail.audio.language || "",
        is_favorite: detail.audio.is_favorite
      });

      api.getTranscript(audio.id).then(setTranscript).catch(() => setTranscript(null));
      api.getAiSuggestions(audio.id).then(setAiSuggestions).catch(() => setAiSuggestions(null));
    }

    load().catch(console.error);
  }, [audio?.id]);

  if (!audio) {
    return <section className="detail-panel empty">请选择一个音频</section>;
  }

  async function reloadTagsAndSuggestions() {
    const detail = await api.getAudioDetail(audio!.id);
    setTags(detail.tags);

    const suggestions = await api.getAiSuggestions(audio!.id).catch(() => null);
    setAiSuggestions(suggestions);
  }

  async function save() {
    await api.updateAudio(audio!.id, editing);
    refresh();
  }

  async function addTags() {
    const names = tagInput
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

    if (names.length === 0) return;

    await api.addTags(audio!.id, names, "user");
    setTagInput("");

    await reloadTagsAndSuggestions();
    refresh();
  }

  async function removeTag(tagId: number) {
    await api.removeTag(audio!.id, tagId);

    await reloadTagsAndSuggestions();
    refresh();
  }

  async function transcribe() {
    await api.transcribe(audio!.id);
    refresh();
    alert("已创建转写任务。可在 Settings 的任务队列中查看状态。");
  }

  async function analyze() {
    const settings = await api.listSettings();
    const endpoint = settings.find((s) => s.key === "llm.endpoint")?.value;
    const modelName = settings.find((s) => s.key === "llm.model_name")?.value;

    if (!endpoint || !modelName) {
      alert("请先在 Settings 中配置本地 LLM endpoint 和 model_name。");
      return;
    }

    await api.analyze(audio!.id);
    refresh();
    alert("已创建 AI 分析任务。完成后会显示 AI 建议描述和标签。");
  }

  async function addToPlaylist() {
    if (!selectedPlaylist) return;

    await api.addToPlaylist(Number(selectedPlaylist), audio!.id);
    alert("已添加到 playlist");
  }

  async function acceptAiDescription() {
    const description = aiSuggestions?.description || audio?.description_ai;
    if (!description) return;

    await api.updateAudio(audio!.id, {
      description_user: description
    });

    setEditing({ ...editing, description_user: description });
    refresh();
  }

  async function acceptAiTag(tagName: string) {
    await api.addTags(audio!.id, [tagName], "ai");

    await reloadTagsAndSuggestions();
    refresh();
  }

  async function acceptAllAiTags() {
    const names =
      aiSuggestions?.tags
        .map((x) => x.trim())
        .filter((x) => x && !acceptedTagNames.has(x)) || [];

    if (names.length === 0) return;

    await api.addTags(audio!.id, names, "ai");

    await reloadTagsAndSuggestions();
    refresh();
  }

  function jumpToSegment(startSeconds: number) {
    onPlay(audio!);

    setTimeout(() => {
      const audioEl = document.querySelector("audio");
      if (audioEl) {
        audioEl.currentTime = startSeconds;
        audioEl.play().catch(console.error);
      }
    }, 120);
  }

  const hasAiDescription = Boolean(aiSuggestions?.description || audio.description_ai);
  const aiTags = aiSuggestions?.tags || [];

  return (
    <section className="detail-panel">
      <h2>{displayTitle(audio)}</h2>

      <div className="actions">
        <button onClick={() => onPlay(audio)}>播放</button>
        <button onClick={transcribe}>转写</button>
        <button onClick={analyze}>AI 分析</button>
      </div>

      <div className="field-grid">
        <label>
          用户标题
          <input
            value={editing.title_user as string}
            onChange={(e) => setEditing({ ...editing, title_user: e.target.value })}
          />
        </label>

        <label>
          作者
          <input
            value={editing.author_user as string}
            onChange={(e) => setEditing({ ...editing, author_user: e.target.value })}
          />
        </label>

        <label>
          专辑
          <input
            value={editing.album_user as string}
            onChange={(e) => setEditing({ ...editing, album_user: e.target.value })}
          />
        </label>

        <label>
          语言
          <input
            value={editing.language as string}
            onChange={(e) => setEditing({ ...editing, language: e.target.value })}
          />
        </label>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={Boolean(editing.is_favorite)}
            onChange={(e) => setEditing({ ...editing, is_favorite: e.target.checked })}
          />
          收藏
        </label>

        <label className="wide">
          用户描述
          <textarea
            value={editing.description_user as string}
            onChange={(e) => setEditing({ ...editing, description_user: e.target.value })}
          />
        </label>
      </div>

      <button onClick={save}>保存 metadata</button>

      <div className="section">
        <h3>文件信息</h3>
        <p>文件名：{audio.file_name}</p>
        <p>路径：{audio.file_path}</p>
        <p>时长：{formatDuration(audio.duration_seconds)}</p>
        <p>大小：{audio.file_size ? `${Math.round(audio.file_size / 1024 / 1024)} MB` : "-"}</p>
        <p>播放位置：{formatDuration(audio.last_position_seconds)}</p>
        <p>播放次数：{audio.play_count}</p>
        <p>上次播放：{audio.last_played_at || "-"}</p>
        <p>Transcript 状态：{audio.transcript_status}</p>
        <p>AI 状态：{audio.ai_status}</p>
      </div>

      <div className="section">
        <h3>Tags</h3>

        <div className="tag-list">
          {tags.map((tag) => (
            <span className="tag" key={tag.id}>
              #{tag.name}
              <button onClick={() => removeTag(tag.id)}>×</button>
            </span>
          ))}
        </div>

        <div className="inline-form">
          <input
            value={tagInput}
            placeholder="标签，用逗号分隔"
            onChange={(e) => setTagInput(e.target.value)}
          />
          <button onClick={addTags}>添加</button>
        </div>
      </div>

      <div className="section">
        <h3>Playlist</h3>

        <div className="inline-form">
          <select
            value={selectedPlaylist}
            onChange={(e) => setSelectedPlaylist(e.target.value ? Number(e.target.value) : "")}
          >
            <option value="">选择 playlist</option>
            {playlists.map((p) => (
              <option value={p.id} key={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <button onClick={addToPlaylist}>加入</button>
        </div>
      </div>

      <div className="section">
        <h3>Description</h3>
        <p>{displayDescription(audio) || "暂无描述"}</p>

        {hasAiDescription && (
          <div className="ai-box">
            <h4>AI 建议描述</h4>
            <p>{aiSuggestions?.description || audio.description_ai}</p>
            <button onClick={acceptAiDescription}>接受为用户描述</button>
          </div>
        )}
      </div>

      <div className="section">
        <h3>AI 标签建议</h3>

        {aiTags.length === 0 && <p>暂无 AI 标签建议</p>}

        {aiTags.length > 0 && (
          <>
            <div className="tag-list">
              {aiTags.map((tagName) => {
                const accepted = acceptedTagNames.has(tagName);

                return (
                  <span className={accepted ? "tag accepted" : "tag suggestion"} key={tagName}>
                    #{tagName}
                    {accepted ? (
                      <em>已接受</em>
                    ) : (
                      <button onClick={() => acceptAiTag(tagName)}>接受</button>
                    )}
                  </span>
                );
              })}
            </div>

            <button className="section-button" onClick={acceptAllAiTags}>
              接受全部未添加标签
            </button>
          </>
        )}
      </div>

      <div className="section">
        <h3>Transcript</h3>

        {!transcript && <p>暂无 transcript</p>}

        {transcript && (
          <div className="transcript">
            {transcript.segments.length > 0 ? (
              transcript.segments.map((seg) => (
                <div key={seg.id} className="segment">
                  <button onClick={() => jumpToSegment(seg.start_seconds)}>
                    {formatDuration(seg.start_seconds)}
                  </button>
                  <span>{seg.text}</span>
                </div>
              ))
            ) : (
              <p>{transcript.transcript.full_text}</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
