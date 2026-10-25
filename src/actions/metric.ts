/**
 * Hermes Metric key.
 *
 * A live number pulled from the gateway: CPU, RAM, disk, sessions or messages.
 * Percentages turn orange then red as they fill up; a click forces a fresh read.
 */

import {
  action,
  SingletonAction,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { clearCache, fetchSessions, fetchStats } from "../lib/gateway.js";
import { diag } from "../lib/diag.js";
import { percentTone, tile, type Tone } from "../lib/render.js";
import { every } from "../lib/ticker.js";

export type MetricSource = "cpu" | "ram" | "disk" | "sessions" | "messages" | "uptime";

export interface MetricSettings {
  [key: string]: JsonValue;
  source?: string;
  label?: string;
}

interface Entry {
  action: any;
  settings: MetricSettings;
}

const entries = new Map<string, Entry>();

const DEFAULT_LABEL: Record<MetricSource, string> = {
  cpu: "CPU",
  ram: "RAM",
  disk: "DISK",
  sessions: "SESSIONS",
  messages: "MESSAGES",
  uptime: "UPTIME",
};

function sourceOf(settings: MetricSettings): MetricSource {
  const raw = (settings.source ?? "ram").toLowerCase();
  return (raw in DEFAULT_LABEL ? raw : "ram") as MetricSource;
}

function labelOf(settings: MetricSettings): string {
  return (settings.label ?? "").trim() || DEFAULT_LABEL[sourceOf(settings)];
}

async function paint(entry: Entry, tone: Tone, value: string, footnote?: string) {
  try {
    await entry.action.setImage(tile({ label: labelOf(entry.settings), value, tone, footnote }));
  } catch (err) {
    diag(`metric setImage: ${(err as Error).message}`);
  }
}

function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  const hours = Math.floor(seconds / 3600);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}j ${hours % 24}h`;
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function formatCount(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  return String(value);
}

async function refresh(entry: Entry): Promise<void> {
  const source = sourceOf(entry.settings);

  if (source === "sessions" || source === "messages") {
    const sessions = await fetchSessions();
    if (!sessions.ok) {
      await paint(entry, "off", "OFF", sessions.status === 401 ? "token" : "injoignable");
      return;
    }
    const count = source === "sessions" ? sessions.data?.total : sessions.data?.messages;
    await paint(entry, "idle", formatCount(Number(count ?? 0)), source === "sessions" ? "sessions" : "messages");
    return;
  }

  const stats = await fetchStats();
  if (!stats.ok) {
    await paint(entry, "off", "OFF", stats.status === 401 ? "token" : "injoignable");
    return;
  }

  const data = stats.data ?? {};
  switch (source) {
    case "cpu": {
      const percent = Number(data.cpu_percent ?? 0);
      await paint(entry, percentTone(percent), `${Math.round(percent)}%`, `${data.cpu_count ?? "?"} cœurs`);
      return;
    }
    case "ram": {
      const percent = Number(data.memory?.percent ?? 0);
      const usedGb = (Number(data.memory?.used ?? 0) / 1024 ** 3).toFixed(1);
      const totalGb = (Number(data.memory?.total ?? 0) / 1024 ** 3).toFixed(0);
      await paint(entry, percentTone(percent), `${Math.round(percent)}%`, `${usedGb}/${totalGb} Go`);
      return;
    }
    case "disk": {
      const percent = Number(data.disk?.percent ?? 0);
      const freeGb = (Number(data.disk?.free ?? 0) / 1024 ** 3).toFixed(0);
      await paint(entry, percentTone(percent), `${Math.round(percent)}%`, `${freeGb} Go libres`);
      return;
    }
    case "uptime": {
      await paint(entry, "idle", formatUptime(Number(data.uptime_seconds ?? 0)), data.hostname);
      return;
    }
    default:
      await paint(entry, "unknown", "?", source);
  }
}

@action({ UUID: "com.genova.control-board.metric" })
export class MetricAction extends SingletonAction<MetricSettings> {
  constructor() {
    super();
    every(async () => {
      for (const entry of Array.from(entries.values())) await refresh(entry);
    });
  }

  private track(act: any, settings: MetricSettings): Entry {
    const existing = entries.get(act.id);
    if (existing) {
      existing.settings = settings;
      return existing;
    }
    const entry: Entry = { action: act, settings };
    entries.set(act.id, entry);
    return entry;
  }

  override async onWillAppear(ev: WillAppearEvent<MetricSettings>): Promise<void> {
    await refresh(this.track(ev.action, ev.payload.settings));
  }

  override async onWillDisappear(ev: WillDisappearEvent<MetricSettings>): Promise<void> {
    entries.delete(ev.action.id);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<MetricSettings>): Promise<void> {
    await refresh(this.track(ev.action, ev.payload.settings));
  }

  override async onKeyDown(ev: KeyDownEvent<MetricSettings>): Promise<void> {
    const entry = entries.get(ev.action.id);
    if (!entry) return;
    clearCache();
    await refresh(entry);
  }
}
