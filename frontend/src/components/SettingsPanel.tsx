import { useEffect, useRef, useState } from "react";
import { api, endpointPrivacyWarning } from "../api";
import type { LibraryRoot, ScanTask, Tag } from "../types";
import { pickAudioFolder } from "../tauri";
import TaskPanel from "./TaskPanel";
import { Button, SelectField, Tabs, CheckboxField, MaterialIcon, TextField } from "./ui";
import { useDialog } from "./dialog/UnifiedDialog";
import { useTheme } from "../theme";

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

const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: "library", label: "媒体库" },
  { id: "asr", label: "ASR" },
  { id: "llm", label: "LLM" },
  { id: "tasks", label: "任务" },
  { id: "maintenance", label: "维护" },
  { id: "logs", label: "日志" }
];

const THEME_OPTIONS = [
  { value: "system", label: "跟随系统" },
  { value: "dark", label: "深色" },
  { value: "light", label: "浅色" }
] as const;

export default function SettingsPanel({ refresh, notify }: Props) {
  const dialog = useDialog();
  const { themeMode, setThemeMode, resolvedTheme } = useTheme();

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
  const [llmAllowRemoteEndpoint, setLlmAllowRemoteEndpoint] = useState(false);

  const [llmTestResult, setLlmTestResult] = useState("");
  const [backendStatus, setBackendStatus] = useState("checking");
  const [logs, setLogs] = useState("");

  const scanStatusRef = useRef<Record<number, string>>({});
  const scanInitializedRef = useRef(false);

  function applyScanTasks(rows: ScanTask[], allowNotify = true) {
    let shouldRefresh = false;

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

          shouldRefresh = true;
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

    if (shouldRefresh) {
      refresh();
    }
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
      setLlmAllowRemoteEndpoint(
        ["1", "true", "yes", "on"].includes(
          (
            settings.find((s) => s.key === "llm.allow_remote_endpoint")?.value || ""
          ).toLowerCase()
        )
      );
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
    const ok = await dialog.confirm({
      title: "取消扫描任务？",
      message: `确认取消扫描任务 #${task.id}？`,
      confirmLabel: "取消扫描",
      cancelLabel: "继续扫描",
      tone: "warning"
    });

    if (!ok) return;

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
    if (warning && !llmAllowRemoteEndpoint) {
      notify?.("如需使用非本机 LLM endpoint，请先勾选明确允许远程 / 内网 endpoint。", "error");
      return;
    }

    try {
      await api.setSetting("llm.endpoint", llmEndpoint.trim());
      await api.setSetting("llm.model_name", llmModel.trim());
      await api.setSetting("llm.api_key", llmApiKey);
      await api.setSetting("llm.timeout", llmTimeout.trim() || "60");
      await api.setSetting("llm.max_tokens", llmMaxTokens.trim() || "800");
      await api.setSetting("llm.temperature", llmTemperature.trim() || "0.2");
      await api.setSetting(
        "llm.allow_remote_endpoint",
        llmAllowRemoteEndpoint ? "true" : "false"
      );

      notify?.("LLM 设置已保存", "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function testLlm() {
    const warning = endpointPrivacyWarning(llmEndpoint);
    if (warning && !llmAllowRemoteEndpoint) {
      const ok = await dialog.confirm({
        title: "仅测试非本机 LLM endpoint？",
        message: `${warning}\n\n当前尚未勾选允许远程 endpoint。仅继续测试连接？`,
        confirmLabel: "继续测试",
        cancelLabel: "取消",
        tone: "privacy"
      });

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
    const ok = await dialog.confirm({
      title: "重建搜索索引？",
      message: "确认重建所有音频的搜索索引？这可能需要一些时间。",
      confirmLabel: "重建索引",
      cancelLabel: "取消",
      tone: "warning"
    });

    if (!ok) return;

    try {
      const result = await api.rebuildSearchIndex();
      notify?.(`已重建 ${result.count} 条搜索索引`, "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function renameTag(tag: Tag) {
    const name = await dialog.prompt({
      title: "重命名标签",
      message: `为 #${tag.name} 输入新的标签名称。`,
      inputLabel: "标签名称",
      defaultValue: tag.name,
      placeholder: "输入新的标签名称",
      required: true,
      confirmLabel: "保存",
      cancelLabel: "取消",
      validate: (value) => {
        const trimmed = value.trim();

        if (!trimmed) return "标签名称不能为空";
        if (trimmed === tag.name) return "请输入不同的标签名称";

        return null;
      }
    });

    if (name === null) return;

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
    const ok = await dialog.confirm({
      title: "删除标签？",
      message: `确认删除标签 #${tag.name}？\n\n如果该标签仍被音频使用，默认不会删除。`,
      confirmLabel: "删除标签",
      cancelLabel: "取消",
      tone: "danger",
      destructive: true
    });

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
    const ok = await dialog.confirm({
      title: "清理未使用标签？",
      message: "确认清理所有没有关联音频的 orphan tags？",
      confirmLabel: "清理标签",
      cancelLabel: "取消",
      tone: "warning"
    });

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

        <div className="settings-header-actions">
          <SelectField
            wrapperClassName="settings-theme-select"
            density="compact"
            label="主题"
            value={themeMode}
            options={THEME_OPTIONS}
            title={`当前实际主题：${resolvedTheme === "light" ? "浅色" : "深色"}`}
            onValueChange={(value) => setThemeMode(value as typeof themeMode)}
          />

          <div className={`backend-status ${backendStatus}`}>
            <span />
            {backendStatus === "checking" && "检查中"}
            {backendStatus === "ok" && "后端正常"}
            {backendStatus === "failed" && "后端未连接"}
          </div>
        </div>
      </header>

      <Tabs
        className="settings-tabs"
        items={SETTINGS_TABS}
        activeId={activeTab}
        onChange={setActiveTab}
        ariaLabel="设置分类"
        idPrefix="settings"
      />

      <div
        className="settings-content"
        role="tabpanel"
        id={`settings-panel-${activeTab}`}
        aria-labelledby={`settings-tab-${activeTab}`}
      >
        {activeTab === "library" && (
          <div className="settings-grid-layout">
            <section className="panel-card">
              <h3>媒体库目录</h3>

              <div className="inline-form">
                <TextField
                  wrapperClassName="inline-field"
                  hideLabel
                  label="媒体库路径"
                  value={path}
                  placeholder="输入或选择本地目录路径"
                  onValueChange={setPath}
                />
                <Button variant="outlined" onClick={chooseFolder}>选择文件夹</Button>
                <Button variant="filled" onClick={addRoot}>
                  添加目录
                </Button>
              </div>

              {roots.length === 0 && <p className="muted">暂无媒体库目录。</p>}

              {roots.map((root) => (
                <div key={root.id} className={`root-card ${root.is_enabled ? "" : "disabled"}`}>
                  <div>
                    <strong>{root.path}</strong>
                    <span>{root.is_enabled ? "启用中" : "已禁用"}</span>
                  </div>

                  <CheckboxField
                    wrapperClassName="root-toggle"
                    label={root.is_enabled ? "启用" : "禁用"}
                    checked={root.is_enabled}
                    onCheckedChange={(checked) => toggleRoot(root, checked)}
                  />

                  <Button variant="text" onClick={() => scan(root.id)}>扫描</Button>
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

                  <div
                    className="progress-line"
                    role="progressbar"
                    aria-label={`扫描任务 #${task.id} 进度`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={scanProgress(task)}
                  >
                    <div style={{ width: `${scanProgress(task)}%` }} />
                  </div>

                  <div className="scan-task-meta">
                    {task.processed_files}/{task.total_files} · imported {task.imported} · updated{" "}
                    {task.updated} · missing {task.missing}
                  </div>

                  {task.error_message && <div className="task-error">{task.error_message}</div>}

                  {(task.status === "pending" || task.status === "running") && (
                    <Button variant="text" onClick={() => cancelScan(task)}>取消</Button>
                  )}
                </div>
              ))}
            </section>

            <section className="panel-card">
              <h3>创建 Playlist</h3>

              <div className="inline-form">
                <TextField
                  wrapperClassName="inline-field"
                  hideLabel
                  label="Playlist 名称"
                  value={playlistName}
                  placeholder="Playlist 名称"
                  onValueChange={setPlaylistName}
                />
                <Button variant="filled" onClick={createPlaylist}>
                  创建
                </Button>
              </div>
            </section>
          </div>
        )}

        {activeTab === "asr" && (
          <section className="panel-card max-form-card">
            <h3>本地 ASR 设置 faster-whisper</h3>

            <div className="settings-form-grid">
              <TextField
                label="Model Name / Path"
                value={asrModelName}
                placeholder="small 或本地模型路径"
                onValueChange={setAsrModelName}
              />

              <SelectField
                label="Device"
                menuClassName="settings-device-menu"
                wrapperClassName="settings-device-select"
                density="compact"
                value={asrDevice}
                options={[
                  { value: "cpu", label: "cpu" },
                  { value: "cuda", label: "cuda" }
                ]}
                onValueChange={setAsrDevice}
              />

              <TextField
                label="Compute Type"
                value={asrComputeType}
                placeholder="int8 / float16 / float32"
                onValueChange={setAsrComputeType}
              />

              <TextField
                label="Beam Size"
                value={asrBeamSize}
                placeholder="5"
                onValueChange={setAsrBeamSize}
              />
            </div>

            <Button variant="filled" onClick={saveAsr}>
              保存 ASR 设置
            </Button>

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
              <TextField
                label="Endpoint"
                value={llmEndpoint}
                placeholder="http://127.0.0.1:1234/v1"
                onValueChange={setLlmEndpoint}
              />

              <TextField
                label="Model Name"
                value={llmModel}
                placeholder="local-model"
                onValueChange={setLlmModel}
              />

              <TextField
                label="API Key，可为空"
                value={llmApiKey}
                placeholder="可为空"
                onValueChange={setLlmApiKey}
              />

              <TextField
                label="Timeout 秒"
                value={llmTimeout}
                placeholder="60"
                onValueChange={setLlmTimeout}
              />

              <TextField
                label="Max Tokens"
                value={llmMaxTokens}
                placeholder="800"
                onValueChange={setLlmMaxTokens}
              />

              <TextField
                label="Temperature"
                value={llmTemperature}
                placeholder="0.2"
                onValueChange={setLlmTemperature}
              />

              <CheckboxField
                wrapperClassName="wide"
                label="允许非本机 / 内网 LLM endpoint"
                description="启用后，AI 分析会把 metadata 和 transcript 发送到该 endpoint，请只用于你信任的模型服务。"
                checked={llmAllowRemoteEndpoint}
                onCheckedChange={setLlmAllowRemoteEndpoint}
              />
            </div>

            {llmWarning && <p className="privacy-warning">隐私提醒：{llmWarning}</p>}

            <div className="section-actions">
              <Button variant="filled" onClick={saveLlm}>
                保存 LLM 设置
              </Button>
              <Button variant="outlined" onClick={testLlm}>测试连接</Button>
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
                <Button variant="outlined" onClick={() => window.open(api.metadataExportUrl("json"), "_blank")}>
                  导出 Metadata JSON
                </Button>

                <Button variant="outlined" onClick={() => window.open(api.metadataExportUrl("csv"), "_blank")}>
                  导出 Metadata CSV
                </Button>

                <Button variant="outlined" onClick={rebuildSearch}>重建搜索索引</Button>
              </div>
            </section>

            <section className="panel-card">
              <h3>标签维护</h3>

              <p className="muted">可重命名标签，或清理没有关联任何音频的 orphan tags。</p>

              <div className="section-actions">
                <Button variant="outlined" onClick={cleanupTags}>清理未使用标签</Button>
                <Button variant="outlined" onClick={loadTags}>刷新标签</Button>
              </div>

              {maintenanceTags.length === 0 && <p className="muted">暂无标签</p>}

              <div className="tag-list">
                {maintenanceTags.map((tag) => (
                  <span key={tag.id} className="tag">
                    #{tag.name}
                    <Button preserveChildren className="tag-text-action" size="sm" variant="text" onClick={() => renameTag(tag)}>重命名</Button>
                    <Button preserveChildren className="tag-text-action" size="sm" variant="danger" onClick={() => deleteTag(tag)}>删除</Button>
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
              <Button variant="outlined" onClick={loadLogs}>刷新日志</Button>
              <Button variant="outlined" onClick={() => window.open(api.logsFileUrl(), "_blank")}>下载日志文件</Button>
              <Button variant="outlined" onClick={load}>重新检查后端</Button>
            </div>

            <pre className="log-viewer">{logs || "暂无日志"}</pre>
          </section>
        )}
      </div>
    </section>
  );
}
