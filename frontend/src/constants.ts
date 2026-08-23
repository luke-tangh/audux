export const MAX_BATCH_SELECTION = 500;

export const ACTIVE_TASK_STATUSES = new Set([
  "pending",
  "running",
  "cancel_requested"
]);

export const TERMINAL_TASK_STATUSES = new Set([
  "done",
  "failed",
  "canceled"
]);

export const TERMINAL_ORGANIZATION_STATUSES = new Set([
  "done",
  "partial",
  "failed",
  "canceled",
  "interrupted"
]);

export const TERMINAL_ACTIVITY_STATUSES = new Set([
  ...TERMINAL_ORGANIZATION_STATUSES,
  "installed"
]);

export function isActiveTaskStatus(status: string): boolean {
  return ACTIVE_TASK_STATUSES.has(status);
}

export function isTerminalTaskStatus(status: string): boolean {
  return TERMINAL_TASK_STATUSES.has(status);
}
