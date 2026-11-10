/**
 * What to offer before the user has searched for anything.
 *
 * Most of a food diary is the same few foods at the same meals: oats at
 * breakfast, the office lunch, tea in the afternoon. The recents list already
 * carries how often each food was logged at each meal, so these helpers turn
 * that into "usually at breakfast" suggestions, a guess at which meal a fresh
 * add is for, and an instant local filter over recents while the server search
 * is still in flight. Shared so the phone and the web app suggest the same
 * things.
 */

import type { Meal, RecentItem } from './types.ts';

/** Identifies one recent the way the server groups them: name (any case) and serving. */
export function recentKey(item: { name: string; servingLabel: string }): string {
  return `${item.name.trim().toLowerCase()}|${item.servingLabel}`;
}

/**
 * Recents usually eaten at `meal`, most habitual first.
 *
 * "Usually" is logged there at least twice, or once when that is at least half
 * of every time it was logged, so a food eaten once at lunch is offered at lunch
 * but not one eaten forty times at dinner and once at lunch. `exclude` drops
 * foods already in the meal, since suggesting what is already there is noise.
 */
export function usualAt(
  recents: readonly RecentItem[],
  meal: Meal,
  options: { limit?: number; exclude?: ReadonlySet<string> } = {},
): RecentItem[] {
  const { limit = 6, exclude } = options;
  return recents
    .filter((item) => {
      const count = item.meals?.[meal] ?? 0;
      if (count === 0) return false;
      if (exclude?.has(recentKey(item))) return false;
      return count >= 2 || count / Math.max(item.timesLogged, 1) >= 0.5;
    })
    .sort((a, b) => (b.meals?.[meal] ?? 0) - (a.meals?.[meal] ?? 0) || b.lastLoggedAt - a.lastLoggedAt)
    .slice(0, limit);
}

/**
 * The meal a fresh add most likely belongs to, from the time of day. Used only
 * when nothing else says which meal: every meal's own add button still names
 * its meal.
 */
export function mealForTime(at: Date): Meal {
  const minutes = at.getHours() * 60 + at.getMinutes();
  if (minutes >= 4 * 60 && minutes < 10 * 60 + 30) return 'breakfast';
  if (minutes >= 11 * 60 + 30 && minutes < 15 * 60) return 'lunch';
  if (minutes >= 18 * 60 && minutes < 22 * 60 + 30) return 'dinner';
  return 'snacks';
}

/**
 * Recents whose name or brand contains every word typed, in recency order.
 * Instant and offline, so something useful is on screen before the server's
 * search answers, including foods that only ever existed as a quick add or an
 * AI estimate and so are not in "My foods".
 */
export function matchRecents(recents: readonly RecentItem[], query: string, limit = 5): RecentItem[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return recents
    .filter((item) => {
      const haystack = `${item.name} ${item.brand ?? ''}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    })
    .slice(0, limit);
}
