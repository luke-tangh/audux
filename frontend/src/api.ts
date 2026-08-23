import i18n from "./i18n";
import { resolveTauriBackendBaseUrl } from "./tauri";
import { createAgentApi } from "./api/agentApi";
import { createAiApi } from "./api/aiApi";
import type { ApiContext } from "./api/context";
import { createLibraryApi } from "./api/libraryApi";
import { createSettingsApi } from "./api/settingsApi";

export const DEFAULT_API_BASE = "http://127.0.0.1:8765";
const BROWSER_LITE_MODE = import.meta.env.VITE_BROWSER_LITE === "true";
const browserLiteApiBase =
  BROWSER_LITE_MODE && typeof window !== "undefined"
    ? window.location.origin
    : DEFAULT_API_BASE;
export let API_BASE = browserLiteApiBase;

let apiBaseResolved = BROWSER_LITE_MODE;
let apiBasePromise: Promise<string> | null = null;

function isTauriRuntimeSync(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function resolveApiBase(): Promise<string> {
  if (apiBaseResolved) return API_BASE;
  if (apiBasePromise) return apiBasePromise;

  apiBasePromise = (async () => {
    try {
      if (isTauriRuntimeSync()) {
        const value = await resolveTauriBackendBaseUrl();
        const normalized = String(value || "").trim().replace(/\/+$/, "");
        if (normalized) API_BASE = normalized;
      }
    } catch (error) {
      console.warn("Failed to resolve Tauri backend base URL; using default", error);
    } finally {
      apiBaseResolved = true;
    }
    return API_BASE;
  })().finally(() => {
    apiBasePromise = null;
  });

  return apiBasePromise;
}

export async function ensureApiBase(): Promise<string> {
  return resolveApiBase();
}

export const AUDUX_CLIENT_HEADER = "X-Audux-Client";
export const AUDUX_CLIENT_ID = "audux";
export const AUDUX_TOKEN_HEADER = "X-Audux-Token";
export const AUDUX_TOKEN_QUERY = "access_token";

let localApiToken: string | null = null;
let localApiTokenPromise: Promise<string> | null = null;

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class ApiError extends Error {
  status: number;
  detail?: unknown;
  raw?: string;
  code?: string;
  params?: Record<string, unknown>;

  constructor(message: string, status: number, detail?: unknown, raw?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.raw = raw;
    if (isJsonObject(detail) && typeof detail.code === "string") {
      this.code = detail.code;
      this.params = isJsonObject(detail.params) ? detail.params : undefined;
    }
  }
}

function readableErrorFromJson(value: unknown): string {
  if (!isJsonObject(value)) {
    if (value === null || value === undefined) return "";
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  if (isJsonObject(value.detail) && typeof value.detail.code === "string") {
    const fallback = typeof value.detail.fallback === "string"
      ? value.detail.fallback
      : `HTTP error: ${value.detail.code}`;
    const params = isJsonObject(value.detail.params) ? value.detail.params : {};
    return i18n.t(`errors.${value.detail.code}`, { ...params, defaultValue: fallback });
  }
  if (typeof value.detail === "string") return value.detail;
  if (Array.isArray(value.detail)) {
    return value.detail.map((item) => {
      if (isJsonObject(item) && typeof item.msg === "string") return item.msg;
      return JSON.stringify(item);
    }).join("; ");
  }
  if (value.detail !== undefined) {
    try {
      return JSON.stringify(value.detail, null, 2);
    } catch {
      return String(value.detail);
    }
  }
  if (typeof value.message === "string") return value.message;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function parseErrorResponse(response: Response): Promise<ApiError> {
  const text = await response.text();
  if (!text) return new ApiError(`HTTP ${response.status}`, response.status);

  try {
    const json: unknown = JSON.parse(text);
    const message = readableErrorFromJson(json) || `HTTP ${response.status}`;
    const detail = isJsonObject(json) ? json.detail : undefined;
    return new ApiError(message, response.status, detail, text);
  } catch {
    return new ApiError(text, response.status, undefined, text);
  }
}

function isTokenFreePath(path: string): boolean {
  return path === "/health" || path === "/auth/token";
}

export async function ensureLocalApiToken(): Promise<string> {
  if (localApiToken) return localApiToken;
  if (localApiTokenPromise) return localApiTokenPromise;

  localApiTokenPromise = (async () => {
    const base = await resolveApiBase();
    const response = await fetch(`${base}/auth/token`, {
      headers: { [AUDUX_CLIENT_HEADER]: AUDUX_CLIENT_ID }
    });
    if (!response.ok) throw await parseErrorResponse(response);

    const json = await response.json();
    const token = String(json.token || "").trim();
    if (!token) throw new Error("Local API token is empty");
    localApiToken = token;
    return token;
  })().finally(() => {
    localApiTokenPromise = null;
  });

  return localApiTokenPromise;
}

function appendAccessToken(url: string): string {
  if (!localApiToken) return url;
  const token = `${AUDUX_TOKEN_QUERY}=${encodeURIComponent(localApiToken)}`;
  return `${url}${url.includes("?") ? "&" : "?"}${token}`;
}

function appendQuery(
  url: string,
  params: Record<string, string | number | undefined>
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const suffix = query.toString();
  return suffix ? `${url}${url.includes("?") ? "&" : "?"}${suffix}` : url;
}

async function request<T = unknown>(
  path: string,
  options?: RequestInit,
  retryOnUnauthorized = true
): Promise<T> {
  const body = options?.body;
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string> | undefined),
    [AUDUX_CLIENT_HEADER]: AUDUX_CLIENT_ID
  };

  if (!isTokenFreePath(path)) headers[AUDUX_TOKEN_HEADER] = await ensureLocalApiToken();
  if (!isFormData && !headers["Content-Type"] && body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const base = await resolveApiBase();
  const response = await fetch(`${base}${path}`, { ...options, headers });
  if (response.status === 401 && retryOnUnauthorized && !isTokenFreePath(path)) {
    localApiToken = null;
    await ensureLocalApiToken();
    return request<T>(path, options, false);
  }
  if (!response.ok) throw await parseErrorResponse(response);
  if (response.status === 204) return undefined as T;

  const text = await response.text();
  return text ? JSON.parse(text) : undefined as T;
}

export function isProbablyLocalEndpoint(endpoint: string): boolean {
  try {
    const host = new URL(endpoint).hostname.toLowerCase();
    return host === "localhost" || host.endsWith(".localhost") ||
      host === "127.0.0.1" || host.startsWith("127.") ||
      host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

function remoteEndpointWarning(endpoint: string, translationKey: string): string | null {
  const normalized = endpoint.trim();
  if (!normalized || isProbablyLocalEndpoint(normalized)) return null;
  return i18n.t(translationKey);
}

export function endpointPrivacyWarning(endpoint: string): string | null {
  return remoteEndpointWarning(endpoint, "warnings.llm.remote");
}

export function asrEndpointPrivacyWarning(endpoint: string): string | null {
  return remoteEndpointWarning(endpoint, "warnings.asr.remote");
}

const context: ApiContext = {
  request,
  appendAccessToken,
  appendQuery,
  getApiBase: () => API_BASE
};

export const api = {
  ensureAuthToken: ensureLocalApiToken,
  ...createAgentApi(context),
  ...createLibraryApi(context),
  ...createAiApi(context),
  ...createSettingsApi(context)
};
