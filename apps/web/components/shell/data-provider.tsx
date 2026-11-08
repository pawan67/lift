/**
 * Boots the data layer and keeps it in sync.
 *
 * 1. Confirms the session with the server (an expired one goes to sign-in).
 * 2. Loads the catalog chunk and the IndexedDB copy in parallel, then renders.
 *    A returning visitor sees their numbers immediately, before any network.
 * 3. Syncs in the background, then again every minute, when the tab regains
 *    focus, and when the browser comes back online.
 */

"use client";

import { useEffect, type ReactNode } from "react";

import { loadCatalog } from "@/lib/data/catalog";
import { readMeta, wipeDatabase, writeMeta } from "@/lib/data/idb";
import { useData, type SessionUser } from "@/lib/data/store";
import { hardNavigate, hydrateFromDisk, syncNow } from "@/lib/data/sync";
import { listenForChanges } from "@/lib/data/tabs";

const SYNC_INTERVAL_MS = 60_000;

let booted = false;

async function boot(): Promise<void> {
  const response = await fetch("/api/auth/session", { cache: "no-store" });
  if (response.status === 401) {
    hardNavigate("/sign-in");
    return;
  }
  if (!response.ok) throw new Error("The Lift server could not be reached.");
  const { user } = (await response.json()) as { user: SessionUser };

  // A different account than the one this browser last held: start clean.
  const owner = await readMeta<string>("owner");
  if (owner && owner !== user.id) await wipeDatabase();
  if (owner !== user.id) await writeMeta("owner", user.id);

  await Promise.all([loadCatalog(), hydrateFromDisk()]);
  useData.setState({ user, status: "ready" });

  void syncNow();
}

export function DataProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (!booted) {
      booted = true;
      boot().catch((error: unknown) => {
        booted = false;
        useData.setState({ status: "error", bootError: error instanceof Error ? error.message : String(error) });
      });
    }

    const interval = setInterval(() => {
      if (document.visibilityState === "visible" && useData.getState().status === "ready") void syncNow();
    }, SYNC_INTERVAL_MS);

    const onFocus = () => {
      const { status, lastSyncedAt } = useData.getState();
      if (status === "ready" && (!lastSyncedAt || Date.now() - lastSyncedAt > 15_000)) void syncNow();
    };

    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onFocus);
    const stopListening = listenForChanges(() => {
      if (useData.getState().status === "ready") void hydrateFromDisk();
    });
    return () => {
      stopListening();
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onFocus);
    };
  }, []);

  return <>{children}</>;
}
