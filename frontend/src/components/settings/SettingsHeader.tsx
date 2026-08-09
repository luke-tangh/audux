import type { ResolvedTheme, ThemeMode } from "../../theme";
import type { UiLanguagePreference } from "../../i18n";
import { useTranslation } from "react-i18next";
import { SelectField } from "../ui";

type SettingsHeaderProps = {
  themeMode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  onThemeModeChange: (mode: ThemeMode) => void;
  backendStatus: string;
  languagePreference: UiLanguagePreference;
  onLanguagePreferenceChange: (language: UiLanguagePreference) => void;
};

export default function SettingsHeader({
  themeMode,
  resolvedTheme,
  onThemeModeChange,
  backendStatus,
  languagePreference,
  onLanguagePreferenceChange
}: SettingsHeaderProps) {
  const { t } = useTranslation();
  const themeOptions = [
    { value: "system", label: t("settings.theme.system") },
    { value: "dark", label: t("settings.theme.dark") },
    { value: "light", label: t("settings.theme.light") }
  ];
  const languageOptions = [
    { value: "system", label: t("common.language.system") },
    { value: "zh-CN", label: t("common.language.zhCN") },
    { value: "en", label: t("common.language.en") }
  ];

  return (
    <header className="settings-header">
      <div>
        <span className="eyebrow">{t("settings.header.eyebrow")}</span>
        <h2>{t("settings.header.title")}</h2>
        <p>{t("settings.header.description")}</p>
      </div>

      <div className="settings-header-actions">
        <SelectField
          density="compact"
          controlSize="compact"
          controlHeight={42}
          controlMinWidth={148}
          controlMaxWidth={190}
          controlRadius={16}
          label={t("settings.header.theme")}
          value={themeMode}
          options={themeOptions}
          title={t("settings.header.resolvedTheme", {
            theme: t(`settings.theme.${resolvedTheme}`)
          })}
          onValueChange={(value) => onThemeModeChange(value as ThemeMode)}
        />

        <SelectField
          density="compact"
          controlSize="compact"
          controlHeight={42}
          controlMinWidth={148}
          controlMaxWidth={190}
          controlRadius={16}
          label={t("settings.header.language")}
          value={languagePreference}
          options={languageOptions}
          onValueChange={(value) => onLanguagePreferenceChange(value as UiLanguagePreference)}
        />

        <div className={`backend-status ${backendStatus}`}>
          <span />
          {backendStatus === "checking" && t("settings.backend.checking")}
          {backendStatus === "ok" && t("settings.backend.ok")}
          {backendStatus === "failed" && t("settings.backend.failed")}
        </div>
      </div>
    </header>
  );
}
