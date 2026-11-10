/**
 * Daily goals, and the nutrients the user tracks beyond the built-in list.
 *
 * Macros can be set in grams or as a share of the calorie goal. Grams are what
 * is stored either way, so a split is turned into grams on save, and it needs a
 * calorie goal to be a share of. Switching modes carries the current values
 * across rather than throwing them away. Same rules as the phone's Goals page.
 *
 * Custom nutrients are saved the moment they are added, renamed or removed,
 * independently of the targets above, because they are definitions rather than
 * goals: a nutrient added here is on every food form straight away.
 */

"use client";

import {
  BUILT_IN_NUTRIENTS,
  CORE_NUTRIENT_KEYS,
  KCAL_PER_GRAM,
  macroGramsFromPercent,
  type CustomNutrient,
  type NutrientDefinition,
  type NutrientValues,
} from "@lift/shared";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Pencil, Plus, Trash2, X } from "lucide-react";
import { Collapsible } from "radix-ui";
import { useId, useState } from "react";

import { confirm } from "@/components/ui/alert-dialog";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/empty-state";
import { fieldClass, Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { describeError, nutritionApi } from "@/lib/nutrition/api";
import { nutritionKeys, useNutritionProfile } from "@/lib/nutrition/queries";

import { parseNutrientDraft, toNutrientDraft, type NutrientDraft } from "./nutrient-fields";
import { MACRO_BG, MACROS, type MacroKey } from "./summary";

type MacroMode = "grams" | "percent";

const MODE_OPTIONS = [
  { value: "grams" as const, label: "Grams" },
  { value: "percent" as const, label: "Percent" },
];

/** A common starting split when someone switches to percent with nothing set. */
const DEFAULT_SPLIT: Record<MacroKey, string> = { protein: "30", carbs: "40", fat: "30" };

function numberOf(text: string | undefined): number | null {
  if (!text || text.trim() === "") return null;
  const value = Number(text.replace(",", "."));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

const digits = (text: string) => text.replace(/[^0-9.,]/g, "");

export function GoalsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Goals & nutrients" description="Daily targets, and anything you track beyond the built-in list." size="lg">
      {/* Remounted per open, so the form always starts from what is saved. */}
      {open ? <GoalsForm onDone={onClose} /> : null}
    </Dialog>
  );
}

/** One target: label, a typed number, its unit. */
function TargetRow({ label, unit, value, onChange, dot }: { label: string; unit: string; value: string; onChange: (text: string) => void; dot?: string }) {
  const id = useId();
  return (
    <div className="flex items-center gap-3 py-1.5">
      {dot ? <span className={cn("h-2 w-2 shrink-0 rounded-full", dot)} aria-hidden /> : null}
      <label htmlFor={id} className="flex-1 text-sm text-fg-2">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(digits(event.target.value))}
        inputMode="decimal"
        placeholder="–"
        aria-label={`${label} target in ${unit}`}
        className={fieldClass({ className: "tabular h-8 w-24 px-2.5 text-right" })}
      />
      <span className="w-9 text-xs text-fg-3">{unit}</span>
    </div>
  );
}

function GoalsForm({ onDone }: { onDone: () => void }) {
  const client = useQueryClient();
  const { data: profile, isPending, error, refetch } = useNutritionProfile();

  const [calories, setCalories] = useState("");
  const [mode, setMode] = useState<MacroMode>("grams");
  const [grams, setGrams] = useState<Record<MacroKey, string>>({ protein: "", carbs: "", fat: "" });
  const [percent, setPercent] = useState<Record<MacroKey, string>>(DEFAULT_SPLIT);
  const [others, setOthers] = useState<NutrientDraft>({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [othersOpen, setOthersOpen] = useState(false);

  // Seeded once, during render, so the first paint is already filled. A later
  // refetch (after adding a nutrient) must not wipe targets typed but unsaved.
  if (!loaded && profile) {
    const draft = toNutrientDraft(profile.goals.targets);
    setCalories(draft.calories ?? "");
    setGrams({ protein: draft.protein ?? "", carbs: draft.carbs ?? "", fat: draft.fat ?? "" });
    const rest: NutrientDraft = {};
    for (const [key, value] of Object.entries(draft)) {
      if (!(CORE_NUTRIENT_KEYS as readonly string[]).includes(key)) rest[key] = value;
    }
    setOthers(rest);
    setOthersOpen(Object.keys(rest).length > 0);
    setLoaded(true);
  }

  const calorieGoal = numberOf(calories);
  const percentSum = MACROS.reduce((sum, macro) => sum + (numberOf(percent[macro.key]) ?? 0), 0);
  const percentValid = Math.abs(percentSum - 100) < 0.5;
  const percentGrams =
    calorieGoal && percentValid
      ? macroGramsFromPercent(calorieGoal, {
          protein: numberOf(percent.protein) ?? 0,
          carbs: numberOf(percent.carbs) ?? 0,
          fat: numberOf(percent.fat) ?? 0,
        })
      : null;

  function switchMode(next: MacroMode) {
    if (next === mode) return;
    if (next === "percent") {
      // The current grams become a split, so switching to look loses nothing.
      const kcal = MACROS.map((m) => (numberOf(grams[m.key]) ?? 0) * KCAL_PER_GRAM[m.key]);
      const total = kcal.reduce((a, b) => a + b, 0);
      if (total > 0) {
        const split = kcal.map((k) => Math.round((k / total) * 100));
        // Rounding can leave 99 or 101; the largest share absorbs it.
        split[split.indexOf(Math.max(...split))]! += 100 - split.reduce((a, b) => a + b, 0);
        setPercent({ protein: String(split[0]), carbs: String(split[1]), fat: String(split[2]) });
      }
    } else if (percentGrams) {
      setGrams({ protein: String(percentGrams.protein), carbs: String(percentGrams.carbs), fat: String(percentGrams.fat) });
    }
    setMode(next);
  }

  async function save() {
    if (mode === "percent" && (!percentValid || !calorieGoal)) {
      toast(!calorieGoal ? "Set a calorie goal first: percentages are a share of it." : `Percentages must add up to 100 (now ${Math.round(percentSum)}).`, "error");
      return;
    }
    const targets: NutrientValues = parseNutrientDraft(others);
    if (calorieGoal !== null) targets.calories = calorieGoal;
    const macros =
      mode === "percent" && percentGrams
        ? percentGrams
        : { protein: numberOf(grams.protein), carbs: numberOf(grams.carbs), fat: numberOf(grams.fat) };
    for (const macro of MACROS) {
      const value = macros[macro.key];
      if (value !== null && value !== undefined) targets[macro.key] = value;
    }

    setSaving(true);
    try {
      await nutritionApi.setGoals({ targets });
      await client.invalidateQueries({ queryKey: nutritionKeys.profile });
      toast("Goals saved");
      onDone();
    } catch (failure) {
      toast(describeError(failure), "error");
    } finally {
      setSaving(false);
    }
  }

  if (isPending) {
    return (
      <div className="space-y-3 px-5 pb-5">
        <Skeleton className="h-10" />
        <Skeleton className="h-28" />
        <Skeleton className="h-10" />
      </div>
    );
  }
  if (error || !profile) {
    return (
      <div className="px-5 pb-5 text-sm text-fg-3">
        {describeError(error)}{" "}
        <button type="button" onClick={() => void refetch()} className="font-medium text-fg-2 underline underline-offset-2 hover:text-fg">
          Try again
        </button>
      </div>
    );
  }

  const otherDefinitions = BUILT_IN_NUTRIENTS.filter((n) => !(CORE_NUTRIENT_KEYS as readonly string[]).includes(n.key));
  const otherCount = Object.values(others).filter((text) => text.trim() !== "").length;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="space-y-6 px-5 pb-5">
        <section>
          <h3 className="mb-1 text-[11px] font-semibold tracking-wider text-fg-3 uppercase">Daily calories</h3>
          <TargetRow label="Calories" unit="kcal" value={calories} onChange={setCalories} />
        </section>

        <section>
          <div className="mb-1 flex items-center justify-between gap-3">
            <h3 className="text-[11px] font-semibold tracking-wider text-fg-3 uppercase">Macros</h3>
            <Segmented value={mode} options={MODE_OPTIONS} onChange={switchMode} size="sm" aria-label="Set macros in" />
          </div>
          {MACROS.map((macro) =>
            mode === "grams" ? (
              <TargetRow
                key={macro.key}
                label={macro.label}
                unit="g"
                dot={MACRO_BG[macro.key]}
                value={grams[macro.key]}
                onChange={(text) => setGrams((prev) => ({ ...prev, [macro.key]: text }))}
              />
            ) : (
              <div key={macro.key} className="flex items-center gap-3">
                <div className="flex-1">
                  <TargetRow
                    label={macro.label}
                    unit="%"
                    dot={MACRO_BG[macro.key]}
                    value={percent[macro.key]}
                    onChange={(text) => setPercent((prev) => ({ ...prev, [macro.key]: text }))}
                  />
                </div>
                <span className="tabular w-14 text-right text-xs text-fg-3">{percentGrams ? `${percentGrams[macro.key]} g` : ""}</span>
              </div>
            ),
          )}
          {mode === "percent" ? (
            <p className={cn("tabular mt-1 text-xs", percentValid ? "text-fg-3" : "text-alarm")}>
              {Math.round(percentSum)}% of 100%
              {!calorieGoal ? ". Set a calorie goal to turn these into grams." : ""}
            </p>
          ) : null}
        </section>

        <Collapsible.Root open={othersOpen} onOpenChange={setOthersOpen}>
          <Collapsible.Trigger className="press inline-flex items-center gap-1 rounded-md py-1 text-[11px] font-semibold tracking-wider text-fg-3 uppercase hover:text-fg">
            <ChevronDown size={14} className={cn("transition-transform duration-150", othersOpen ? "rotate-0" : "-rotate-90")} />
            Other nutrients
            {otherCount > 0 && !othersOpen ? <span className="ml-1 font-normal tracking-normal normal-case">{otherCount} set</span> : null}
          </Collapsible.Trigger>
          <Collapsible.Content className="mt-1 grid gap-x-8 sm:grid-cols-2">
            {[...otherDefinitions, ...profile.customNutrients.map(customDefinition)].map((definition) => (
              <TargetRow
                key={definition.key}
                label={definition.label}
                unit={definition.unit}
                value={others[definition.key] ?? ""}
                onChange={(text) => setOthers((prev) => ({ ...prev, [definition.key]: text }))}
              />
            ))}
          </Collapsible.Content>
        </Collapsible.Root>

        <CustomNutrients nutrients={profile.customNutrients} />
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? "Saving…" : "Save goals"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function customDefinition(custom: CustomNutrient): NutrientDefinition {
  return { key: custom.id, label: custom.name, short: custom.name, unit: custom.unit as NutrientDefinition["unit"], group: "custom", decimals: 1 };
}

/** The user's own nutrients: rename, remove, add. Each change is saved at once. */
function CustomNutrients({ nutrients }: { nutrients: CustomNutrient[] }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: nutritionKeys.profile });

  async function add(name: string, unit: string) {
    try {
      await nutritionApi.createNutrient({ name, unit });
      await refresh();
      toast(`${name} added`);
      return true;
    } catch (failure) {
      toast(describeError(failure), "error");
      return false;
    }
  }

  async function rename(nutrient: CustomNutrient, name: string, unit: string) {
    try {
      await nutritionApi.updateNutrient(nutrient.id, { name, unit });
      await refresh();
      setEditing(null);
      return true;
    } catch (failure) {
      toast(describeError(failure), "error");
      return false;
    }
  }

  async function remove(nutrient: CustomNutrient) {
    const ok = await confirm({
      title: `Remove ${nutrient.name}?`,
      body: "It leaves your forms, goals and the diary. Amounts already logged are kept, so adding it back brings them back.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    try {
      await nutritionApi.deleteNutrient(nutrient.id);
      await refresh();
      toast(`${nutrient.name} removed`);
    } catch (failure) {
      toast(describeError(failure), "error");
    }
  }

  return (
    <section>
      <h3 className="text-[11px] font-semibold tracking-wider text-fg-3 uppercase">Your nutrients</h3>
      <p className="mt-1 mb-2 text-xs text-fg-3">
        Track anything the built-in list does not have, like caffeine or omega-3. They appear on every food form, in the diary and in AI estimates.
      </p>
      {nutrients.length > 0 ? (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {nutrients.map((nutrient) =>
            editing === nutrient.id ? (
              <li key={nutrient.id} className="px-3 py-2">
                <NutrientForm initial={nutrient} submitLabel="Save" onSubmit={(name, unit) => rename(nutrient, name, unit)} onCancel={() => setEditing(null)} />
              </li>
            ) : (
              <li key={nutrient.id} className="flex items-center gap-2 py-1.5 pr-1.5 pl-3">
                <span className="flex-1 truncate text-sm text-fg">{nutrient.name}</span>
                <span className="text-xs text-fg-3">{nutrient.unit}</span>
                <IconButton size="sm" label={`Rename ${nutrient.name}`} onClick={() => setEditing(nutrient.id)}>
                  <Pencil size={15} />
                </IconButton>
                <IconButton size="sm" tone="danger" label={`Remove ${nutrient.name}`} onClick={() => void remove(nutrient)}>
                  <Trash2 size={15} />
                </IconButton>
              </li>
            ),
          )}
        </ul>
      ) : null}
      <div className="mt-3">
        <NutrientForm submitLabel="Add nutrient" onSubmit={add} />
      </div>
    </section>
  );
}

/**
 * Name and unit. Not a nested `<form>`: it sits inside the goals form, and a
 * nested form is invalid HTML whose Enter key would submit the goals instead.
 */
function NutrientForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: CustomNutrient;
  submitLabel: string;
  onSubmit: (name: string, unit: string) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [unit, setUnit] = useState(initial?.unit ?? "");
  const [busy, setBusy] = useState(false);
  const ready = name.trim().length > 0 && unit.trim().length > 0 && !busy;

  async function submit() {
    if (!ready) return;
    setBusy(true);
    const ok = await onSubmit(name.trim(), unit.trim());
    setBusy(false);
    if (ok && !initial) {
      setName("");
      setUnit("");
    }
  }

  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void submit();
    }
    if (event.key === "Escape" && onCancel) {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={onKey} placeholder="Caffeine" maxLength={40} aria-label="Nutrient name" className="h-9 flex-1" />
      <Input value={unit} onChange={(e) => setUnit(e.target.value)} onKeyDown={onKey} placeholder="mg" maxLength={12} aria-label="Unit" className="h-9 w-20" />
      {initial ? (
        <>
          <IconButton size="sm" label="Save" onClick={() => void submit()} disabled={!ready}>
            <Check size={16} />
          </IconButton>
          <IconButton size="sm" label="Cancel" onClick={onCancel}>
            <X size={16} />
          </IconButton>
        </>
      ) : (
        <Button size="md" onClick={() => void submit()} disabled={!ready}>
          <Plus size={15} /> {submitLabel}
        </Button>
      )}
    </div>
  );
}
