import { useEffect, useRef, useState } from "react";
import { api, endpointPrivacyWarning } from "../api";
import type { LibraryRoot, ScanTask, Tag } from "../types";
import { pickAudioFolder } from "../tauri";
import TaskPanel from "./TaskPanel";

type ToastType = "info" | "success" | "error";
type SettingsTab = "library" | "asr" | "llm" | "tasks" | "maintenance" | "logs";

type Props = {
  refresh: () => void;
  notify?: (message: string, type?: ToastType) => void;
};

function scanProgress(task: ScanTask): number {
  if (!task.total_files) return 0;
  return Math.round((task.processed_files / task.total_files) * 100);
}

function terminalStatus(status: string): boolean {
  return status === "done" || status === "failed" || status === "canceled";
}

export default function SettingsPanel({ refresh, notify }: Props) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("library");

  const [roots, setRoots] = useState<LibraryRoot[]>([]);
  const [scanTasks, setScanTasks] = useState<ScanTask[]>([]);
  const [path, setPath] = useState("");
  const [scanResult, setScanResult] = useState("");
  const [playlistName, setPlaylistName] = useState("");
  const [maintenanceTags, setMaintenanceTags] = useState<Tag[]>([]);

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

  const scanStatusRef = useRef<Record<number, string>>({});
  const scanInitializedRef = useRef(false);

  function applyScanTasks(rows: ScanTask[], allowNotify = true) {
    if (allowNotify && scanInitializedRef.current) {
      for (const task of rows) {
        const previous = scanStatusRef.current[task.id];

        if (previous && previous !== task.status && terminalStatus(task.status)) {
          if (task.status === "done") {
            notify?.(
              `扫描任务 #${task.id} 已完成，导入 ${task.imported}，更新 ${task.updated}，缺失 ${task.missing}`,
              "success"
            );
          }

          if (task.status === "failed") {
            notify?.(`扫描任务 #${task.id} 失败：${task.error_message || "未知错误"}`, "error");
          }

          if (task.status === "canceled") {
            notify?.(`扫描任务 #${task.id} 已取消`, "info");
          }
        }
      }
    }

    const nextStatus: Record<number, string> = {};
    for (const task of rows) {
      nextStatus[task.id] = task.status;
    }

    scanStatusRef.current = nextStatus;
    scanInitializedRef.current = true;
    setScanTasks(rows);
  }

  async function loadScanTasks() {
    const rows = await api.listScanTasks({ limit: 20 });
    applyScanTasks(rows, true);
  }

  async function loadLogs() {
    const result = await api.getLogs(400);
    setLogs(result.content || "");
  }

  async function loadTags() {
    const tagRows = await api.listTags().catch(() => []);
    setMaintenanceTags(tagRows);
  }

  async function load() {
    try {
      await api.health();
      setBackendStatus("ok");

      const [rootRows, settings, scanRows, tagRows] = await Promise.all([
        api.listLibraryRoots(),
        api.listSettings(),
        api.listScanTasks({ limit: 20 }),
        api.listTags().catch(() => [])
      ]);

      setRoots(rootRows);
      applyScanTasks(scanRows, false);
      setMaintenanceTags(tagRows);

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
      notify?.(err instanceof Error ? err.message : String(err), "error");
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
      notify?.("未选择文件夹，或当前不是 Tauri 运行环境。", "error");
    }
  }

  async function addRoot() {
    if (!path.trim()) return;

    try {
      await api.createLibraryRoot(path.trim());
      setPath("");

      await load();
      refresh();
      notify?.("媒体库目录已添加", "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function toggleRoot(root: LibraryRoot, isEnabled: boolean) {
    try {
      await api.updateLibraryRoot(root.id, {
        is_enabled: isEnabled
      });

      await load();
      refresh();
      notify?.(isEnabled ? "媒体库目录已启用" : "媒体库目录已禁用", "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function scan(id: number) {
    try {
      setScanResult("已创建扫描任务...");
      const task = await api.scanLibraryRoot(id);
      setScanResult(`扫描任务 #${task.id} 已创建`);
      notify?.(`扫描任务 #${task.id} 已创建`, "success");
      await loadScanTasks();
      refresh();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function cancelScan(task: ScanTask) {
    if (!window.confirm(`确认取消扫描任务 #${task.id}？`)) return;

    try {
      await api.cancelScanTask(task.id);
      notify?.(`扫描任务 #${task.id} 已请求取消`, "info");
      await loadScanTasks();
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function createPlaylist() {
    if (!playlistName.trim()) return;

    try {
      await api.createPlaylist(playlistName.trim());
      setPlaylistName("");

      refresh();
      await load();

      notify?.("Playlist 已创建", "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function saveAsr() {
    try {
      await api.setSetting("asr.model_name", asrModelName.trim() || "small");
      await api.setSetting("asr.device", asrDevice.trim() || "cpu");
      await api.setSetting("asr.compute_type", asrComputeType.trim() || "int8");
      await api.setSetting("asr.beam_size", asrBeamSize.trim() || "5");

      notify?.("ASR 设置已保存", "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function saveLlm() {
    const warning = endpointPrivacyWarning(llmEndpoint);
    if (warning) {
      const ok = window.confirm(`${warning}\n\n确认保存该 endpoint？`);
      if (!ok) return;
    }

    try {
      await api.setSetting("llm.endpoint", llmEndpoint.trim());
      await api.setSetting("llm.model_name", llmModel.trim());
      await api.setSetting("llm.api_key", llmApiKey);
      await api.setSetting("llm.timeout", llmTimeout.trim() || "60");
      await api.setSetting("llm.max_tokens", llmMaxTokens.trim() || "800");
      await api.setSetting("llm.temperature", llmTemperature.trim() || "0.2");

      notify?.("LLM 设置已保存", "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function testLlm() {
    const warning = endpointPrivacyWarning(llmEndpoint);
    if (warning) {
      const ok = window.confirm(`${warning}\n\n确认继续测试连接？`);
      if (!ok) return;
    }

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

      if (result.privacy_warning) {
        notify?.(result.privacy_warning, "error");
      }

      setLlmTestResult(`连接成功：${result.content}`);
      notify?.("LLM 连接测试成功", "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLlmTestResult(`连接失败：${message}`);
      notify?.(`LLM 连接测试失败：${message}`, "error");
    }
  }

  async function rebuildSearch() {
    const ok = window.confirm("确认重建所有音频的搜索索引？");
    if (!ok) return;

    try {
      const result = await api.rebuildSearchIndex();
      notify?.(`已重建 ${result.count} 条搜索索引`, "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function renameTag(tag: Tag) {
    const name = window.prompt("输入新的标签名称：", tag.name);
    if (!name || !name.trim() || name.trim() === tag.name) return;

    try {
      await api.updateTag(tag.id, { name: name.trim() });
      await loadTags();
      refresh();
      notify?.("标签已重命名", "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function deleteTag(tag: Tag) {
    const ok = window.confirm(
      `确认删除标签 #${tag.name}？\n\n如果该标签仍被音频使用，默认不会删除。`
    );

    if (!ok) return;

    try {
      await api.deleteTag(tag.id, false);
      await loadTags();
      refresh();
      notify?.("标签已删除", "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function cleanupTags() {
    const ok = window.confirm("确认清理所有没有关联音频的 orphan tags？");
    if (!ok) return;

    try {
      const result = await api.cleanupTags();
      await loadTags();
      refresh();
      notify?.(`已清理 ${result.deleted} 个未使用标签`, "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  const llmWarning = endpointPrivacyWarning(llmEndpoint);

  return (
    <section className="settings-panel">
      <header className="settings-header">
        <div>
          <span className="eyebrow">Control Center</span>
          <h2>设置中心</h2>
          <p>管理媒体库、ASR、LLM、任务、维护和日志。</p>
        </div>

        <div className={`backend-status ${backendStatus}`}>
          <span />
          {backendStatus === "checking" && "检查中"}
          {backendStatus === "ok" && "后端正常"}
          {backendStatus === "failed" && "后端未连接"}
        </div>
      </header>

      <div className="settings-tabs">
        <button className={activeTab === "library" ? "active" : ""} onClick={() => setActiveTab("library")}>
          媒体库
        </button>
        <button className={activeTab === "asr" ? "active" : ""} onClick={() => setActiveTab("asr")}>
          ASR
        </button>
        <button className={activeTab === "llm" ? "active" : ""} onClick={() => setActiveTab("llm")}>
          LLM
        </button>
        <button className={activeTab === "tasks" ? "active" : ""} onClick={() => setActiveTab("tasks")}>
          任务
        </button>
        <button
          className={activeTab === "maintenance" ? "active" : ""}
          onClick={() => setActiveTab("maintenance")}
        >
          维护
        </button>
        <button className={activeTab === "logs" ? "active" : ""} onClick={() => setActiveTab("logs")}>
          日志
        </button>
      </div>

      <div className="settings-content">
        {activeTab === "library" && (
          <div className="settings-grid-layout">
            <section className="panel-card">
              <h3>媒体库目录</h3>

              <div className="inline-form">
                <input
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="输入或选择本地目录路径"
                />
                <button onClick={chooseFolder}>选择文件夹</button>
                <button className="primary-button" onClick={addRoot}>
                  添加目录
                </button>
              </div>

              {roots.length === 0 && <p className="muted">暂无媒体库目录。</p>}

              {roots.map((root) => (
                <div key={root.id} className={`root-card ${root.is_enabled ? "" : "disabled"}`}>
                  <div>
                    <strong>{root.path}</strong>
                    <span>{root.is_enabled ? "启用中" : "已禁用"}</span>
                  </div>

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

              {scanResult && <p className="test-result">{scanResult}</p>}
            </section>

            <section className="panel-card">
              <h3>扫描任务</h3>

              {scanTasks.length === 0 && <p className="muted">暂无扫描任务</p>}

              {scanTasks.map((task) => (
                <div key={task.id} className="scan-task-row">
                  <div className="scan-task-top">
                    <strong>#{task.id}</strong>
                    <span>root: {task.root_id}</span>
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
            </section>

            <section className="panel-card">
              <h3>创建 Playlist</h3>

              <div className="inline-form">
                <input
                  value={playlistName}
                  onChange={(e) => setPlaylistName(e.target.value)}
                  placeholder="Playlist 名称"
                />
                <button className="primary-button" onClick={createPlaylist}>
                  创建
                </button>
              </div>
            </section>
          </div>
        )}

        {activeTab === "asr" && (
          <section className="panel-card max-form-card">
            <h3>本地 ASR 设置 faster-whisper</h3>

            <div className="settings-form-grid">
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

            <button className="primary-button" onClick={saveAsr}>
              保存 ASR 设置
            </button>

            <p className="muted">
              需要后端环境安装 faster-whisper。若希望完全离线，请优先填写本地模型路径；
              如果填写 small / medium / large-v3 等模型名称，首次运行可能尝试下载模型。
            </p>
          </section>
        )}

        {activeTab === "llm" && (
          <section className="panel-card max-form-card">
            <h3>本地 LLM 设置</h3>

            <div className="settings-form-grid">
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

            {llmWarning && <p className="privacy-warning">隐私提醒：{llmWarning}</p>}

            <div className="section-actions">
              <button className="primary-button" onClick={saveLlm}>
                保存 LLM 设置
              </button>
              <button onClick={testLlm}>测试连接</button>
            </div>

            {llmTestResult && <p className="test-result">{llmTestResult}</p>}
          </section>
        )}

        {activeTab === "tasks" && (
          <section className="panel-card">
            <TaskPanel onTaskChanged={refresh} notify={notify} />
          </section>
        )}

        {activeTab === "maintenance" && (
          <div className="settings-grid-layout">
            <section className="panel-card">
              <h3>导出与索引</h3>

              <div className="section-actions">
                <button onClick={() => window.open(api.metadataExportUrl("json"), "_blank")}>
                  导出 Metadata JSON
                </button>

                <button onClick={() => window.open(api.metadataExportUrl("csv"), "_blank")}>
                  导出 Metadata CSV
                </button>

                <button onClick={rebuildSearch}>重建搜索索引</button>
              </div>
            </section>

            <section className="panel-card">
              <h3>标签维护</h3>

              <p className="muted">可重命名标签，或清理没有关联任何音频的 orphan tags。</p>

              <div className="section-actions">
                <button onClick={cleanupTags}>清理未使用标签</button>
                <button onClick={loadTags}>刷新标签</button>
              </div>

              {maintenanceTags.length === 0 && <p className="muted">暂无标签</p>}

              <div className="tag-list">
                {maintenanceTags.map((tag) => (
                  <span key={tag.id} className="tag">
                    #{tag.name}
                    <button onClick={() => renameTag(tag)}>重命名</button>
                    <button onClick={() => deleteTag(tag)}>删除</button>
                  </span>
                ))}
              </div>
            </section>
          </div>
        )}

        {activeTab === "logs" && (
          <section className="panel-card">
            <h3>日志</h3>

            <div className="section-actions">
              <button onClick={loadLogs}>刷新日志</button>
              <button onClick={() => window.open(api.logsFileUrl(), "_blank")}>下载日志文件</button>
              <button onClick={load}>重新检查后端</button>
            </div>

            <pre className="log-viewer">{logs || "暂无日志"}</pre>
          </section>
        )}
      </div>
    </section>
  );
}
