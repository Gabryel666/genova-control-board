/** Minimal logging: everything goes to the Stream Deck plugin log file. */
export function diag(msg: string): void {
  const stamp = new Date().toISOString().slice(11, 23);
  console.log(`[gcb ${stamp}] ${msg}`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
