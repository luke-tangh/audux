export function formatDateTime(value: string | undefined, locale: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(date);
}

export function formatLanguageName(value: string | undefined, locale: string): string {
  if (!value) return "";
  const normalized = value.trim().replace("_", "-");
  if (!normalized) return "";

  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(normalized) || value;
  } catch {
    return value;
  }
}
