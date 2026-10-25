/**
 * Hermes gateway client.
 *
 * Works against ANY Hermes Agent installation: the only thing it needs is the
 * dashboard URL. Most read-only endpoints (`/api/health`, `/api/status`,
 * `/api/model/info`) are open; sensitive ones need the dashboard session token.
 *
 * The plugin discovers that token the same way the dashboard SPA does: the
 * server injects `window.__HERMES_SESSION_TOKEN__` into index.html. So a key on
 * a laptop with a local Hermes needs zero configuration, and a remote one only
 * needs a URL (plus a manual token when the dashboard is behind its OAuth gate).
 */

import { diag } from "./diag.js";

export const DEFAULT_BASE_URL = "http://localhost:9119";
const TIMEOUT_MS = 4000;

/** Plugin-wide configuration, edited from any key's property inspector. */
export interface GlobalConfig {
  baseUrl?: string;
  token?: string;
}

let globals: GlobalConfig = {};

export function setGlobalConfig(config: GlobalConfig | undefined): void {
  globals = config ?? {};
  cache.clear();
  diag(`config gateway=${resolveBaseUrl()} token=${globals.token ? "manuel" : "auto"}`);
}

export function getGlobalConfig(): GlobalConfig {
  return globals;
}

export function resolveBaseUrl(override?: string): string {
  let raw = (override || globals.baseUrl || DEFAULT_BASE_URL).trim();
  if (!/^https?:\/\//i.test(raw)) raw = `http://${raw}`;
  return raw.replace(/\/+$/, "");
}

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

// ── Session token ──────────────────────────────────────────

/** baseUrl -> token (null = the install injects none, i.e. gated mode). */
const tokenCache = new Map<string, string | null>();

async function discoverToken(base: string): Promise<string | null> {
  try {
    const res = await fetch(`${base}/`, {
      headers: { accept: "text/html" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(/__HERMES_SESSION_TOKEN__\s*=\s*"([^"]+)"/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

async function authToken(base: string): Promise<string | null> {
  const manual = (globals.token || "").trim();
  if (manual) return manual;
  if (tokenCache.has(base)) return tokenCache.get(base) ?? null;
  const token = await discoverToken(base);
  tokenCache.set(base, token);
  diag(token ? `token découvert sur ${base}` : `aucun token sur ${base} (dashboard gated ?)`);
  return token;
}

// ── Responses cache ────────────────────────────────────────

interface CacheEntry {
  at: number;
  result: ApiResult<unknown>;
}

const cache = new Map<string, CacheEntry>();

/** TTLs: fast data stays fresh, slow data is not hammered. */
export const TTL = {
  health: 2500,
  status: 2500,
  model: 5000,
  cron: 4000,
  stats: 3000,
  sessions: 6000,
};

export function clearCache(): void {
  cache.clear();
}

// ── Low-level request ──────────────────────────────────────

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  /** Per-key override of the plugin-wide base URL. */
  baseUrl?: string;
}

async function request<T>(path: string, options: RequestOptions = {}, retriedAuth = false): Promise<ApiResult<T>> {
  const base = resolveBaseUrl(options.baseUrl);
  const token = await authToken(base);

  const headers: Record<string, string> = { accept: "application/json" };
  if (token) headers["X-Hermes-Session-Token"] = token;
  if (options.body !== undefined) headers["content-type"] = "application/json";

  try {
    const res = await fetch(`${base}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    // A stale token is the normal case: the dashboard restarted and minted a
    // new one. Forget it and retry once with a fresh discovery.
    if (res.status === 401 && !retriedAuth) {
      tokenCache.delete(base);
      return request<T>(path, options, true);
    }

    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = text;
    }

    if (!res.ok) {
      const detail =
        (data && typeof data === "object" && "detail" in data && String((data as { detail: unknown }).detail)) ||
        (typeof data === "string" ? data.slice(0, 120) : "") ||
        "";
      return { ok: false, status: res.status, data: data as T, error: `HTTP ${res.status}${detail ? ` — ${detail}` : ""}` };
    }

    return { ok: true, status: res.status, data: data as T };
  } catch (err) {
    const message = (err as Error).message || "échec réseau";
    return { ok: false, status: 0, error: message };
  }
}

/** GET with a short-lived cache, so many keys share one request. */
export async function getCached<T>(path: string, ttlMs: number, baseUrl?: string): Promise<ApiResult<T>> {
  const key = `${resolveBaseUrl(baseUrl)}${path}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.result as ApiResult<T>;

  const result = await request<T>(path, { baseUrl });
  // Never cache a transport failure — a gateway coming back must show up on
  // the very next tick, not after the TTL.
  if (result.ok || result.status > 0) cache.set(key, { at: Date.now(), result });
  return result;
}

/** POST that invalidates the cache afterwards. */
export async function post<T>(path: string, body?: unknown, baseUrl?: string): Promise<ApiResult<T>> {
  const result = await request<T>(path, { method: "POST", body, baseUrl });
  cache.clear();
  return result;
}

// ── Payload shapes ─────────────────────────────────────────

export interface HealthPayload {
  ok?: boolean;
  version?: string;
  auth_required?: boolean;
}

export interface StatusPayload {
  version?: string;
  gateway_running?: boolean;
  gateway_state?: string;
  active_profile?: string;
  platforms?: unknown;
}

export interface ModelInfoPayload {
  model?: string;
  provider?: string;
  effective_context_length?: number;
}

export interface ActiveProfilePayload {
  active?: string;
  current?: string;
}

export interface CronJobPayload {
  id: string;
  name?: string;
  enabled?: boolean;
  state?: string;
  schedule_display?: string;
  next_run_at?: string | null;
  last_run_at?: string | null;
  last_status?: string | null;
  last_error?: string | null;
}

export interface StatsPayload {
  cpu_percent?: number;
  cpu_count?: number;
  load_avg?: number[];
  uptime_seconds?: number;
  hostname?: string;
  hermes_version?: string;
  memory?: { total?: number; used?: number; available?: number; percent?: number };
  disk?: { total?: number; used?: number; free?: number; percent?: number };
}

export interface SessionsPayload {
  total?: number;
  messages?: number;
}

// ── High-level calls ───────────────────────────────────────

export const fetchHealth = (baseUrl?: string) => getCached<HealthPayload>("/api/health", TTL.health, baseUrl);
export const fetchStatus = (baseUrl?: string) => getCached<StatusPayload>("/api/status", TTL.status, baseUrl);
export const fetchModel = (baseUrl?: string) => getCached<ModelInfoPayload>("/api/model/info", TTL.model, baseUrl);
export const fetchActiveProfile = (baseUrl?: string) =>
  getCached<ActiveProfilePayload>("/api/profiles/active", TTL.model, baseUrl);
export const fetchStats = (baseUrl?: string) => getCached<StatsPayload>("/api/system/stats", TTL.stats, baseUrl);
export const fetchSessions = (baseUrl?: string) =>
  getCached<SessionsPayload>("/api/sessions/stats", TTL.sessions, baseUrl);
export const fetchCronJobs = (baseUrl?: string) => getCached<CronJobPayload[]>("/api/cron/jobs", TTL.cron, baseUrl);

/** "restart" | "start" | "stop" — the gateway lifecycle endpoints. */
export function gatewayLifecycle(action: "start" | "stop" | "restart", baseUrl?: string) {
  return post<unknown>(`/api/gateway/${action}`, undefined, baseUrl);
}

export function triggerCronJob(jobId: string, baseUrl?: string) {
  return post<unknown>(`/api/cron/jobs/${encodeURIComponent(jobId)}/trigger`, undefined, baseUrl);
}

export function applyModel(provider: string, model: string, baseUrl?: string) {
  return post<unknown>(
    "/api/model/set",
    { scope: "main", provider, model, task: "", base_url: "", api_key: "" },
    baseUrl,
  );
}

// ── Display helpers ────────────────────────────────────────

/** `deepseek/deepseek-v4.1-flash` -> `deepseek-v4.1-flash` */
export function shortModel(model: string | undefined): string {
  if (!model) return "—";
  const tail = model.split("/").pop() ?? model;
  return tail.length > 16 ? `${tail.slice(0, 15)}…` : tail;
}

export function shortName(name: string | undefined, max = 14): string {
  const value = (name ?? "").trim();
  if (!value) return "—";
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
