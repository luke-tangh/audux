import { useEffect, useState } from "react";
import { api } from "../api";
import type { LibraryRoot, ScanTask } from "../types";
import { pickAudioFolder } from "../tauri";
import TaskPanel from "./TaskPanel";

type Props = {
  refresh: () => void;
};

function scanProgress(task: ScanTask): number {
  if (!task.total_files) return 0;
  return Math.round((task.processed_files / task.total_files) * 100);
}

export default function SettingsPanel({ refresh }: Props) {
  const [roots, setRoots] = useState<LibraryRoot[]>([]);
  const [scanTasks, setScanTasks] = useState<ScanTask[]>([]);
  const [path, setPath] = useState("");
  const [scanResult, setScanResult] = useState("");
  const [playlistName, setPlaylistName] = useState("");

  const [asrModelName, setAsrModelName] = useState("small");
  const [asrDevice, setAsrDevice] = useState("cpu");
  const [asrComputeType, setAsrComputeType] = useState("int8");
  const [asrBeamSize, setAsrBeamSize] = useState("5");

  const [llmEndpoint, setLlmEndpoint] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmTimeout, setLlmTimeout] = useState("60");
  const [llmMaxTokens, setLlmMaxTokens] = useState("800");
  const [llmTemperature, setLlmTemperature] = useState("0.2");

  const [llmTestResult, setLlmTestResult] = useState("");
  const [backendStatus, setBackendStatus] = useState("checking");
  const [logs, setLogs] = useState("");

  async function loadScanTasks() {
    const rows = await api.listScanTasks({ limit: 20 });
    setScanTasks(rows);
  }

  async function loadLogs() {
    const result = await api.getLogs(400);
    setLogs(result.content || "");
  }

  async function load() {
    try {
      await api.health();
      setBackendStatus("ok");

      const [rootRows, settings, scanRows] = await Promise.all([
        api.listLibraryRoots(),
        api.listSettings(),
        api.listScanTasks({ limit: 20 })
      ]);

      setRoots(rootRows);
      setScanTasks(scanRows);

      setAsrModelName(settings.find((s) => s.key === "asr.model_name")?.value || "small");
      setAsrDevice(settings.find((s) => s.key === "asr.device")?.value || "cpu");
      setAsrComputeType(settings.find((s) => s.key === "asr.compute_type")?.value || "int8");
      setAsrBeamSize(settings.find((s) => s.key === "asr.beam_size")?.value || "5");

      setLlmEndpoint(settings.find((s) => s.key === "llm.endpoint")?.value || "");
      setLlmModel(settings.find((s) => s.key === "llm.model_name")?.value || "");
      setLlmApiKey(settings.find((s) => s.key === "llm.api_key")?.value || "");
      setLlmTimeout(settings.find((s) => s.key === "llm.timeout")?.value || "60");
      setLlmMaxTokens(settings.find((s) => s.key === "llm.max_tokens")?.value || "800");
      setLlmTemperature(settings.find((s) => s.key === "llm.temperature")?.value || "0.2");
    } catch (err) {
      console.error(err);
      setBackendStatus("failed");
    }
  }

  useEffect(() => {
    load().catch(console.error);
    loadLogs().catch(console.error);

    const timer = setInterval(() => {
      loadScanTasks().catch(console.error);
    }, 3000);

    return () => clearInterval(timer);
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
    setScanResult("已创建扫描任务...");
    const task = await api.scanLibraryRoot(id);
    setScanResult(`扫描任务 #${task.id} 已创建`);
    await loadScanTasks();
    refresh();
  }

  async function cancelScan(task: ScanTask) {
    if (!window.confirm(`确认取消扫描任务 #${task.id}？`)) return;

    await api.cancelScanTask(task.id);
    await loadScanTasks();
  }

  async function createPlaylist() {
    if (!playlistName.trim()) return;

    await api.createPlaylist(playlistName.trim());
    setPlaylistName("");

    refresh();
    await load();
  }

  async function saveAsr() {
    await api.setSetting("asr.model_name", asrModelName.trim() || "small");
    await api.setSetting("asr.device", asrDevice.trim() || "cpu");
    await api.setSetting("asr.compute_type", asrComputeType.trim() || "int8");
    await api.setSetting("asr.beam_size", asrBeamSize.trim() || "5");

    alert("ASR 设置已保存");
  }

  async function saveLlm() {
    await api.setSetting("llm.endpoint", llmEndpoint.trim());
    await api.setSetting("llm.model_name", llmModel.trim());
    await api.setSetting("llm.api_key", llmApiKey);
    await api.setSetting("llm.timeout", llmTimeout.trim() || "60");
    await api.setSetting("llm.max_tokens", llmMaxTokens.trim() || "800");
    await api.setSetting("llm.temperature", llmTemperature.trim() || "0.2");

    alert("LLM 设置已保存");
  }

  async function testLlm() {
    setLlmTestResult("测试中...");

    try {
      const result = await api.testLlm({
        endpoint: llmEndpoint.trim(),
        model_name: llmModel.trim(),
        api_key: llmApiKey || undefined,
        timeout: Number(llmTimeout || "60"),
        max_tokens: Number(llmMaxTokens || "64"),
        temperature: Number(llmTemperature || "0")
      });

      setLlmTestResult(`连接成功：${result.content}`);
    } catch (err) {
      setLlmTestResult(`连接失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function rebuildSearch() {
    const ok = window.confirm("确认重建所有音频的搜索索引？");
    if (!ok) return;

    const result = await api.rebuildSearchIndex();
    alert(`已重建 ${result.count} 条索引`);
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
        <h3>扫描任务</h3>

        {scanTasks.length === 0 && <p className="muted">暂无扫描任务</p>}

        {scanTasks.map((task) => (
          <div key={task.id} className="scan-task-row">
            <div>
              <strong>#{task.id}</strong> root: {task.root_id} · status:{" "}
              <span className={`status-pill ${task.status}`}>{task.status}</span>
            </div>

            <div className="progress-line">
              <div style={{ width: `${scanProgress(task)}%` }} />
            </div>

            <div className="scan-task-meta">
              {task.processed_files}/{task.total_files} · imported {task.imported} · updated{" "}
              {task.updated} · missing {task.missing}
            </div>

            {task.error_message && <div className="task-error">{task.error_message}</div>}

            {(task.status === "pending" || task.status === "running") && (
              <button onClick={() => cancelScan(task)}>取消</button>
            )}
          </div>
        ))}
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
        <h3>本地 ASR 设置 faster-whisper</h3>

        <div className="settings-grid">
          <label>
            Model Name / Path
            <input
              value={asrModelName}
              onChange={(e) => setAsrModelName(e.target.value)}
              placeholder="small 或本地模型路径"
            />
          </label>

          <label>
            Device
            <select value={asrDevice} onChange={(e) => setAsrDevice(e.target.value)}>
              <option value="cpu">cpu</option>
              <option value="cuda">cuda</option>
            </select>
          </label>

          <label>
            Compute Type
            <input
              value={asrComputeType}
              onChange={(e) => setAsrComputeType(e.target.value)}
              placeholder="int8 / float16 / float32"
            />
          </label>

          <label>
            Beam Size
            <input
              value={asrBeamSize}
              onChange={(e) => setAsrBeamSize(e.target.value)}
              placeholder="5"
            />
          </label>
        </div>

        <button onClick={saveAsr}>保存 ASR 设置</button>
        <p className="muted">需要后端环境安装 faster-whisper。</p>
      </div>

      <div className="section card">
        <h3>本地 LLM 设置</h3>

        <div className="settings-grid">
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

          <label>
            Timeout 秒
            <input
              value={llmTimeout}
              onChange={(e) => setLlmTimeout(e.target.value)}
              placeholder="60"
            />
          </label>

          <label>
            Max Tokens
            <input
              value={llmMaxTokens}
              onChange={(e) => setLlmMaxTokens(e.target.value)}
              placeholder="800"
            />
          </label>

          <label>
            Temperature
            <input
              value={llmTemperature}
              onChange={(e) => setLlmTemperature(e.target.value)}
              placeholder="0.2"
            />
          </label>
        </div>

        <div className="actions">
          <button onClick={saveLlm}>保存 LLM 设置</button>
          <button onClick={testLlm}>测试连接</button>
        </div>

        {llmTestResult && <p className="test-result">{llmTestResult}</p>}
      </div>

      <div className="section card">
        <h3>导出与维护</h3>

        <div className="actions">
          <button onClick={() => window.open(api.metadataExportUrl("json"), "_blank")}>
            导出 Metadata JSON
          </button>

          <button onClick={() => window.open(api.metadataExportUrl("csv"), "_blank")}>
            导出 Metadata CSV
          </button>

          <button onClick={rebuildSearch}>重建搜索索引</button>
        </div>
      </div>

      <div className="section card">
        <TaskPanel onTaskChanged={refresh} />
      </div>

      <div className="section card">
        <h3>日志</h3>

        <div className="actions">
          <button onClick={loadLogs}>刷新日志</button>
          <button onClick={() => window.open(api.logsFileUrl(), "_blank")}>下载日志文件</button>
        </div>

        <pre className="log-viewer">{logs || "暂无日志"}</pre>
      </div>
    </section>
  );
}
