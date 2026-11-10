/**
 * Hand-off between food screens.
 *
 * A route parameter is a string, and what moves between "pick a food" and
 * "choose how much" is a whole food with its servings, or an AI estimate with
 * several items. Serialising those into a URL is fragile and leaks figures
 * into navigation state, so the picking screen puts the object here and the
 * next screen reads it. One slot each, overwritten on every pick.
 */

import type { EntryItem, Food, FoodCandidate, FoodEntry, Meal } from '@lift/shared';
import { create } from 'zustand';

/** Where a pick will be logged. */
export interface LogTarget {
  date: string;
  meal: Meal;
}

/**
 * What the portion screen is editing:
 * - a food (saved or a search result) about to be logged,
 * - an existing diary entry,
 * - or a template item being added or edited (the template editor takes the result back).
 */
export type PortionDraft =
  | { kind: 'food'; food: Food | FoodCandidate; target: LogTarget; quantity?: number; servingId?: string }
  | { kind: 'entry'; entry: FoodEntry }
  | { kind: 'template-item'; food: Food | FoodCandidate | null; item: EntryItem | null; index: number | null };

interface DraftState {
  portion: PortionDraft | null;
  setPortion: (draft: PortionDraft | null) => void;
  /**
   * A template item the portion screen produced, for the template editor to
   * pick up when it regains focus. `index` null means "append".
   */
  templateResult: { item: EntryItem; index: number | null } | null;
  setTemplateResult: (result: { item: EntryItem; index: number | null } | null) => void;
  /**
   * The last thing logged from the add flow, so the add screen can say so when
   * the portion screen returns to it. `at` makes a second add of the same food
   * a new event.
   */
  lastAdded: { name: string; at: number } | null;
  noteAdded: (name: string) => void;
}

export const useFoodDraft = create<DraftState>((set) => ({
  portion: null,
  setPortion: (portion) => set({ portion }),
  templateResult: null,
  setTemplateResult: (templateResult) => set({ templateResult }),
  lastAdded: null,
  noteAdded: (name) => set({ lastAdded: { name, at: Date.now() } }),
}));
