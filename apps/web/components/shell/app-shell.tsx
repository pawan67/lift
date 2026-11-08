/**
 * The frame around every signed-in screen: a side rail on desktop, a top bar
 * and bottom tabs on a phone, and the boot/sync state.
 */

"use client";

import {
  BarChart3,
  CalendarDays,
  Dumbbell,
  History,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  RefreshCw,
  Ruler,
  Settings,
  Trophy,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { ConfirmHost, ToastHost } from "@/components/ui/dialog";
import { Button, Skeleton } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { usePresence } from "@/lib/use-presence";
import { wipeDatabase } from "@/lib/data/idb";
import { useData } from "@/lib/data/store";
import { hardNavigate, syncNow } from "@/lib/data/sync";

import { DataProvider } from "./data-provider";
import { LiftMark } from "./lift-mark";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Also active on these path prefixes. */
  match?: string[];
}

const NAV: { heading: string; items: NavItem[] }[] = [
  {
    heading: "Overview",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/stats", label: "Statistics", icon: BarChart3 },
      { href: "/history", label: "History", icon: History },
      { href: "/calendar", label: "Calendar", icon: CalendarDays },
      { href: "/records", label: "Records", icon: Trophy },
    ],
  },
  {
    heading: "Library",
    items: [
      { href: "/exercises", label: "Exercises", icon: Dumbbell },
      { href: "/routines", label: "Routines", icon: ListChecks },
    ],
  },
  {
    heading: "Body",
    items: [{ href: "/measurements", label: "Measurements", icon: Ruler }],
  },
];

/** The phone's bottom bar: the five places worth one tap. */
const TABS: NavItem[] = [
  { href: "/", label: "Home", icon: LayoutDashboard },
  { href: "/stats", label: "Stats", icon: BarChart3, match: ["/history", "/calendar", "/records"] },
  { href: "/exercises", label: "Exercises", icon: Dumbbell },
  { href: "/routines", label: "Routines", icon: ListChecks },
  { href: "/measurements", label: "Body", icon: Ruler },
];

function isActive(pathname: string, item: NavItem): boolean {
  const prefixes = [item.href, ...(item.match ?? [])];
  return prefixes.some((prefix) => (prefix === "/" ? pathname === "/" : pathname === prefix || pathname.startsWith(`${prefix}/`)));
}

export async function signOut() {
  await fetch("/api/auth/sign-out", { method: "POST" }).catch(() => undefined);
  await wipeDatabase().catch(() => undefined);
  hardNavigate("/sign-in");
}

function SyncStatus({ compact = false }: { compact?: boolean }) {
  const syncing = useData((s) => s.syncing);
  const lastSyncedAt = useData((s) => s.lastSyncedAt);
  const syncError = useData((s) => s.syncError);
  const pending = useData((s) => s.pending);

  const label = syncing
    ? "Syncing…"
    : syncError
      ? "Sync failed"
      : pending > 0
        ? `${pending} change${pending === 1 ? "" : "s"} to upload`
        : lastSyncedAt
          ? "Up to date"
          : "Not synced yet";

  return (
    <button
      type="button"
      onClick={() => void syncNow()}
      title={syncError ?? "Sync now"}
      className={cn(
        "press flex items-center gap-2 rounded-md text-xs hover:bg-surface-2",
        compact ? "p-2" : "w-full px-3 py-2",
        syncError ? "text-alarm" : "text-fg-3 hover:text-fg",
      )}
    >
      <RefreshCw size={14} className={cn(syncing && "animate-spin")} />
      {compact ? null : <span className="truncate">{label}</span>}
    </button>
  );
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3">
      {NAV.map((group) => (
        <div key={group.heading}>
          <div className="mb-1 px-3 text-xs font-medium text-fg-3/80">{group.heading}</div>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = isActive(pathname, item);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative flex items-center gap-3 rounded-md px-3 py-[7px] text-sm transition-colors duration-150",
                      active ? "bg-surface-3 font-medium text-fg" : "text-fg-2 hover:bg-surface-2 hover:text-fg",
                    )}
                  >
                    {active ? <span className="absolute top-2 bottom-2 -left-3 w-[3px] rounded-r-full bg-volt" aria-hidden /> : null}
                    <Icon size={16} strokeWidth={active ? 2.25 : 1.75} className={active ? "text-volt" : "text-fg-3"} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function AccountFooter({ onNavigate }: { onNavigate?: () => void }) {
  const user = useData((s) => s.user);
  const pathname = usePathname();
  return (
    <div className="space-y-1 border-t border-line p-3">
      <SyncStatus />
      <Link
        href="/settings"
        onClick={onNavigate}
        className={cn(
          "flex items-center gap-3 rounded-md px-3 py-[7px] text-sm transition-colors duration-150",
          pathname.startsWith("/settings") ? "bg-surface-3 font-medium text-fg" : "text-fg-2 hover:bg-surface-2 hover:text-fg",
        )}
      >
        <Settings size={16} strokeWidth={1.75} className={pathname.startsWith("/settings") ? "text-volt" : "text-fg-3"} /> Settings
      </Link>
      <div className="flex items-center gap-2 px-3 pt-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface-2 text-xs font-semibold text-fg-2 uppercase">
          {(user?.name || user?.email || "?").slice(0, 1)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-fg">{user?.name || "Signed in"}</div>
          <div className="truncate text-xs text-fg-3">{user?.email}</div>
        </div>
        <button
          type="button"
          onClick={() => void signOut()}
          title="Sign out"
          aria-label="Sign out"
          className="press rounded-md p-2 text-fg-3 hover:bg-surface-2 hover:text-fg"
        >
          <LogOut size={15} />
        </button>
      </div>
    </div>
  );
}

function BootScreen() {
  const status = useData((s) => s.status);
  const error = useData((s) => s.bootError);

  if (status === "error") {
    return (
      <div className="mx-auto mt-24 max-w-md text-center">
        <p className="text-base font-medium text-fg">Lift could not start</p>
        <p className="mt-2 text-sm text-fg-3">{error}</p>
        <Button className="mt-5" variant="primary" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}

/** Shown on top of an empty log while the first pull is still running. */
function FirstSyncBanner() {
  const syncing = useData((s) => s.syncing);
  const lastSyncedAt = useData((s) => s.lastSyncedAt);
  const empty = useData((s) => s.tables.workouts.size === 0 && s.tables.body_measurements.size === 0);
  if (!syncing || lastSyncedAt || !empty) return null;
  return (
    <div className="mb-6 flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-sm text-fg-2">
      <RefreshCw size={15} className="animate-spin text-volt" />
      Downloading your training log…
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const status = useData((s) => s.status);
  const [drawer, setDrawer] = useState(false);
  const drawerPresence = usePresence(drawer, 220);

  return (
    <DataProvider>
      <div className="min-h-dvh lg:pl-60">
        {/* Desktop rail */}
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-ink lg:flex">
          <Link href="/" className="flex items-center gap-2.5 px-6 pt-6 pb-6">
            <LiftMark className="h-6 w-6" />
            <span className="text-[17px] font-semibold tracking-tight">Lift</span>
          </Link>
          <NavLinks pathname={pathname} />
          <AccountFooter />
        </aside>

        {/* Phone top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-ink/85 px-4 backdrop-blur lg:hidden">
          <Link href="/" className="flex items-center gap-2">
            <LiftMark className="h-6 w-6" />
            <span className="font-semibold">Lift</span>
          </Link>
          <div className="flex items-center gap-1">
            <SyncStatus compact />
            <button type="button" onClick={() => setDrawer(true)} className="press rounded-lg p-2 text-fg-2 hover:bg-surface-2" aria-label="Menu">
              <Menu size={20} />
            </button>
          </div>
        </header>

        {/* Phone drawer */}
        {drawerPresence.mounted ? (
          <div
            className={cn("fixed inset-0 z-50 lg:hidden", drawerPresence.closing && "pointer-events-none")}
            data-closing={drawerPresence.closing || undefined}
          >
            <div className="overlay-backdrop absolute inset-0 bg-black/70" onClick={() => setDrawer(false)} aria-hidden />
            <div className="drawer-panel absolute inset-y-0 right-0 flex w-72 max-w-[85vw] flex-col border-l border-line bg-surface">
              <div className="flex items-center justify-between px-5 py-4">
                <span className="font-semibold">Menu</span>
                <button type="button" onClick={() => setDrawer(false)} className="press rounded-lg p-1.5 text-fg-3 hover:bg-surface-2" aria-label="Close menu">
                  <X size={18} />
                </button>
              </div>
              <NavLinks pathname={pathname} onNavigate={() => setDrawer(false)} />
              <AccountFooter onNavigate={() => setDrawer(false)} />
            </div>
          </div>
        ) : null}

        <main className="mx-auto w-full max-w-6xl px-4 pt-6 pb-28 sm:px-6 lg:px-10 lg:pt-10 lg:pb-16">
          {status === "ready" ? (
            <>
              <FirstSyncBanner />
              {children}
            </>
          ) : (
            <BootScreen />
          )}
        </main>

        {/* Phone bottom tabs */}
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-ink/90 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
          <ul className="grid grid-cols-5">
            {TABS.map((item) => {
              const active = isActive(pathname, item);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex flex-col items-center gap-1 pt-2.5 pb-2 text-[10px] font-medium transition-[transform,color] duration-150 ease-out active:scale-95",
                      active ? "text-fg" : "text-fg-3",
                    )}
                  >
                    <Icon size={20} strokeWidth={active ? 2.25 : 1.75} className={active ? "text-volt" : undefined} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
      <ConfirmHost />
      <ToastHost />
    </DataProvider>
  );
}
