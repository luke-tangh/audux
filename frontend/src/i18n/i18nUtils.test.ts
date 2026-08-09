import type { TFunction } from "i18next";
import { describe, expect, it, vi } from "vitest";

import {
  applyDocumentLanguage,
  normalizeLanguagePreference,
  resolveLanguage,
  storedLanguagePreference,
  systemLanguage,
  UI_LANGUAGE_STORAGE_KEY
} from "./index";
import { localizedPrivacyWarning, localizedStoredError } from "./errors";
import { formatDateTime } from "./format";

function translationMock(): { t: TFunction; call: ReturnType<typeof vi.fn> } {
  const call = vi.fn((key: string, options?: Record<string, unknown>) =>
    String(options?.defaultValue ?? key)
  );
  return { t: call as unknown as TFunction, call };
}

describe("i18n helpers", () => {
  it("normalizes and resolves language preferences", () => {
    expect(normalizeLanguagePreference("en")).toBe("en");
    expect(normalizeLanguagePreference("zh-CN")).toBe("zh-CN");
    expect(normalizeLanguagePreference("invalid")).toBe("system");
    expect(systemLanguage(["fr-FR", "en-US"])).toBe("en");
    expect(systemLanguage(["zh-Hant", "en"])).toBe("zh-CN");
    expect(systemLanguage(["fr-FR"])).toBe("zh-CN");
    expect(resolveLanguage("en")).toBe("en");
  });

  it("reads stored language safely and updates the document", () => {
    window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, "en");
    expect(storedLanguagePreference()).toBe("en");

    applyDocumentLanguage("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("localizes stored errors with validated JSON parameters", () => {
    const { t, call } = translationMock();

    expect(localizedStoredError(t, undefined, undefined, "Fallback")).toBe("Fallback");
    expect(localizedStoredError(t, "task.failed", '{"count":2}', "Failed")).toBe(
      "Failed"
    );
    expect(call).toHaveBeenLastCalledWith("errors.task.failed", {
      count: 2,
      defaultValue: "Failed"
    });

    localizedStoredError(t, "task.failed", "[]", "Failed");
    expect(call).toHaveBeenLastCalledWith("errors.task.failed", {
      defaultValue: "Failed"
    });
    expect(localizedPrivacyWarning(t, "llm.remote", "Remote warning")).toBe(
      "Remote warning"
    );
    expect(localizedPrivacyWarning(t, undefined, "")).toBe("");
  });

  it("formats valid dates and preserves missing or invalid values", () => {
    expect(formatDateTime(undefined, "en-US")).toBe("-");
    expect(formatDateTime("not-a-date", "en-US")).toBe("not-a-date");
    const formatted = formatDateTime("2026-08-10T00:00:00Z", "en-US");
    expect(formatted).not.toBe("2026-08-10T00:00:00Z");
    expect(formatted).toContain("2026");
  });
});
