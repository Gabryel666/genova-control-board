/**
 * Hermes Gateway key.
 *
 * Reflects the REAL gateway state, never the last click: `/api/health` answers
 * (the HTTP server is alive) and `/api/status` says whether the agent runtime is
 * running. A click applies the configured lifecycle action.
 */

import streamDeck, {
  action,
  SingletonAction,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { clearCache, fetchActiveProfile, fetchHealth, fetchStatus, gatewayLifecycle, shortName } from "../lib/gateway.js";
import { sleep } from "../lib/diag.js";
import { tile } from "../lib/render.js";
import { every } from "../lib/ticker.js";
import { diag } from "../lib/diag.js";

export interface StatusSettings {
  [key: string]: JsonValue;
  label?: string;
  /** none | start | stop | restart */
  onClick?: string;
}

interface Entry {
  action: any;
  settings: StatusSettings;
}

const entries = new Map<string, Entry>();
let busy = false;

function labelOf(settings: StatusSettings): string {
  return (settings.label ?? "").trim() || "HERMES";
}

async function paint(entry: Entry, tone: Parameters<typeof tile>[0]["tone"], value: string, footnote?: string) {
  try {
    await entry.action.setImage(tile({ label: labelOf(entry.settings), value, tone, footnote }));
  } catch (err) {
    diag(`status setImage: ${(err as Error).message}`);
  }
}

/** Read the gateway and paint the key. Cheap: every call is cached. */
async function refresh(entry: Entry): Promise<void> {
  const health = await fetchHealth();

  if (!health.ok) {
    // No HTTP answer at all: the gateway (or WSL, or the machine) is down.
    await paint(entry, "off", "OFF", health.status === 401 ? "token" : "injoignable");
    return;
  }

  const status = await fetchStatus();
  const state = (status.data?.gateway_state ?? "").toLowerCase();
  const running = status.data?.gateway_running ?? state !== "stopped";

  if (status.ok && !running) {
    await paint(entry, "warn", "DOWN", "runtime arrêté");
    return;
  }

  // Profile is a token-only endpoint: when it fails, fall back on the version.
  const profile = await fetchActiveProfile();
  const footnote = profile.ok && profile.data?.active
    ? shortName(String(profile.data.active), 16)
    : health.data?.version
      ? `v${health.data.version}`
      : undefined;

  await paint(entry, "on", "ON", footnote);
}

@action({ UUID: "com.genova.control-board.status" })
export class StatusAction extends SingletonAction<StatusSettings> {
  constructor() {
    super();
    every(async () => {
      for (const entry of Array.from(entries.values())) {
        if (!busy) await refresh(entry);
      }
    });
  }

  private track(act: any, settings: StatusSettings): Entry {
    const existing = entries.get(act.id);
    if (existing) {
      existing.settings = settings;
      return existing;
    }
    const entry: Entry = { action: act, settings };
    entries.set(act.id, entry);
    return entry;
  }

  override async onWillAppear(ev: WillAppearEvent<StatusSettings>): Promise<void> {
    const entry = this.track(ev.action, ev.payload.settings);
    await refresh(entry);
  }

  override async onWillDisappear(ev: WillDisappearEvent<StatusSettings>): Promise<void> {
    entries.delete(ev.action.id);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<StatusSettings>): Promise<void> {
    const entry = this.track(ev.action, ev.payload.settings);
    await refresh(entry);
  }

  override async onKeyDown(ev: KeyDownEvent<StatusSettings>): Promise<void> {
    const entry = entries.get(ev.action.id);
    if (!entry) return;

    const mode = ((entry.settings.onClick ?? "restart") as string).toLowerCase();
    if (mode === "none") {
      clearCache();
      await refresh(entry);
      return;
    }
    if (mode !== "start" && mode !== "stop" && mode !== "restart") return;

    if (busy) return;
    busy = true;
    try {
      diag(`gateway ${mode}`);
      await paint(entry, "warn", "…", mode);
      const result = await gatewayLifecycle(mode);
      if (!result.ok) {
        await paint(entry, "error", "ERR", result.error?.slice(0, 20));
        return;
      }

      // A restart closes the socket: wait for the HTTP server to answer again
      // instead of trusting the 200 that only means "restart scheduled".
      const deadline = mode === "stop" ? 20 : 60;
      for (let i = 0; i < deadline; i++) {
        await sleep(1000);
        clearCache();
        const health = await fetchHealth();
        if (mode === "stop" ? !health.ok : health.ok) break;
      }
      clearCache();
      await refresh(entry);
    } finally {
      busy = false;
    }
  }
}

/** Keeps the import used even when the key is never pressed (type-check aid). */
void streamDeck;
