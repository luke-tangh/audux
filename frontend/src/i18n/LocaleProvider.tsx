import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import i18n, { applyDocumentLanguage, resolveLanguage, storedLanguagePreference, UI_LANGUAGE_STORAGE_KEY } from "./index";
import type { UiLanguage, UiLanguagePreference } from "./index";

type LocaleContextValue = {
  languagePreference: UiLanguagePreference;
  resolvedLanguage: UiLanguage;
  setLanguagePreference: (language: UiLanguagePreference) => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [languagePreference, setPreference] = useState<UiLanguagePreference>(storedLanguagePreference);
  const [resolvedLanguage, setResolvedLanguage] = useState<UiLanguage>(() => resolveLanguage(languagePreference));

  const applyLanguage = useCallback((preference: UiLanguagePreference) => {
    const next = resolveLanguage(preference);
    setResolvedLanguage(next);
    applyDocumentLanguage(next);
    void i18n.changeLanguage(next);
  }, []);

  const setLanguagePreference = useCallback((preference: UiLanguagePreference) => {
    setPreference(preference);
    try {
      window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, preference);
    } catch {
      // The selected language still applies when storage is unavailable.
    }
    applyLanguage(preference);
  }, [applyLanguage]);

  useEffect(() => {
    applyLanguage(languagePreference);
    if (languagePreference !== "system") return;
    const handleLanguageChange = () => applyLanguage("system");
    window.addEventListener("languagechange", handleLanguageChange);
    return () => window.removeEventListener("languagechange", handleLanguageChange);
  }, [applyLanguage, languagePreference]);

  const value = useMemo(
    () => ({ languagePreference, resolvedLanguage, setLanguagePreference }),
    [languagePreference, resolvedLanguage, setLanguagePreference]
  );
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("useLocale must be used within LocaleProvider");
  return value;
}
