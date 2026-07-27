import type { ReactNode } from "react";

export const STATUS_TEXT: Record<string, string> = {
  none: "未开始",
  pending: "等待中",
  running: "进行中",
  done: "已完成",
  failed: "失败",
  canceled: "已取消",
  cancel_requested: "取消中"
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
  const cls = statusClass(value);
  const text = children ?? STATUS_TEXT[cls] ?? value ?? "未开始";
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
