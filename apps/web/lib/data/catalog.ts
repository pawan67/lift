/**
 * The built-in exercise library (~6,800 rows).
 *
 * Built-ins never cross the wire: every device has the same catalog, keyed by
 * the same ids, and only custom exercises sync. So the web app ships the
 * catalog too, loaded as its own chunk once at boot rather than as part of
 * every page's bundle.
 */

import type { LibraryExercise } from "@lift/shared/exercises";

let catalog: readonly LibraryExercise[] | null = null;
let loading: Promise<readonly LibraryExercise[]> | null = null;

export function loadCatalog(): Promise<readonly LibraryExercise[]> {
  if (catalog) return Promise.resolve(catalog);
  loading ??= import("@lift/shared/exercises").then((module) => {
    catalog = module.EXERCISE_LIBRARY;
    return catalog;
  });
  return loading;
}

/** The catalog once loaded; the app shell waits for it before rendering screens. */
export function getCatalog(): readonly LibraryExercise[] {
  return catalog ?? [];
}
