/**
 * Hermes Cron key.
 *
 * One key per scheduled job: shows the outcome of the last run and fires the job
 * on click (`POST /api/cron/jobs/{id}/trigger`). The job list is fed to the
 * property inspector through `onSendToPlugin`, so the dropdown always matches
 * what the gateway actually has.
 */

import streamDeck, {
  action,
  SingletonAction,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  type SendToPluginEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { clearCache, fetchCronJobs, shortName, triggerCronJob } from "../lib/gateway.js";
import { diag, sleep } from "../lib/diag.js";
import { tile, type Tone } from "../lib/render.js";
import { every } from "../lib/ticker.js";

export interface CronSettings {
  [key: string]: JsonValue;
  jobId?: string;
  label?: string;
}

interface Entry {
  action: any;
  settings: CronSettings;
}

const entries = new Map<string, Entry>();
const busy = new Set<string>();

function labelOf(settings: CronSettings): string {
  return (settings.label ?? "").trim() || "CRON";
}

async function paint(entry: Entry, tone: Tone, value: string, footnote?: string) {
  try {
    await entry.action.setImage(tile({ label: labelOf(entry.settings), value, tone, footnote }));
  } catch (err) {
    diag(`cron setImage: ${(err as Error).message}`);
  }
}

/** Last run outcome → tone. Unknown-but-scheduled stays blue, not green. */
function toneOf(lastStatus: string | null | undefined): Tone {
  switch ((lastStatus ?? "").toLowerCase()) {
    case "ok":
    case "success":
    case "completed":
      return "on";
    case "error":
    case "failed":
    case "failure":
      return "error";
    case "running":
    case "pending":
      return "warn";
    default:
      return "idle";
  }
}

async function refresh(entry: Entry): Promise<void> {
  const jobId = (entry.settings.jobId ?? "").trim();
  if (!jobId) {
    await paint(entry, "unknown", "—", "choisir une tâche");
    return;
  }

  const jobs = await fetchCronJobs();
  if (!jobs.ok) {
    await paint(entry, "off", "OFF", jobs.status === 401 ? "token" : "injoignable");
    return;
  }

  const job = (jobs.data ?? []).find((candidate) => candidate.id === jobId);
  if (!job) {
    await paint(entry, "unknown", "?", "tâche absente");
    return;
  }

  const label = (entry.settings.label ?? "").trim() || shortName(job.name, 14);
  entry.action.setTitle(`${label}`).catch(() => undefined);

  if (job.enabled === false || (job.state ?? "").toLowerCase() === "paused") {
    await paint(entry, "unknown", "PAUSE", job.schedule_display);
    return;
  }

  const value = job.last_status ? String(job.last_status).toUpperCase().slice(0, 6) : "—";
  await paint(entry, toneOf(job.last_status), value, job.schedule_display);
}

@action({ UUID: "com.genova.control-board.cron" })
export class CronAction extends SingletonAction<CronSettings> {
  constructor() {
    super();
    every(async () => {
      for (const entry of Array.from(entries.values())) {
        if (!busy.has(entry.settings.jobId ?? entry.action.id)) await refresh(entry);
      }
    });
  }

  private track(act: any, settings: CronSettings): Entry {
    const existing = entries.get(act.id);
    if (existing) {
      existing.settings = settings;
      return existing;
    }
    const entry: Entry = { action: act, settings };
    entries.set(act.id, entry);
    return entry;
  }

  override async onWillAppear(ev: WillAppearEvent<CronSettings>): Promise<void> {
    await refresh(this.track(ev.action, ev.payload.settings));
  }

  override async onWillDisappear(ev: WillDisappearEvent<CronSettings>): Promise<void> {
    entries.delete(ev.action.id);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<CronSettings>): Promise<void> {
    await refresh(this.track(ev.action, ev.payload.settings));
  }

  override async onKeyDown(ev: KeyDownEvent<CronSettings>): Promise<void> {
    const entry = entries.get(ev.action.id);
    const jobId = (entry?.settings.jobId ?? "").trim();
    if (!entry || !jobId) return;

    if (busy.has(jobId)) return;
    busy.add(jobId);
    try {
      diag(`cron trigger ${jobId}`);
      await paint(entry, "warn", "…", "déclenchement");
      const result = await triggerCronJob(jobId);
      if (!result.ok) {
        await paint(entry, "error", "ERR", result.error?.slice(0, 20));
        return;
      }

      // The run is asynchronous on the gateway side: poll a few seconds so the
      // key shows the fresh status instead of the previous one.
      for (let i = 0; i < 10; i++) {
        await sleep(1500);
        clearCache();
        const jobs = await fetchCronJobs();
        const job = (jobs.data ?? []).find((candidate) => candidate.id === jobId);
        if (job && (job.last_status ?? "").toLowerCase() !== "running") break;
      }
      clearCache();
      await refresh(entry);
    } finally {
      busy.delete(jobId);
    }
  }

  override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, CronSettings>): Promise<void> {
    const payload = ev.payload as { event?: string };
    if (payload?.event !== "getCronJobs") return;

    const jobs = await fetchCronJobs();
    const items = (jobs.data ?? [])
      .filter((job) => job && job.id)
      .map((job) => ({
        value: job.id,
        label: `${job.name ?? job.id} — ${job.schedule_display ?? job.id}${job.last_status ? ` (${job.last_status})` : ""}`,
      }));

    if (!jobs.ok) {
      items.unshift({ value: "", label: `Gateway injoignable : ${jobs.error ?? "erreur"}` });
    }

    await streamDeck.ui.sendToPropertyInspector({ event: "getCronJobs", items });
  }
}
