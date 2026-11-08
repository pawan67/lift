/**
 * Keeps several open tabs consistent.
 *
 * Tabs share one IndexedDB copy and one pull cursor. When one tab pulls, the
 * cursor moves past those rows for every tab, so the others would never see
 * them in memory. Each tab therefore announces that it wrote to disk, and the
 * others reload their in-memory copy from disk.
 */

let channel: BroadcastChannel | null = null;
let reloadTimer: ReturnType<typeof setTimeout> | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  channel ??= new BroadcastChannel("lift-web-data");
  return channel;
}

export function announceChange(): void {
  getChannel()?.postMessage("changed");
}

/** Calls `reload` (debounced) whenever another tab changes the data. */
export function listenForChanges(reload: () => void): () => void {
  const target = getChannel();
  if (!target) return () => undefined;
  const onMessage = () => {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(reload, 250);
  };
  target.addEventListener("message", onMessage);
  return () => target.removeEventListener("message", onMessage);
}
