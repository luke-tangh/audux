import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { messages } from "./catalog";

export type UiLanguage = "zh-CN" | "en";
export type UiLanguagePreference = "system" | UiLanguage;

export const UI_LANGUAGE_STORAGE_KEY = "audux-language";

function resource(languageIndex: 0 | 1): Record<string, string> {
  return Object.fromEntries(
    Object.entries(messages).map(([key, value]) => [key, value[languageIndex]])
  );
}

export function normalizeLanguagePreference(value: string | null): UiLanguagePreference {
  if (value === "system" || value === "zh-CN" || value === "en") return value;
  return "system";
}

export function systemLanguage(languages = navigator.languages): UiLanguage {
  for (const language of languages) {
    const normalized = language.toLowerCase();
    if (normalized === "zh" || normalized.startsWith("zh-")) return "zh-CN";
    if (normalized === "en" || normalized.startsWith("en-")) return "en";
  }
  return "zh-CN";
}

export function resolveLanguage(preference: UiLanguagePreference): UiLanguage {
  return preference === "system" ? systemLanguage() : preference;
}

export function storedLanguagePreference(): UiLanguagePreference {
  try {
    return normalizeLanguagePreference(window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function applyDocumentLanguage(language: UiLanguage) {
  document.documentElement.lang = language;
  document.documentElement.dir = "ltr";
}

const initialLanguage = resolveLanguage(storedLanguagePreference());
applyDocumentLanguage(initialLanguage);

void i18n.use(initReactI18next).init({
  resources: {
    "zh-CN": { translation: resource(0) },
    en: { translation: resource(1) }
  },
  lng: initialLanguage,
  fallbackLng: "zh-CN",
  supportedLngs: ["zh-CN", "en"],
  keySeparator: false,
  interpolation: { escapeValue: false },
  initAsync: false
});

export default i18n;
