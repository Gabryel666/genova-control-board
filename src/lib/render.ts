/**
 * Key rendering.
 *
 * Every key is drawn as an SVG tile at 144x144 — the native Stream Deck key
 * size. No image files to configure, nothing to break when the plugin is
 * installed on another machine, and the payload stays a few hundred bytes.
 * (`setImage` silently drops oversized payloads, so this matters.)
 */

export type Tone = "on" | "off" | "warn" | "error" | "idle" | "unknown";

const COLORS: Record<Tone, string> = {
  on: "#22c55e",
  off: "#ef4444",
  warn: "#f97316",
  error: "#ef4444",
  idle: "#3b82f6",
  unknown: "#6b7280",
};

export interface TileOptions {
  /** Small text at the top, e.g. "HERMES" or a job name. */
  label: string;
  /** Big text in the middle, e.g. "ON" or "42%". */
  value: string;
  tone: Tone;
  /** Small text at the bottom, e.g. a profile name or a version. */
  footnote?: string;
}

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Greedy word wrap for the label, so "MàJ description crédits" reads well. */
function wrap(text: string, maxChars = 13, maxLines = 2): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
    if (lines.length === maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);

  if (!lines.length) return [text.slice(0, maxChars)];

  // Overflow: clip the last line rather than silently losing the tail.
  const consumed = lines.join(" ").length;
  if (consumed < text.replace(/\s+/g, " ").length) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = last.length >= maxChars ? `${last.slice(0, maxChars - 1)}…` : `${last}…`;
  }
  return lines;
}

export function tile(options: TileOptions): string {
  const color = COLORS[options.tone];
  const labelLines = wrap(options.label);
  const labelStart = labelLines.length > 1 ? 24 : 30;
  const labelSvg = labelLines
    .map(
      (line, i) =>
        `<text x="78" y="${labelStart + i * 17}" text-anchor="middle" font-family="Segoe UI, system-ui, sans-serif" font-size="15" fill="#9ca3af">${esc(line)}</text>`,
    )
    .join("");

  const valueSize = options.value.length > 7 ? 30 : options.value.length > 4 ? 40 : 50;
  const valueY = labelLines.length > 1 ? 104 : 100;
  const footnote = options.footnote
    ? `<text x="78" y="132" text-anchor="middle" font-family="Segoe UI, system-ui, sans-serif" font-size="12" fill="#6b7280">${esc(options.footnote.slice(0, 20))}</text>`
    : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
    <rect width="144" height="144" rx="14" fill="#15151d"/>
    <rect x="0" y="0" width="6" height="144" rx="3" fill="${color}"/>
    ${labelSvg}
    <text x="78" y="${valueY}" text-anchor="middle" font-family="Segoe UI, system-ui, sans-serif" font-size="${valueSize}" font-weight="700" fill="#f4f4f5">${esc(options.value)}</text>
    ${footnote}
  </svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Percentage → tone, with generous thresholds: 70/90. */
export function percentTone(percent: number): Tone {
  if (!Number.isFinite(percent)) return "unknown";
  if (percent >= 90) return "error";
  if (percent >= 70) return "warn";
  return "on";
}
