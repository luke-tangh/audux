import { useEffect, useMemo, useState } from "react";
import { api, endpointPrivacyWarning } from "../api";
import type { AISuggestions, AudioItem, Playlist, Tag, Transcript } from "../types";
import { displayAuthor, displayDescription, displayTitle, formatDuration } from "../types";
import { pickAudioFile } from "../tauri";

type ToastType = "info" | "success" | "error";
type InspectorTab = "overview" | "ai" | "transcript" | "file";

type Props = {
  audio: AudioItem | null;
  refresh: () => void;
  onPlay: (a: AudioItem) => void;
  playlists: Playlist[];
  selectedPlaylistId?: number | null;
  onDeleted: (audioId: number) => void;
  notify?: (message: string, type?: ToastType) => void;
};

export default function DetailPanel({
  audio,
  refresh,
  onPlay,
  playlists,
  selectedPlaylistId,
  onDeleted,
  notify
}: Props) {
  const [activeTab, setActiveTab] = useState<InspectorTab>("overview");

  const [tags, setTags] = useState<Tag[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [selectedExistingTag, setSelectedExistingTag] = useState<number | "">("");
  const [editing, setEditing] = useState<Partial<AudioItem>>({});
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<AISuggestions | null>(null);
  const [selectedPlaylist, setSelectedPlaylist] = useState<number | "">("");
  const [relocatePath, setRelocatePath] = useState("");
  const [coverVersion, setCoverVersion] = useState(Date.now());

  const acceptedTagNames = useMemo(() => {
    return new Set(tags.map((t) => t.name));
  }, [tags]);

  const availableExistingTags = useMemo(() => {
    return allTags.filter((tag) => !acceptedTagNames.has(tag.name));
  }, [allTags, acceptedTagNames]);

  useEffect(() => {
    let canceled = false;

    async function load() {
      setTranscript(null);
      setAiSuggestions(null);
      setRelocatePath("");
      setSelectedExistingTag("");
      setActiveTab("overview");

      if (!audio) return;

      setCoverVersion(Date.now());

      const [detail, tagRows] = await Promise.all([
        api.getAudioDetail(audio.id),
        api.listTags().catch(() => [])
      ]);

      if (canceled) return;

      setTags(detail.tags);
      setAllTags(tagRows);

      setEditing({
        title_user: detail.audio.title_user || "",
        author_user: detail.audio.author_user || "",
        album_user: detail.audio.album_user || "",
        description_user: detail.audio.description_user || "",
        language: detail.audio.language || "",
        is_favorite: detail.audio.is_favorite
      });

      api
        .getTranscript(audio.id)
        .then((value) => {
          if (!canceled) setTranscript(value);
        })
        .catch(() => {
          if (!canceled) setTranscript(null);
        });

      api
        .getAiSuggestions(audio.id)
        .then((value) => {
          if (!canceled) setAiSuggestions(value);
        })
        .catch(() => {
          if (!canceled) setAiSuggestions(null);
        });
    }

    load().catch((err) => {
      if (canceled) return;
      console.error(err);
      notify?.(err instanceof Error ? err.message : String(err), "error");
    });

    return () => {
      canceled = true;
    };
  }, [audio?.id]);

  if (!audio) {
    return (
      <aside className="inspector-panel empty-inspector">
        <div className="empty-detail-card">
          <div className="empty-detail-icon">♪</div>

          <span className="eyebrow">Inspector</span>

          <h2>选择一个音频开始整理</h2>

          <p>
            在中间列表中选择音频后，可以查看封面、metadata、播放记录、标签、AI 建议和 transcript。
          </p>

          <div className="detail-empty-steps">
            <div>
              <strong>1</strong>
              <span>添加媒体库目录</span>
            </div>

            <div>
              <strong>2</strong>
              <span>扫描并导入音频</span>
            </div>

            <div>
              <strong>3</strong>
              <span>转写、AI 分析、整理标签</span>
            </div>
          </div>
        </div>
      </aside>
    );
  }

  async function reloadTagsAndSuggestions() {
    const [detail, tagRows] = await Promise.all([
      api.getAudioDetail(audio!.id),
      api.listTags().catch(() => [])
    ]);

    setTags(detail.tags);
    setAllTags(tagRows);

    const suggestions = await api.getAiSuggestions(audio!.id).catch(() => null);
    setAiSuggestions(suggestions);
  }

  async function save() {
    try {
      await api.updateAudio(audio!.id, editing);
      notify?.("Metadata 已保存", "success");
      refresh();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function addTags() {
    const names = tagInput
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

    if (names.length === 0) return;

    try {
      await api.addTags(audio!.id, names, "user");
      setTagInput("");

      await reloadTagsAndSuggestions();
      notify?.("标签已添加", "success");
      refresh();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function addExistingTag() {
    if (!selectedExistingTag) return;

    const tag = allTags.find((x) => x.id === Number(selectedExistingTag));
    if (!tag) return;

    try {
      await api.addTags(audio!.id, [tag.name], "user");
      setSelectedExistingTag("");

      await reloadTagsAndSuggestions();
      notify?.("已有标签已添加", "success");
      refresh();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function removeTag(tagId: number) {
    try {
      await api.removeTag(audio!.id, tagId);

      await reloadTagsAndSuggestions();
      notify?.("标签已移除", "success");
      refresh();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function transcribe() {
    try {
      await api.transcribe(audio!.id);
      refresh();
      notify?.("已创建转写任务，可在设置中心的任务页查看状态。", "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function analyze() {
    try {
      const settings = await api.listSettings();
      const endpoint = settings.find((s) => s.key === "llm.endpoint")?.value;
      const modelName = settings.find((s) => s.key === "llm.model_name")?.value;

      if (!endpoint || !modelName) {
        notify?.("请先在设置中心配置本地 LLM endpoint 和 model_name。", "error");
        return;
      }

      const warning = endpointPrivacyWarning(endpoint);
      if (warning) {
        const ok = window.confirm(`${warning}\n\n确认继续发起 AI 分析？`);
        if (!ok) return;
      }

      const task = await api.analyze(audio!.id);

      if (task.privacy_warning) {
        notify?.(task.privacy_warning, "error");
      }

      refresh();
      notify?.("已创建 AI 分析任务。完成后会显示 AI 建议描述和标签。", "success");
      setActiveTab("ai");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function addToPlaylist() {
    if (!selectedPlaylist) return;

    try {
      await api.addToPlaylist(Number(selectedPlaylist), audio!.id);
      notify?.("已添加到 playlist", "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function acceptAiDescription() {
    const description = aiSuggestions?.description || audio?.description_ai;
    if (!description) return;

    try {
      await api.updateAudio(audio!.id, {
        description_user: description
      });

      setEditing({ ...editing, description_user: description });
      notify?.("AI 描述已接受为用户描述", "success");
      refresh();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function acceptAiTag(tagName: string) {
    try {
      await api.addTags(audio!.id, [tagName], "ai");

      await reloadTagsAndSuggestions();
      notify?.(`已接受标签：${tagName}`, "success");
      refresh();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function acceptAllAiTags() {
    const names =
      aiSuggestions?.tags
        .map((x) => x.trim())
        .filter((x) => x && !acceptedTagNames.has(x)) || [];

    if (names.length === 0) return;

    try {
      await api.addTags(audio!.id, names, "ai");

      await reloadTagsAndSuggestions();
      notify?.(`已接受 ${names.length} 个 AI 标签`, "success");
      refresh();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
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

  async function uploadCover(file?: File) {
    if (!file) return;

    try {
      await api.uploadCover(audio!.id, file);
      setCoverVersion(Date.now());
      notify?.("封面已上传", "success");
      refresh();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function deleteCover() {
    const ok = window.confirm("确认删除当前封面？");
    if (!ok) return;

    try {
      await api.deleteCover(audio!.id);
      setCoverVersion(Date.now());
      notify?.("封面已删除", "success");
      refresh();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function chooseRelocateFile() {
    const selected = await pickAudioFile();
    if (selected) {
      setRelocatePath(selected);
    }
  }

  async function relocate() {
    const path = relocatePath.trim();
    if (!path) return;

    try {
      await api.relocateAudio(audio!.id, path);
      setRelocatePath("");
      notify?.("文件已重新定位", "success");
      refresh();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function deleteFromDatabase() {
    const ok = window.confirm("确认从应用数据库中移除该条目？不会删除本地音频文件。");
    if (!ok) return;

    try {
      await api.deleteAudio(audio!.id, false);
      notify?.("音频条目已从数据库移除", "success");
      onDeleted(audio!.id);
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  function exportTranscript(format: "txt" | "json" | "srt") {
    window.open(api.transcriptExportUrl(audio!.id, format), "_blank");
  }

  function exportPlaylist(format: "json" | "m3u") {
    if (!selectedPlaylistId) return;
    window.open(api.playlistExportUrl(selectedPlaylistId, format), "_blank");
  }

  const hasAiDescription = Boolean(aiSuggestions?.description || audio.description_ai);
  const aiTags = aiSuggestions?.tags || [];

  return (
    <aside className="inspector-panel">
      <div className="inspector-hero">
        <div className="inspector-cover">
          {audio.cover_path ? (
            <img
              src={api.coverUrl(audio.id, coverVersion)}
              alt=""
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          ) : (
            <span>♪</span>
          )}
        </div>

        <div className="inspector-title">
          <h2>{displayTitle(audio)}</h2>
          <p>
            {displayAuthor(audio) || "Unknown"} · {formatDuration(audio.duration_seconds)}
          </p>

          <div className="detail-meta-strip">
            <span>{audio.file_ext || "audio"}</span>
            <span>{audio.is_missing ? "文件缺失" : "文件可用"}</span>
            <span className={`status-pill ${audio.transcript_status}`}>
              转写 {audio.transcript_status}
            </span>
            <span className={`status-pill ${audio.ai_status}`}>AI {audio.ai_status}</span>
          </div>
        </div>

        <div className="inspector-actions">
          <button className="primary-button" onClick={() => onPlay(audio)}>
            播放
          </button>
          <button onClick={transcribe}>转写</button>
          <button onClick={analyze}>AI 分析</button>
          <label className="upload-button">
            封面
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => uploadCover(e.currentTarget.files?.[0])}
            />
          </label>
        </div>
      </div>

      <div className="inspector-tabs">
        <button
          className={activeTab === "overview" ? "active" : ""}
          onClick={() => setActiveTab("overview")}
        >
          概览
        </button>

        <button
          className={activeTab === "ai" ? "active" : ""}
          onClick={() => setActiveTab("ai")}
        >
          AI
        </button>

        <button
          className={activeTab === "transcript" ? "active" : ""}
          onClick={() => setActiveTab("transcript")}
        >
          Transcript
        </button>

        <button
          className={activeTab === "file" ? "active" : ""}
          onClick={() => setActiveTab("file")}
        >
          文件
        </button>
      </div>

      <div className="inspector-body">
        {activeTab === "overview" && (
          <div className="inspector-section-stack">
            <section className="panel-card">
              <h3>Metadata</h3>

              <div className="field-grid">
                <label>
                  用户标题
                  <input
                    value={(editing.title_user as string) || ""}
                    onChange={(e) => setEditing({ ...editing, title_user: e.target.value })}
                  />
                </label>

                <label>
                  作者
                  <input
                    value={(editing.author_user as string) || ""}
                    onChange={(e) => setEditing({ ...editing, author_user: e.target.value })}
                  />
                </label>

                <label>
                  专辑
                  <input
                    value={(editing.album_user as string) || ""}
                    onChange={(e) => setEditing({ ...editing, album_user: e.target.value })}
                  />
                </label>

                <label>
                  语言
                  <input
                    value={(editing.language as string) || ""}
                    onChange={(e) => setEditing({ ...editing, language: e.target.value })}
                  />
                </label>

                <label className="checkbox-row wide">
                  <input
                    type="checkbox"
                    checked={Boolean(editing.is_favorite)}
                    onChange={(e) =>
                      setEditing({ ...editing, is_favorite: e.target.checked })
                    }
                  />
                  收藏
                </label>

                <label className="wide">
                  用户描述
                  <textarea
                    value={(editing.description_user as string) || ""}
                    onChange={(e) =>
                      setEditing({ ...editing, description_user: e.target.value })
                    }
                  />
                </label>
              </div>

              <div className="section-actions">
                <button className="primary-button" onClick={save}>
                  保存 metadata
                </button>
              </div>
            </section>

            <section className="panel-card">
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
                  placeholder="新标签，可用逗号分隔"
                  onChange={(e) => setTagInput(e.target.value)}
                />
                <button onClick={addTags}>添加</button>
              </div>

              <div className="inline-form">
                <select
                  value={selectedExistingTag}
                  onChange={(e) =>
                    setSelectedExistingTag(e.target.value ? Number(e.target.value) : "")
                  }
                >
                  <option value="">选择已有标签</option>
                  {availableExistingTags.map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      #{tag.name}
                    </option>
                  ))}
                </select>
                <button onClick={addExistingTag} disabled={!selectedExistingTag}>
                  添加已有标签
                </button>
              </div>
            </section>

            <section className="panel-card">
              <h3>Playlist</h3>

              <div className="inline-form">
                <select
                  value={selectedPlaylist}
                  onChange={(e) =>
                    setSelectedPlaylist(e.target.value ? Number(e.target.value) : "")
                  }
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

              {selectedPlaylistId && (
                <div className="section-actions">
                  <button onClick={() => exportPlaylist("json")}>导出当前 JSON</button>
                  <button onClick={() => exportPlaylist("m3u")}>导出当前 M3U</button>
                </div>
              )}
            </section>

            <section className="panel-card">
              <h3>当前描述</h3>
              <p>{displayDescription(audio) || "暂无描述"}</p>
            </section>
          </div>
        )}

        {activeTab === "ai" && (
          <div className="inspector-section-stack">
            <section className="panel-card ai-card">
              <div className="card-heading-row">
                <h3>AI 建议描述</h3>
                <button onClick={analyze}>重新分析</button>
              </div>

              {hasAiDescription ? (
                <>
                  <p>{aiSuggestions?.description || audio.description_ai}</p>
                  <button className="primary-button" onClick={acceptAiDescription}>
                    接受为用户描述
                  </button>
                </>
              ) : (
                <div className="soft-empty">
                  暂无 AI 建议。点击「AI 分析」后，会根据 metadata 和 transcript 生成描述。
                </div>
              )}
            </section>

            <section className="panel-card">
              <div className="card-heading-row">
                <h3>AI 标签建议</h3>
                {aiTags.length > 0 && (
                  <button onClick={acceptAllAiTags}>接受全部未添加标签</button>
                )}
              </div>

              {aiTags.length === 0 && <div className="soft-empty">暂无 AI 标签建议</div>}

              {aiTags.length > 0 && (
                <div className="tag-list">
                  {aiTags.map((tagName) => {
                    const accepted = acceptedTagNames.has(tagName);

                    return (
                      <span
                        className={accepted ? "tag accepted" : "tag suggestion"}
                        key={tagName}
                      >
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
              )}
            </section>

            {aiSuggestions?.raw_content && (
              <section className="panel-card">
                <details>
                  <summary>查看原始 AI 输出</summary>
                  <pre className="raw-ai-output">{aiSuggestions.raw_content}</pre>
                </details>
              </section>
            )}
          </div>
        )}

        {activeTab === "transcript" && (
          <div className="inspector-section-stack">
            <section className="panel-card">
              <div className="card-heading-row">
                <h3>Transcript</h3>

                {transcript && (
                  <div className="compact-actions">
                    <button onClick={() => exportTranscript("txt")}>TXT</button>
                    <button onClick={() => exportTranscript("json")}>JSON</button>
                    <button onClick={() => exportTranscript("srt")}>SRT</button>
                  </div>
                )}
              </div>

              {!transcript && (
                <div className="transcript-empty">
                  <p>暂无 transcript。</p>
                  <button className="primary-button" onClick={transcribe}>
                    开始转写
                  </button>
                </div>
              )}

              {transcript && (
                <div className="transcript-timeline">
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
            </section>
          </div>
        )}

        {activeTab === "file" && (
          <div className="inspector-section-stack">
            <section className="panel-card file-info-card">
              <h3>文件信息</h3>

              <dl>
                <dt>文件名</dt>
                <dd>{audio.file_name}</dd>

                <dt>路径</dt>
                <dd>{audio.file_path}</dd>

                <dt>格式</dt>
                <dd>{audio.file_ext || "-"}</dd>

                <dt>时长</dt>
                <dd>{formatDuration(audio.duration_seconds)}</dd>

                <dt>大小</dt>
                <dd>{audio.file_size ? `${Math.round(audio.file_size / 1024 / 1024)} MB` : "-"}</dd>

                <dt>修改时间</dt>
                <dd>{audio.file_mtime || "-"}</dd>

                <dt>Bitrate</dt>
                <dd>{audio.bitrate || "-"}</dd>

                <dt>Sample Rate</dt>
                <dd>{audio.sample_rate || "-"}</dd>

                <dt>Channels</dt>
                <dd>{audio.channels || "-"}</dd>

                <dt>播放位置</dt>
                <dd>{formatDuration(audio.last_position_seconds)}</dd>

                <dt>播放次数</dt>
                <dd>{audio.play_count}</dd>

                <dt>上次播放</dt>
                <dd>{audio.last_played_at || "-"}</dd>
              </dl>
            </section>

            <section className="panel-card">
              <h3>重新定位</h3>

              <div className="inline-form">
                <input
                  value={relocatePath}
                  onChange={(e) => setRelocatePath(e.target.value)}
                  placeholder="新的音频文件路径"
                />
                <button onClick={chooseRelocateFile}>选择</button>
              </div>

              <button className="section-button" onClick={relocate}>
                重新定位文件
              </button>
            </section>

            <section className="panel-card danger-zone">
              <h3>危险操作</h3>
              <p>这些操作会影响数据库记录或封面文件，请谨慎使用。</p>

              <div className="section-actions">
                <button onClick={deleteCover} disabled={!audio.cover_path}>
                  删除封面
                </button>

                <button className="danger-button" onClick={deleteFromDatabase}>
                  从数据库移除
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    </aside>
  );
}
