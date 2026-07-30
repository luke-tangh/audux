(function initializeTheme() {
  var storageKey = "local-audio-library-theme";
  var themeMode = "system";

  try {
    var storedThemeMode = window.localStorage.getItem(storageKey);

    if (
      storedThemeMode === "light" ||
      storedThemeMode === "dark" ||
      storedThemeMode === "system"
    ) {
      themeMode = storedThemeMode;
    }
  } catch {
    // Storage can be unavailable in hardened webviews; system mode is safe.
  }

  var resolvedTheme =
    themeMode === "light" || themeMode === "dark"
      ? themeMode
      : window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark";

  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.dataset.themeMode = themeMode;
  document.documentElement.style.colorScheme = resolvedTheme;
})();
