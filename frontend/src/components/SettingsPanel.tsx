import { useEffect, useState } from "react";
import { api } from "../api";
import type { LibraryRoot } from "../types";
import { pickAudioFolder } from "../tauri";

type Props = {
  refresh: () => void;
};

export default function SettingsPanel({ refresh }: Props) {
  const [roots, setRoots] = useState<LibraryRoot[]>([]);
  const [path, setPath] = useState("");
  const [scanResult, setScanResult] = useState("");
  const [playlistName, setPlaylistName] = useState("");

  const [llmEndpoint, setLlmEndpoint] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [llmApiKey, setLlmApiKey] = useState("");

  const [backendStatus, setBackendStatus] = useState("checking");

  async function load() {
    try {
      await api.health();
      setBackendStatus("ok");

      const [rootRows, settings] = await Promise.all([
        api.listLibraryRoots(),
        api.listSettings()
      ]);

      setRoots(rootRows);
      setLlmEndpoint(settings.find((s) => s.key === "llm.endpoint")?.value || "");
      setLlmModel(settings.find((s) => s.key === "llm.model_name")?.value || "");
      setLlmApiKey(settings.find((s) => s.key === "llm.api_key")?.value || "");
    } catch (err) {
      console.error(err);
      setBackendStatus("failed");
    }
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  async function chooseFolder() {
    const selected = await pickAudioFolder();

    if (selected) {
      setPath(selected);
    } else {
      alert("未选择文件夹，或当前不是 Tauri 运行环境。");
    }
  }

  async function addRoot() {
    if (!path.trim()) return;

    await api.createLibraryRoot(path.trim());
    setPath("");

    await load();
    refresh();
  }

  async function toggleRoot(root: LibraryRoot, isEnabled: boolean) {
    await api.updateLibraryRoot(root.id, {
      is_enabled: isEnabled
    });

    await load();
    refresh();
  }

  async function scan(id: number) {
    setScanResult("扫描中...");

    const result = await api.scanLibraryRoot(id);

    setScanResult(`导入 ${result.imported}，更新 ${result.updated}，缺失 ${result.missing}`);
    refresh();
  }

  async function createPlaylist() {
    if (!playlistName.trim()) return;

    await api.createPlaylist(playlistName.trim());
    setPlaylistName("");

    refresh();
    await load();
  }

  async function saveLlm() {
    await api.setSetting("llm.endpoint", llmEndpoint);
    await api.setSetting("llm.model_name", llmModel);
    await api.setSetting("llm.api_key", llmApiKey);

    alert("LLM 设置已保存");
  }

  return (
    <section className="settings-panel">
      <h2>Settings</h2>

      <div className="section card">
        <h3>后端状态</h3>
        <p>
          FastAPI Backend：
          {backendStatus === "checking" && "检查中"}
          {backendStatus === "ok" && "正常"}
          {backendStatus === "failed" && "未连接"}
        </p>
        <button onClick={load}>重新检查</button>
      </div>

      <div className="section card">
        <h3>媒体库目录</h3>

        <div className="inline-form">
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="输入或选择本地目录路径"
          />
          <button onClick={chooseFolder}>选择文件夹</button>
          <button onClick={addRoot}>添加目录</button>
        </div>

        {roots.map((root) => (
          <div key={root.id} className={`root-row ${root.is_enabled ? "" : "disabled"}`}>
            <span>{root.path}</span>

            <label className="root-toggle">
              <input
                type="checkbox"
                checked={root.is_enabled}
                onChange={(e) => toggleRoot(root, e.target.checked)}
              />
              {root.is_enabled ? "启用" : "禁用"}
            </label>

            <button onClick={() => scan(root.id)}>扫描</button>
          </div>
        ))}

        {scanResult && <p>{scanResult}</p>}
      </div>

      <div className="section card">
        <h3>创建 Playlist</h3>

        <div className="inline-form">
          <input
            value={playlistName}
            onChange={(e) => setPlaylistName(e.target.value)}
            placeholder="Playlist 名称"
          />
          <button onClick={createPlaylist}>创建</button>
        </div>
      </div>

      <div className="section card">
        <h3>本地 LLM 设置</h3>

        <label>
          Endpoint
          <input
            value={llmEndpoint}
            onChange={(e) => setLlmEndpoint(e.target.value)}
            placeholder="http://127.0.0.1:1234/v1"
          />
        </label>

        <label>
          Model Name
          <input
            value={llmModel}
            onChange={(e) => setLlmModel(e.target.value)}
            placeholder="local-model"
          />
        </label>

        <label>
          API Key，可为空
          <input
            value={llmApiKey}
            onChange={(e) => setLlmApiKey(e.target.value)}
            placeholder="可为空"
          />
        </label>

        <button onClick={saveLlm}>保存 LLM 设置</button>
      </div>
    </section>
  );
}
