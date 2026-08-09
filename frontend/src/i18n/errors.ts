import type { TFunction } from "i18next";

function parseParams(value?: string): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function localizedStoredError(
  t: TFunction,
  code?: string,
  params?: string,
  fallback?: string
): string {
  if (!code) return fallback || t("common.empty.unknownError");
  return t(`errors.${code}`, {
    ...parseParams(params),
    defaultValue: fallback || t("common.empty.unknownError")
  });
}

export function localizedPrivacyWarning(
  t: TFunction,
  code?: string,
  fallback?: string
): string {
  if (!code) return fallback || "";
  return t(`warnings.${code}`, { defaultValue: fallback || code });
}
