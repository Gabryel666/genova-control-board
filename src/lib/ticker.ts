/**
 * Shared ticker.
 *
 * Every action subscribes one refresh handler; the ticker runs them
 * sequentially on a single timer. Combined with the response cache in
 * gateway.ts, N keys cost ONE HTTP request per endpoint per tick — not N.
 */

import { diag } from "./diag.js";

export const TICK_MS = 3000;

type Handler = () => void | Promise<void>;

const handlers = new Set<Handler>();
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function run(): Promise<void> {
  if (running) return; // never overlap ticks
  running = true;
  try {
    for (const handler of Array.from(handlers)) {
      try {
        await handler();
      } catch (err) {
        diag(`tick handler: ${(err as Error).message}`);
      }
    }
  } finally {
    running = false;
  }
}

export function every(handler: Handler): void {
  handlers.add(handler);
  if (!timer) {
    timer = setInterval(() => void run(), TICK_MS);
    void run(); // first refresh right away, no 3 s of grey keys
  }
}
