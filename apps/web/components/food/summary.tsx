/**
 * The day at a glance: a calorie ring and three macro bars, each against its
 * goal when there is one. The same reading as the phone's food tab.
 *
 * The ring's number is what is left, not what was eaten, because "how much is
 * left?" is the question a diary is opened to answer. Over the goal it says
 * "over" in the alarm colour rather than printing a negative.
 */

import { formatCalories, type NutrientValues } from "@lift/shared";

import { cn } from "@/lib/cn";

export type MacroKey = "protein" | "carbs" | "fat";

export const MACROS: readonly { key: MacroKey; label: string }[] = [
  { key: "protein", label: "Protein" },
  { key: "carbs", label: "Carbs" },
  { key: "fat", label: "Fat" },
];

/** One colour per macro, matching the phone: volt for protein, the two warm tones for the rest. */
export const MACRO_TEXT: Record<MacroKey, string> = { protein: "text-volt", carbs: "text-record", fat: "text-warn" };
export const MACRO_BG: Record<MacroKey, string> = { protein: "bg-volt", carbs: "bg-record", fat: "bg-warn" };

export function CalorieRing({ eaten, goal, size = 148 }: { eaten: number; goal: number | undefined; size?: number }) {
  const stroke = 12;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const fraction = goal && goal > 0 ? Math.min(eaten / goal, 1) : eaten > 0 ? 1 : 0;
  const over = !!goal && eaten > goal;
  const remaining = goal ? Math.round(goal - eaten) : null;

  const label = !goal
    ? `${formatCalories(eaten)} calories eaten`
    : remaining! >= 0
      ? `${formatCalories(eaten)} of ${formatCalories(goal)} calories eaten, ${formatCalories(remaining!)} left`
      : `${formatCalories(eaten)} of ${formatCalories(goal)} calories eaten, ${formatCalories(-remaining!)} over`;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-surface-3" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          className={cn("transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none", over ? "stroke-alarm" : "stroke-volt")}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center" aria-hidden>
        <span className={cn("tabular text-[26px] leading-none font-semibold tracking-[-0.02em]", over ? "text-alarm" : "text-fg")}>
          {formatCalories(remaining === null ? eaten : Math.abs(remaining))}
        </span>
        <span className="mt-1 text-xs text-fg-3">{remaining === null ? "kcal eaten" : over ? "kcal over" : "kcal left"}</span>
      </div>
    </div>
  );
}

export function MacroBar({ macro, value, goal }: { macro: { key: MacroKey; label: string }; value: number; goal: number | undefined }) {
  const fraction = goal && goal > 0 ? Math.min(value / goal, 1) : 0;
  const over = !!goal && value > goal * 1.05;
  return (
    <div>
      <div className="flex items-baseline gap-2 text-sm">
        <span className={cn("h-2 w-2 shrink-0 self-center rounded-full", MACRO_BG[macro.key])} aria-hidden />
        <span className="flex-1 text-fg-2">{macro.label}</span>
        <span className={cn("tabular font-semibold", over ? "text-alarm" : "text-fg")}>{Math.round(value)}</span>
        <span className="tabular text-xs whitespace-nowrap text-fg-3">{goal ? `/ ${Math.round(goal)} g` : "g"}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div
          className={cn("h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none", over ? "bg-alarm" : MACRO_BG[macro.key])}
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
    </div>
  );
}

export function DaySummaryPanel({ totals, targets, className }: { totals: NutrientValues; targets: NutrientValues; className?: string }) {
  return (
    <div className={cn("flex items-center gap-6", className)}>
      <CalorieRing eaten={totals.calories ?? 0} goal={targets.calories} />
      <div className="min-w-0 flex-1 space-y-3.5">
        {MACROS.map((macro) => (
          <MacroBar key={macro.key} macro={macro} value={totals[macro.key] ?? 0} goal={targets[macro.key]} />
        ))}
      </div>
    </div>
  );
}

/** "6P · 36C · 7F" as three small coloured figures. */
export function MacroLine({ values, className }: { values: NutrientValues; className?: string }) {
  return (
    <span className={cn("tabular inline-flex items-center gap-2 text-xs text-fg-3", className)}>
      {MACROS.map((macro) => (
        <span key={macro.key} className="inline-flex items-center gap-1">
          <span className={cn("h-1.5 w-1.5 rounded-full", MACRO_BG[macro.key])} aria-hidden />
          {values[macro.key] === undefined ? "–" : Math.round(values[macro.key]!)}
          {macro.key === "protein" ? "P" : macro.key === "carbs" ? "C" : "F"}
        </span>
      ))}
    </span>
  );
}
