import type { ResolvedTheme, ThemeMode } from "../../theme";
import { SelectField } from "../ui";
import { THEME_OPTIONS } from "./types";

type SettingsHeaderProps = {
  themeMode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  onThemeModeChange: (mode: ThemeMode) => void;
  backendStatus: string;
};

export default function SettingsHeader({
  themeMode,
  resolvedTheme,
  onThemeModeChange,
  backendStatus
}: SettingsHeaderProps) {
  return (
    <header className="settings-header">
      <div>
        <span className="eyebrow">Control Center</span>
        <h2>设置中心</h2>
        <p>管理媒体库、ASR、LLM、任务、维护和日志。</p>
      </div>

      <div className="settings-header-actions">
        <SelectField
          density="compact"
          controlSize="compact"
          controlHeight={42}
          controlWidth={154}
          controlMinWidth={154}
          controlMaxWidth={154}
          controlRadius={16}
          label="主题"
          value={themeMode}
          options={THEME_OPTIONS}
          title={`当前实际主题：${resolvedTheme === "light" ? "浅色" : "深色"}`}
          onValueChange={(value) => onThemeModeChange(value as ThemeMode)}
        />

        <div className={`backend-status ${backendStatus}`}>
          <span />
          {backendStatus === "checking" && "检查中"}
          {backendStatus === "ok" && "后端正常"}
          {backendStatus === "failed" && "后端未连接"}
        </div>
      </div>
    </header>
  );
}
