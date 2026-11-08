/**
 * What the body screen says about the log, ported from the phone
 * (`apps/mobile/src/features/measurements/insights.ts`) so both apps print the
 * same figures from the same readings. Works on synced rows, whose dates are
 * epoch milliseconds rather than `Date`s.
 */

import {
  BMI_BAND_LABELS,
  MEASUREMENT_PAIRS,
  WAIST_BAND_LABELS,
  bmiBand,
  bodyMassIndex,
  changeOverWindow,
  daysSince,
  fatMassKg,
  formatMeasurementDelta,
  formatMeasurementValue,
  formatWeight,
  leanMassKg,
  navyBodyFatPercent,
  summarizeMeasurements,
  symmetry,
  trimZeros,
  waistBand,
  waistToHeightRatio,
  waistToHipRatio,
  type MeasurementKind,
  type MeasurementPoint,
  type MeasurementStats,
  type MeasurementUnitPreferences,
  type Sex,
} from "@lift/shared";

import type { BodyMeasurementRow } from "@/lib/data/types";

/** Points kept for a row's sparkline: enough to show a direction, not a history. */
const SPARK_POINTS = 16;

/** A reading older than this is flagged: a month-old waist is not today's waist. */
export const STALE_AFTER_DAYS = 30;

export function toPoints(rows: readonly BodyMeasurementRow[]): MeasurementPoint[] {
  return rows.map((row) => ({ at: row.measuredAt, value: row.value }));
}

export interface KindSummary {
  kind: MeasurementKind;
  latest: BodyMeasurementRow;
  stats: MeasurementStats;
  /** Change since the reading before the latest. */
  sinceLast: number | null;
  /** Change over the last 30 days, against the reading in force at the start. */
  sinceMonth: number | null;
  spark: number[];
  daysAgo: number;
}

/** `rows` must be oldest first, which is how the model holds them. */
export function summarizeKinds(
  log: ReadonlyMap<MeasurementKind, readonly BodyMeasurementRow[]>,
  now: number,
): Map<MeasurementKind, KindSummary> {
  const summaries = new Map<MeasurementKind, KindSummary>();

  for (const [kind, rows] of log) {
    if (rows.length === 0) continue;
    const points = toPoints(rows);
    const stats = summarizeMeasurements(points);
    if (!stats) continue;

    const latest = rows[rows.length - 1]!;
    summaries.set(kind, {
      kind,
      latest,
      stats,
      sinceLast: stats.previous ? stats.latest.value - stats.previous.value : null,
      sinceMonth: changeOverWindow(points, 30, now)?.delta ?? null,
      spark: points.slice(-SPARK_POINTS).map((point) => point.value),
      daysAgo: daysSince(latest.measuredAt, now),
    });
  }

  return summaries;
}

// ---------------------------------------------------------------------------
// Derived body figures
// ---------------------------------------------------------------------------

export interface BodyFigure {
  key: "body_fat" | "lean_mass" | "bmi" | "waist_height" | "waist_hip";
  label: string;
  value: string;
  detail: string;
  /** Worked out rather than measured; drawn quieter than a logged figure. */
  estimated: boolean;
  tone?: "good" | "caution" | "neutral";
}

export interface BodyFigureInput {
  summaries: Map<MeasurementKind, KindSummary>;
  prefs: MeasurementUnitPreferences;
  heightCm: number | null;
  sex: Sex | null;
}

function estimateBodyFat({ summaries, heightCm, sex }: BodyFigureInput): number | null {
  if (heightCm == null || sex == null) return null;
  const neckCm = summaries.get("neck")?.latest.value;
  const waistCm = summaries.get("waist")?.latest.value;
  if (neckCm == null || waistCm == null) return null;

  return navyBodyFatPercent({
    sex,
    heightCm,
    neckCm,
    waistCm,
    hipCm: summaries.get("hips")?.latest.value ?? null,
  });
}

export function buildBodyFigures(input: BodyFigureInput): BodyFigure[] {
  const { summaries, prefs, heightCm } = input;
  const figures: BodyFigure[] = [];

  const weightKg = summaries.get("bodyweight")?.latest.value ?? null;
  const logged = summaries.get("body_fat")?.latest.value ?? null;
  const estimate = estimateBodyFat(input);
  // A logged reading (a scale, calipers, a DEXA) beats the tape estimate.
  const bodyFat = logged ?? estimate;

  if (bodyFat != null) {
    figures.push({
      key: "body_fat",
      label: "Body fat",
      value: formatMeasurementValue("body_fat", bodyFat, prefs),
      detail: logged != null ? "As logged" : "Navy method, from your neck, waist and height",
      estimated: logged == null,
    });

    if (weightKg != null) {
      figures.push({
        key: "lean_mass",
        label: "Lean mass",
        value: formatWeight(leanMassKg(weightKg, bodyFat), prefs.weightUnit, { decimals: 1 }),
        detail: `${formatWeight(fatMassKg(weightKg, bodyFat), prefs.weightUnit, { decimals: 1 })} of fat mass`,
        estimated: true,
      });
    }
  }

  const waistCm = summaries.get("waist")?.latest.value ?? null;
  if (waistCm != null) {
    const ratio = waistToHeightRatio(waistCm, heightCm);
    if (ratio != null) {
      const band = waistBand(ratio);
      figures.push({
        key: "waist_height",
        label: "Waist-to-height",
        value: ratio.toFixed(2),
        detail: WAIST_BAND_LABELS[band],
        estimated: true,
        tone: band === "healthy" ? "good" : band === "low" ? "neutral" : "caution",
      });
    }

    const hipCm = summaries.get("hips")?.latest.value ?? null;
    const hipRatio = hipCm != null ? waistToHipRatio(waistCm, hipCm) : null;
    if (hipRatio != null) {
      figures.push({
        key: "waist_hip",
        label: "Waist-to-hip",
        value: hipRatio.toFixed(2),
        detail: "Waist over hips, both as logged",
        estimated: true,
      });
    }
  }

  if (weightKg != null) {
    const bmi = bodyMassIndex(weightKg, heightCm);
    if (bmi != null) {
      const band = bmiBand(bmi);
      figures.push({
        key: "bmi",
        label: "BMI",
        value: bmi.toFixed(1),
        detail: `${BMI_BAND_LABELS[band]} · weight against height only`,
        estimated: true,
        tone: band === "healthy" ? "good" : "neutral",
      });
    }
  }

  return figures;
}

export type MissingInputHint =
  | { message: string; action: "settings"; label: string }
  | { message: string; action: "measure"; kind: MeasurementKind };

/** The single most useful thing still missing, so the figures above can fill in. */
export function missingInputHint(input: BodyFigureInput): MissingInputHint | null {
  const { summaries, heightCm, sex } = input;
  if (summaries.size === 0) return null;

  if (heightCm == null) {
    return { message: "BMI and waist-to-height need your height.", action: "settings", label: "Add it in Settings" };
  }
  if (!summaries.has("waist")) {
    return {
      message: "Waist-to-height needs a waist reading.",
      action: "measure",
      kind: "waist",
    };
  }
  if (sex == null) {
    return { message: "The body-fat estimate needs your sex.", action: "settings", label: "Set it in Settings" };
  }
  if (!summaries.has("neck")) {
    return { message: "The body-fat estimate needs a neck reading.", action: "measure", kind: "neck" };
  }
  if (sex === "female" && !summaries.has("hips")) {
    return { message: "The body-fat estimate for women also needs hips.", action: "measure", kind: "hips" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Symmetry
// ---------------------------------------------------------------------------

/**
 * Below this the gap is the tape, not the body: a centimetre of placement on a
 * 38 cm arm is already 2.6%.
 */
const SYMMETRY_THRESHOLD_PERCENT = 3;

export interface SymmetryNote {
  label: string;
  summary: string;
  notable: boolean;
}

export function buildSymmetryNotes(
  summaries: Map<MeasurementKind, KindSummary>,
  prefs: MeasurementUnitPreferences,
): SymmetryNote[] {
  const notes: SymmetryNote[] = [];

  for (const pair of MEASUREMENT_PAIRS) {
    const left = summaries.get(pair.left)?.latest.value;
    const right = summaries.get(pair.right)?.latest.value;
    if (left == null || right == null) continue;

    const result = symmetry(left, right);
    if (!result) continue;

    if (result.larger === "even") {
      notes.push({ label: pair.label, summary: "Even", notable: false });
      continue;
    }

    const side = result.larger === "left" ? "Left" : "Right";
    const gap = formatMeasurementValue(pair.left, result.difference, prefs);
    notes.push({
      label: pair.label,
      summary: `${side} +${gap} · ${trimZeros(result.percent.toFixed(1))}%`,
      notable: result.percent >= SYMMETRY_THRESHOLD_PERCENT,
    });
  }

  return notes;
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

export function describeRecency(days: number): string {
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

/** "−0.3 kg per week", or null when there is too little history to call it a rate. */
export function describeRate(
  kind: MeasurementKind,
  changePerWeek: number | null,
  count: number,
  spanMs: number,
  prefs: MeasurementUnitPreferences,
): string | null {
  if (changePerWeek == null || count < 3) return null;
  if (spanMs < 7 * 86_400_000) return null;
  return `${formatMeasurementDelta(kind, changePerWeek, prefs)} per week`;
}
