/**
 * Light and dark.
 *
 * The choice lives in the Appearance setting (`lib/settings.ts`), which is in
 * localStorage, so the server cannot know it. `ThemeScript` runs in <head>
 * before first paint and sets `data-theme` on <html> from storage (see the
 * Next guide `preventing-flash-before-hydration`); `ThemeSync` keeps it right
 * afterwards, when the setting changes or, on "system", when the operating
 * system switches.
 */

"use client";

import { useEffect, useSyncExternalStore } from "react";

import { SETTINGS_STORAGE_KEY, useSettings, type ThemePreference } from "@/lib/settings";

export type ResolvedTheme = "light" | "dark";

const LIGHT_QUERY = "(prefers-color-scheme: light)";

/** The canvas colour per theme, for the browser chrome (`theme-color`). */
const CANVAS: Record<ResolvedTheme, string> = { dark: "#000000", light: "#f4f4f6" };

const SCRIPT = `(function(){try{var p="dark",s=localStorage.getItem(${JSON.stringify(SETTINGS_STORAGE_KEY)});if(s){var v=JSON.parse(s);if(v&&v.state&&v.state.theme)p=v.state.theme}var t=p==="system"?(matchMedia(${JSON.stringify(LIGHT_QUERY)}).matches?"light":"dark"):p==="light"?"light":"dark";document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;

/**
 * Render inside <head> in the root layout, with `suppressHydrationWarning` on
 * <html>. The type swap stops React warning about a client-rendered script.
 */
export function ThemeScript() {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: SCRIPT }}
    />
  );
}

function subscribeSystem(onChange: () => void) {
  const query = window.matchMedia(LIGHT_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia(LIGHT_QUERY).matches ? "light" : "dark";
}

export function resolveTheme(preference: ThemePreference, system: ResolvedTheme): ResolvedTheme {
  return preference === "system" ? system : preference;
}

/** The theme on screen now. Dark during server rendering. */
export function useResolvedTheme(): ResolvedTheme {
  const preference = useSettings((s) => s.theme);
  const system = useSyncExternalStore(subscribeSystem, systemTheme, () => "dark" as const);
  return resolveTheme(preference, system);
}

export function ThemeSync() {
  const theme = useResolvedTheme();
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", CANVAS[theme]);
  }, [theme]);
  return null;
}
