import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";
import type { ReactNode } from "react";

export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

type ThemeContextValue = {
  themeMode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setThemeMode: (mode: ThemeMode) => void;
};

const STORAGE_KEY = "audux-theme";
const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "dark";

  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

function normalizeThemeMode(value: string | null): ThemeMode {
  if (value === "light" || value === "dark" || value === "system") {
    return value;
  }

  return "system";
}

function storedThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "system";

  try {
    return normalizeThemeMode(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return "system";
  }
}

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === "system" ? systemTheme() : mode;
}

function initialThemeMode(): ThemeMode {
  if (typeof document === "undefined") return "system";

  return normalizeThemeMode(
    document.documentElement.dataset.themeMode || storedThemeMode()
  );
}

function initialResolvedTheme(mode: ThemeMode): ResolvedTheme {
  if (typeof document === "undefined") return "dark";

  const bootstrappedTheme = document.documentElement.dataset.theme;

  if (bootstrappedTheme === "light" || bootstrappedTheme === "dark") {
    return bootstrappedTheme;
  }

  return resolveTheme(mode);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(initialThemeMode);

  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    initialResolvedTheme(themeMode)
  );

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);

    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // The active theme still applies when storage is unavailable.
    }
  }, []);

  useEffect(() => {
    function applyTheme() {
      const next = resolveTheme(themeMode);
      setResolvedTheme(next);

      document.documentElement.dataset.theme = next;
      document.documentElement.dataset.themeMode = themeMode;
      document.documentElement.style.colorScheme = next;
    }

    applyTheme();

    if (themeMode !== "system") return;

    const query = window.matchMedia("(prefers-color-scheme: light)");
    query.addEventListener("change", applyTheme);

    return () => {
      query.removeEventListener("change", applyTheme);
    };
  }, [themeMode]);

  const value = useMemo(
    () => ({
      themeMode,
      resolvedTheme,
      setThemeMode
    }),
    [resolvedTheme, setThemeMode, themeMode]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);

  if (!value) {
    throw new Error("useTheme must be used within ThemeProvider");
  }

  return value;
}
