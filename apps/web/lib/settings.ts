/**
 * Display preferences for this browser.
 *
 * The phone keeps its settings in a local-only table that never syncs, so the
 * web app has its own. Storage is canonical (kg, km, cm); these only change how
 * numbers are shown and entered.
 */

import type {
  DistanceUnit,
  MeasurementUnit,
  OneRepMaxFormula,
  Sex,
  TrainingLevel,
  WeightUnit,
} from "@lift/shared";
import { create } from "zustand";
import { persist } from "zustand/middleware";

/** `system` follows the operating system's light or dark setting. */
export type ThemePreference = "system" | "light" | "dark";

/** Where `persist` keeps these; the pre-paint theme script reads it too. */
export const SETTINGS_STORAGE_KEY = "lift-web-settings";

export interface Settings {
  /** Appearance. Dark by default: the AMOLED palette is the app's own look. */
  theme: ThemePreference;
  weightUnit: WeightUnit;
  distanceUnit: DistanceUnit;
  measurementUnit: MeasurementUnit;
  /** 0 Sunday, 1 Monday. */
  firstDayOfWeek: 0 | 1;
  oneRepMaxFormula: OneRepMaxFormula;
  trainingLevel: TrainingLevel;
  heightCm: number | null;
  sex: Sex | null;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  weightUnit: "kg",
  distanceUnit: "km",
  measurementUnit: "cm",
  firstDayOfWeek: 1,
  oneRepMaxFormula: "brzycki",
  trainingLevel: "intermediate",
  heightCm: null,
  sex: null,
};

interface SettingsStore extends Settings {
  update: (patch: Partial<Settings>) => void;
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      update: (patch) => set(patch),
    }),
    { name: SETTINGS_STORAGE_KEY, version: 1 },
  ),
);
