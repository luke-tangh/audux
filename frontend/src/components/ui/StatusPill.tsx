import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

const STATUS_KEYS: Record<string, string> = {
  none: "common.status.none",
  pending: "common.status.pending",
  running: "common.status.running",
  done: "common.status.done",
  failed: "common.status.failed",
  canceled: "common.status.canceled",
  cancel_requested: "common.status.cancelRequested",
  awaiting_review: "common.status.awaitingReview",
  partial: "common.status.partial",
  interrupted: "common.status.interrupted",
  accepted: "common.status.accepted",
  rejected: "common.status.rejected",
  skipped: "common.status.skipped",
  stale: "common.status.stale",
  applied: "common.status.applied"
};

export function statusClass(value?: string): string {
  return (value || "none").toLowerCase().replace(/[^a-z0-9_-]/g, "") || "none";
}

type StatusPillProps = {
  label?: string;
  value?: string;
  children?: ReactNode;
  className?: string;
  ariaLabel?: string;
};

export default function StatusPill({
  label,
  value,
  children,
  className = "",
  ariaLabel
}: StatusPillProps) {
  const { t } = useTranslation();
  const cls = statusClass(value);
  const text = children ?? (STATUS_KEYS[cls] ? t(STATUS_KEYS[cls]) : value) ?? t("common.status.none");
  const readable = label ? `${label} ${String(text)}` : String(text);

  return (
    <span
      className={["status-pill", cls, className].filter(Boolean).join(" ")}
      aria-label={ariaLabel || readable}
    >
      {label && <span>{label}</span>}
      {text}
    </span>
  );
}
