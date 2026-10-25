/**
 * Hermes Model key.
 *
 * Shows the main model currently configured for the gateway. A click applies
 * the provider/model pair stored in the key's settings (`POST /api/model/set`),
 * i.e. one key per model — a model switcher row.
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

import { applyModel, clearCache, fetchModel, shortModel, shortName } from "../lib/gateway.js";
import { diag, sleep } from "../lib/diag.js";
import { tile } from "../lib/render.js";
import { every } from "../lib/ticker.js";

export interface ModelSettings {
  [key: string]: JsonValue;
  /** Provider id, e.g. "openrouter". Empty = read-only key. */
  provider?: string;
  /** Model id, e.g. "deepseek/deepseek-v4.1-flash". */
  model?: string;
  label?: string;
}

interface Entry {
  action: any;
  settings: ModelSettings;
}

const entries = new Map<string, Entry>();
const busy = new Set<string>();

function labelOf(settings: ModelSettings): string {
  return (settings.label ?? "").trim() || "MODEL";
}

async function paint(entry: Entry, tone: Parameters<typeof tile>[0]["tone"], value: string, footnote?: string) {
  try {
    await entry.action.setImage(tile({ label: labelOf(entry.settings), value, tone, footnote }));
  } catch (err) {
    diag(`model setImage: ${(err as Error).message}`);
  }
}

async function refresh(entry: Entry): Promise<void> {
  const info = await fetchModel();
  if (!info.ok) {
    await paint(entry, "off", "OFF", info.status === 401 ? "token" : "injoignable");
    return;
  }

  const current = info.data?.model ?? "";
  const wanted = (entry.settings.model ?? "").trim();
  // A model key with a target set is "active" only when that target is live.
  const isActive = wanted ? wanted === current : true;

  await paint(
    entry,
    isActive ? "on" : "idle",
    shortModel(current),
    info.data?.provider ? shortName(String(info.data.provider), 16) : undefined,
  );
}

@action({ UUID: "com.genova.control-board.model" })
export class ModelAction extends SingletonAction<ModelSettings> {
  constructor() {
    super();
    every(async () => {
      for (const entry of Array.from(entries.values())) {
        if (!busy.has(entry.settings.model ?? entry.action.id)) await refresh(entry);
      }
    });
  }

  private track(act: any, settings: ModelSettings): Entry {
    const existing = entries.get(act.id);
    if (existing) {
      existing.settings = settings;
      return existing;
    }
    const entry: Entry = { action: act, settings };
    entries.set(act.id, entry);
    return entry;
  }

  override async onWillAppear(ev: WillAppearEvent<ModelSettings>): Promise<void> {
    await refresh(this.track(ev.action, ev.payload.settings));
  }

  override async onWillDisappear(ev: WillDisappearEvent<ModelSettings>): Promise<void> {
    entries.delete(ev.action.id);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<ModelSettings>): Promise<void> {
    await refresh(this.track(ev.action, ev.payload.settings));
  }

  override async onKeyDown(ev: KeyDownEvent<ModelSettings>): Promise<void> {
    const entry = entries.get(ev.action.id);
    if (!entry) return;

    const model = (entry.settings.model ?? "").trim();
    const provider = (entry.settings.provider ?? "").trim();
    if (!model || !provider) {
      // Read-only key: a click just forces a fresh read.
      clearCache();
      await refresh(entry);
      return;
    }

    if (busy.has(model)) return;
    busy.add(model);
    try {
      diag(`model -> ${provider}/${model}`);
      await paint(entry, "warn", "…", "application");
      const result = await applyModel(provider, model);
      if (!result.ok) {
        await paint(entry, "error", "ERR", result.error?.slice(0, 20));
        return;
      }
      // `POST /api/model/set` writes config.yaml for NEW sessions; give the
      // gateway a moment before reading the resolved model back.
      await sleep(700);
      clearCache();
      await refresh(entry);
    } finally {
      busy.delete(model);
    }
  }
}
