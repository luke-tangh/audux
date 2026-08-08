import { useEffect, useRef, useState } from "react";
import { api, asrEndpointPrivacyWarning, endpointPrivacyWarning } from "../api";
import type {
  LibraryRoot,
  Playlist,
  ScanTask,
  Tag,
  WhisperComponentStatus
} from "../types";
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
  const [settingsPlaylists, setSettingsPlaylists] = useState<Playlist[]>([]);
  const [maintenanceTags, setMaintenanceTags] = useState<Tag[]>([]);

  const [asrProvider, setAsrProvider] = useState("faster_whisper");
  const [asrModelName, setAsrModelName] = useState("small");
  const [asrDevice, setAsrDevice] = useState("cpu");
  const [asrComputeType, setAsrComputeType] = useState("int8");
  const [asrBeamSize, setAsrBeamSize] = useState("5");
  const [asrExternalEndpoint, setAsrExternalEndpoint] = useState("");
  const [asrExternalModelName, setAsrExternalModelName] = useState("");
  const [asrExternalApiKey, setAsrExternalApiKey] = useState("");
  const [asrExternalLanguage, setAsrExternalLanguage] = useState("auto");
  const [asrExternalTimestampPolicy, setAsrExternalTimestampPolicy] =
    useState("preferred");
  const [asrExternalTimeout, setAsrExternalTimeout] = useState("3600");
  const [asrExternalAllowRemoteEndpoint, setAsrExternalAllowRemoteEndpoint] =
    useState(false);
  const [whisperComponent, setWhisperComponent] =
    useState<WhisperComponentStatus | null>(null);

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

  async function loadWhisperComponentStatus() {
    const status = await api.getWhisperComponentStatus();
    setWhisperComponent(status);
  }

  async function load() {
    try {
      await api.health();
      setBackendStatus("ok");

      const [rootRows, settings, scanRows, tagRows, playlistRows, componentStatus] = await Promise.all([
        api.listLibraryRoots(),
        api.listSettings(),
        api.listScanTasks({ limit: 20 }),
        api.listTags().catch(() => []),
        api.listPlaylists().catch(() => []),
        api.getWhisperComponentStatus()
      ]);

      setRoots(rootRows);
      applyScanTasks(scanRows, false);
      setMaintenanceTags(tagRows);
      setSettingsPlaylists(playlistRows);
      setWhisperComponent(componentStatus);

      setAsrProvider(
        settings.find((setting) => setting.key === "asr.provider")?.value ||
          "faster_whisper"
      );
      setAsrModelName(settings.find((setting) => setting.key === "asr.model_name")?.value || "small");
      setAsrDevice(settings.find((setting) => setting.key === "asr.device")?.value || "cpu");
      setAsrComputeType(settings.find((setting) => setting.key === "asr.compute_type")?.value || "int8");
      setAsrBeamSize(settings.find((setting) => setting.key === "asr.beam_size")?.value || "5");
      setAsrExternalEndpoint(
        settings.find((setting) => setting.key === "asr.external.endpoint")?.value || ""
      );
      setAsrExternalModelName(
        settings.find((setting) => setting.key === "asr.external.model_name")?.value || ""
      );
      setAsrExternalApiKey(
        settings.find((setting) => setting.key === "asr.external.api_key")?.value || ""
      );
      setAsrExternalLanguage(
        settings.find((setting) => setting.key === "asr.external.language")?.value ||
          "auto"
      );
      setAsrExternalTimestampPolicy(
        settings.find((setting) => setting.key === "asr.external.timestamp_policy")
          ?.value || "preferred"
      );
      setAsrExternalTimeout(
        settings.find((setting) => setting.key === "asr.external.timeout")?.value ||
          "3600"
      );
      setAsrExternalAllowRemoteEndpoint(
        ["1", "true", "yes", "on"].includes(
          (
            settings.find(
              (setting) => setting.key === "asr.external.allow_remote_endpoint"
            )?.value || ""
          ).toLowerCase()
        )
      );

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
      loadWhisperComponentStatus().catch(console.error);
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

  async function removeRoot(root: LibraryRoot) {
    const ok = await dialog.confirm({
      title: "移除媒体库目录？",
      message:
        `确认移除「${root.path}」？\n\n` +
        "音频文件和数据库中的音频、标签、playlist、transcript 都会保留；该目录的扫描历史会删除。",
      confirmLabel: "移除目录",
      cancelLabel: "取消",
      tone: "danger",
      destructive: true
    });

    if (!ok) return;

    try {
      const result = await api.deleteLibraryRoot(root.id);
      await load();
      refresh();
      notify?.(
        `目录已移除，保留 ${result.detached_audio_items} 条音频记录`,
        "success"
      );
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

  async function renamePlaylist(playlist: Playlist) {
    const name = await dialog.prompt({
      title: "重命名 Playlist",
      message: `为「${playlist.name}」输入新的名称。`,
      inputLabel: "Playlist 名称",
      defaultValue: playlist.name,
      required: true,
      confirmLabel: "保存",
      cancelLabel: "取消",
      validate: (value) => {
        const trimmed = value.trim();
        if (!trimmed) return "Playlist 名称不能为空";
        if (trimmed === playlist.name) return "请输入不同的名称";
        return null;
      }
    });

    if (name === null) return;

    try {
      await api.updatePlaylist(playlist.id, name.trim());
      await load();
      refresh();
      notify?.("Playlist 已重命名", "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function deletePlaylist(playlist: Playlist) {
    const ok = await dialog.confirm({
      title: "删除 Playlist？",
      message: `确认删除「${playlist.name}」？\n\n只会删除播放列表及其排序，不会删除任何音频。`,
      confirmLabel: "删除 Playlist",
      cancelLabel: "取消",
      tone: "danger",
      destructive: true
    });

    if (!ok) return;

    try {
      const result = await api.deletePlaylist(playlist.id);
      await load();
      refresh();
      notify?.(`Playlist 已删除，移除 ${result.removed_items} 个列表项`, "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function saveAsr() {
    if (asrProvider === "faster_whisper" && !whisperComponent?.available) {
      notify?.("请先下载并安装 Whisper 本地转写组件。", "error");
      return;
    }

    const warning = asrEndpointPrivacyWarning(asrExternalEndpoint);
    if (
      asrProvider === "external" &&
      warning &&
      !asrExternalAllowRemoteEndpoint
    ) {
      notify?.("如需使用非本机 ASR endpoint，请先勾选明确允许远程 / 内网 endpoint。", "error");
      return;
    }

    try {
      await api.setSetting("asr.provider", asrProvider);
      await api.setSetting("asr.model_name", asrModelName.trim() || "small");
      await api.setSetting("asr.device", asrDevice.trim() || "cpu");
      await api.setSetting("asr.compute_type", asrComputeType.trim() || "int8");
      await api.setSetting("asr.beam_size", asrBeamSize.trim() || "5");
      await api.setSetting("asr.external.endpoint", asrExternalEndpoint.trim());
      await api.setSetting(
        "asr.external.model_name",
        asrExternalModelName.trim()
      );
      await api.setSetting("asr.external.api_key", asrExternalApiKey);
      await api.setSetting(
        "asr.external.language",
        asrExternalLanguage.trim() || "auto"
      );
      await api.setSetting(
        "asr.external.timestamp_policy",
        asrExternalTimestampPolicy
      );
      await api.setSetting(
        "asr.external.timeout",
        asrExternalTimeout.trim() || "3600"
      );
      await api.setSetting(
        "asr.external.allow_remote_endpoint",
        asrExternalAllowRemoteEndpoint ? "true" : "false"
      );

      notify?.("ASR 设置已保存", "success");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function installWhisperComponent() {
    try {
      const status = await api.installWhisperComponent();
      setWhisperComponent(status);
      notify?.("Whisper 组件已开始下载", "info");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function cancelWhisperComponentInstall() {
    try {
      const status = await api.cancelWhisperComponentInstall();
      setWhisperComponent(status);
      notify?.("已请求取消 Whisper 组件下载", "info");
    } catch (err) {
      notify?.(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function removeWhisperComponent() {
    const ok = await dialog.confirm({
      title: "移除 Whisper 组件？",
      message: "组件运行时会被移除，已下载的模型缓存将保留，之后可再次安装组件。",
      confirmLabel: "移除组件",
      cancelLabel: "取消",
      tone: "danger",
      destructive: true
    });

    if (!ok) return;

    try {
      const status = await api.removeWhisperComponent();
      setWhisperComponent(status);
      notify?.("Whisper 组件已移除，模型缓存已保留", "success");
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

  async function mergeTag(tag: Tag) {
    const targetName = await dialog.prompt({
      title: "合并标签",
      message: `把 #${tag.name} 的全部音频关联合并到另一个现有标签。源标签随后会删除。`,
      inputLabel: "目标标签名称",
      placeholder: "输入现有标签的完整名称",
      required: true,
      confirmLabel: "合并",
      cancelLabel: "取消",
      tone: "warning",
      validate: (value) => {
        const normalized = value.trim();
        if (normalized === tag.name) return "源标签和目标标签必须不同";
        if (!maintenanceTags.some((candidate) => candidate.name === normalized)) {
          return "目标标签不存在，请输入现有标签的完整名称";
        }
        return null;
      }
    });

    if (targetName === null) return;
    const target = maintenanceTags.find(
      (candidate) => candidate.name === targetName.trim()
    );
    if (!target) return;

    try {
      const result = await api.mergeTag(tag.id, target.id);
      await loadTags();
      refresh();
      notify?.(
        `已将 #${tag.name} 合并到 #${result.target_tag.name}，影响 ${result.affected_audio_items} 条音频`,
        "success"
      );
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
  const asrExternalWarning = asrEndpointPrivacyWarning(asrExternalEndpoint);

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
            playlists={settingsPlaylists}
            onPathChange={setPath}
            onChooseFolder={chooseFolder}
            onAddRoot={addRoot}
            onToggleRoot={toggleRoot}
            onRemoveRoot={removeRoot}
            onScan={scan}
            onCancelScan={cancelScan}
            onPlaylistNameChange={setPlaylistName}
            onCreatePlaylist={createPlaylist}
            onRenamePlaylist={renamePlaylist}
            onDeletePlaylist={deletePlaylist}
          />
        )}

        {activeTab === "asr" && (
          <AsrSettingsTab
            asrProvider={asrProvider}
            asrModelName={asrModelName}
            asrDevice={asrDevice}
            asrComputeType={asrComputeType}
            asrBeamSize={asrBeamSize}
            externalEndpoint={asrExternalEndpoint}
            externalModelName={asrExternalModelName}
            externalApiKey={asrExternalApiKey}
            externalLanguage={asrExternalLanguage}
            externalTimestampPolicy={asrExternalTimestampPolicy}
            externalTimeout={asrExternalTimeout}
            externalAllowRemoteEndpoint={asrExternalAllowRemoteEndpoint}
            externalWarning={asrExternalWarning}
            whisperComponent={whisperComponent}
            onAsrProviderChange={setAsrProvider}
            onAsrModelNameChange={setAsrModelName}
            onAsrDeviceChange={setAsrDevice}
            onAsrComputeTypeChange={setAsrComputeType}
            onAsrBeamSizeChange={setAsrBeamSize}
            onExternalEndpointChange={setAsrExternalEndpoint}
            onExternalModelNameChange={setAsrExternalModelName}
            onExternalApiKeyChange={setAsrExternalApiKey}
            onExternalLanguageChange={setAsrExternalLanguage}
            onExternalTimestampPolicyChange={setAsrExternalTimestampPolicy}
            onExternalTimeoutChange={setAsrExternalTimeout}
            onExternalAllowRemoteEndpointChange={
              setAsrExternalAllowRemoteEndpoint
            }
            onInstallWhisperComponent={installWhisperComponent}
            onCancelWhisperComponentInstall={cancelWhisperComponentInstall}
            onRemoveWhisperComponent={removeWhisperComponent}
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
            onMergeTag={mergeTag}
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
