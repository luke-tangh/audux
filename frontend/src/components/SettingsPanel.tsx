import { useEffect, useRef, useState } from "react";
import { api, endpointPrivacyWarning } from "../api";
import type { LibraryRoot, ScanTask, Tag } from "../types";
import { pickAudioFolder } from "../tauri";
import TaskPanel from "./TaskPanel";
import { PanelCard, Tabs } from "./ui";
import { useDialog } from "./dialog/UnifiedDialog";
import { useTheme } from "../theme";
import AsrSettingsTab from "./settings/AsrSettingsTab";
import LibrarySettingsTab from "./settings/LibrarySettingsTab";
import LlmSettingsTab from "./settings/LlmSettingsTab";
import LogsSettingsTab from "./settings/LogsSettingsTab";
import MaintenanceSettingsTab from "./settings/MaintenanceSettingsTab";
import SettingsHeader from "./settings/SettingsHeader";
import { SETTINGS_TABS, type SettingsTab, type ToastType } from "./settings/types";
import { terminalStatus } from "./settings/settingsUtils";

type Props = {
  refresh: () => void;
  notify?: (message: string, type?: ToastType) => void;
};

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

      setAsrModelName(settings.find((setting) => setting.key === "asr.model_name")?.value || "small");
      setAsrDevice(settings.find((setting) => setting.key === "asr.device")?.value || "cpu");
      setAsrComputeType(settings.find((setting) => setting.key === "asr.compute_type")?.value || "int8");
      setAsrBeamSize(settings.find((setting) => setting.key === "asr.beam_size")?.value || "5");

      setLlmEndpoint(settings.find((setting) => setting.key === "llm.endpoint")?.value || "");
      setLlmModel(settings.find((setting) => setting.key === "llm.model_name")?.value || "");
      setLlmApiKey(settings.find((setting) => setting.key === "llm.api_key")?.value || "");
      setLlmTimeout(settings.find((setting) => setting.key === "llm.timeout")?.value || "60");
      setLlmMaxTokens(settings.find((setting) => setting.key === "llm.max_tokens")?.value || "800");
      setLlmTemperature(settings.find((setting) => setting.key === "llm.temperature")?.value || "0.2");
      setLlmAllowRemoteEndpoint(
        ["1", "true", "yes", "on"].includes(
          (
            settings.find((setting) => setting.key === "llm.allow_remote_endpoint")?.value || ""
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
      <SettingsHeader
        themeMode={themeMode}
        resolvedTheme={resolvedTheme}
        onThemeModeChange={setThemeMode}
        backendStatus={backendStatus}
      />

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
          <LibrarySettingsTab
            roots={roots}
            scanTasks={scanTasks}
            path={path}
            scanResult={scanResult}
            playlistName={playlistName}
            onPathChange={setPath}
            onChooseFolder={chooseFolder}
            onAddRoot={addRoot}
            onToggleRoot={toggleRoot}
            onScan={scan}
            onCancelScan={cancelScan}
            onPlaylistNameChange={setPlaylistName}
            onCreatePlaylist={createPlaylist}
          />
        )}

        {activeTab === "asr" && (
          <AsrSettingsTab
            asrModelName={asrModelName}
            asrDevice={asrDevice}
            asrComputeType={asrComputeType}
            asrBeamSize={asrBeamSize}
            onAsrModelNameChange={setAsrModelName}
            onAsrDeviceChange={setAsrDevice}
            onAsrComputeTypeChange={setAsrComputeType}
            onAsrBeamSizeChange={setAsrBeamSize}
            onSaveAsr={saveAsr}
          />
        )}

        {activeTab === "llm" && (
          <LlmSettingsTab
            llmEndpoint={llmEndpoint}
            llmModel={llmModel}
            llmApiKey={llmApiKey}
            llmTimeout={llmTimeout}
            llmMaxTokens={llmMaxTokens}
            llmTemperature={llmTemperature}
            llmAllowRemoteEndpoint={llmAllowRemoteEndpoint}
            llmWarning={llmWarning}
            llmTestResult={llmTestResult}
            onLlmEndpointChange={setLlmEndpoint}
            onLlmModelChange={setLlmModel}
            onLlmApiKeyChange={setLlmApiKey}
            onLlmTimeoutChange={setLlmTimeout}
            onLlmMaxTokensChange={setLlmMaxTokens}
            onLlmTemperatureChange={setLlmTemperature}
            onLlmAllowRemoteEndpointChange={setLlmAllowRemoteEndpoint}
            onSaveLlm={saveLlm}
            onTestLlm={testLlm}
          />
        )}

        {activeTab === "tasks" && (
          <PanelCard>
            <TaskPanel onTaskChanged={refresh} notify={notify} />
          </PanelCard>
        )}

        {activeTab === "maintenance" && (
          <MaintenanceSettingsTab
            maintenanceTags={maintenanceTags}
            onRebuildSearch={rebuildSearch}
            onCleanupTags={cleanupTags}
            onLoadTags={loadTags}
            onRenameTag={renameTag}
            onDeleteTag={deleteTag}
          />
        )}

        {activeTab === "logs" && (
          <LogsSettingsTab
            logs={logs}
            onLoadLogs={loadLogs}
            onReloadBackend={load}
          />
        )}
      </div>
    </section>
  );
}
