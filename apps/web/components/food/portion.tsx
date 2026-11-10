/**
 * How much: the amount step between choosing a food and logging it.
 *
 * `PortionEditor` is the step itself, shared by three callers: the add dialog
 * (a food about to be logged or picked for a template), `EntryDialog` (a diary
 * entry being changed) and `EditItemDialog` (a template item).
 *
 * It shows the calories as a ring split by macro, the meal and the time it was
 * eaten, the serving size and the number of servings. Sizes are the food's
 * own plus 100 g and 1 g whenever a weight is known (see `servingOptions`), and
 * any size can be corrected by hand, an AI estimate's included, or a new one
 * added; figures scale by weight. Every figure follows the amount as it
 * changes, so the cost of a second helping is visible before it is logged.
 * Same behaviour as the phone's amount screen.
 */

"use client";

import {
  MEALS,
  MEAL_LABELS,
  convertQuantity,
  formatCalories,
  formatNutrientValue,
  formatQuantity,
  isGramServing,
  macroEnergySplit,
  nutrientDefinitions,
  scaleNutrients,
  servingAt,
  servingOptions,
  splitServingLabel,
  withGrams,
  type CustomNutrient,
  type EntryItem,
  type Food,
  type FoodCandidate,
  type FoodEntry,
  type Meal,
  type NutrientValues,
  type Serving,
  type ServingSize,
} from "@lift/shared";
import { ChevronDown, Minus, PenLine, Plus, Sparkles, Star, Trash2 } from "lucide-react";
import { Collapsible } from "radix-ui";
import { useMemo, useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Dialog } from "@/components/ui/dialog";
import { fieldClass } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { TimeField } from "@/components/ui/time-field";
import { cn } from "@/lib/cn";

import { NutrientFields, parseNutrientDraft, toNutrientDraft, type NutrientDraft } from "./nutrient-fields";
import { MACROS, MACRO_BG, type MacroKey } from "./summary";

export const SOURCE_LABELS: Record<string, string> = {
  usda: "USDA",
  openfoodfacts: "OpenFoodFacts",
  ai: "AI estimate",
  custom: "Your food",
};

/** What the editor works on, whatever the caller had: a food, an entry or a template item. */
export interface PortionSubject {
  name: string;
  brand: string | null;
  source: Food["source"];
  servings: Serving[];
  /** The food behind it, when there is one; drives the favourite star. */
  food: Food | FoodCandidate | null;
  foodId: string | null;
  initialServingId: string;
  initialQuantity: number;
}

export function subjectFromFood(food: Food | FoodCandidate, quantity = 1): PortionSubject {
  return {
    name: food.name,
    brand: food.brand,
    source: food.source,
    servings: food.servings,
    food,
    foodId: food.id,
    initialServingId: food.servings[0]!.id,
    initialQuantity: quantity,
  };
}

/** An entry or template item: one serving, the one it was logged at. */
export function subjectFromItem(item: EntryItem | FoodEntry): PortionSubject {
  return {
    name: item.name,
    brand: item.brand,
    source: item.source,
    servings: [{ id: "item", label: item.servingLabel, grams: item.servingGrams, nutrients: item.nutrients }],
    food: null,
    foodId: item.foodId,
    initialServingId: "item",
    initialQuantity: item.quantity,
  };
}

const QUICK_AMOUNTS = [0.5, 1, 1.5, 2];
const QUICK_GRAMS = [50, 100, 150, 200];

/** Macro colours as CSS variables, for SVG strokes: the same tokens as `MACRO_BG`. */
const MACRO_STROKE: Record<MacroKey, string> = { protein: "var(--volt)", carbs: "var(--record)", fat: "var(--warn)" };

/**
 * Calories as a ring split by where they come from: protein, carbs and fat by
 * their share of energy. Grey when the food has no macros to split.
 */
export function MacroRing({ values, size = 120 }: { values: NutrientValues; size?: number }) {
  const stroke = 12;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const split = macroEnergySplit(values);
  // A hair of gap between segments, so three touching colours still read as three.
  const gap = split ? Math.min(3, circumference * 0.01) : 0;
  let offset = 0;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-surface-3" />
        {split
          ? MACROS.map((macro) => {
              const length = split[macro.key] * circumference;
              const dash = Math.max(length - gap, 0);
              const segment = (
                <circle
                  key={macro.key}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  strokeWidth={stroke}
                  stroke={MACRO_STROKE[macro.key]}
                  strokeDasharray={`${dash} ${circumference - dash}`}
                  strokeDashoffset={-offset}
                  className="transition-[stroke-dasharray,stroke-dashoffset] duration-300 ease-out"
                />
              );
              offset += length;
              return segment;
            })
          : null}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="tabular text-[26px] leading-none font-semibold tracking-[-0.02em] text-fg">{formatCalories(values.calories)}</span>
        <span className="mt-1 text-xs text-fg-3">kcal</span>
      </div>
    </div>
  );
}

/** The ring and a legend: grams of each macro and its share of the calories. */
function MacroCard({ values }: { values: NutrientValues }) {
  const split = macroEnergySplit(values);
  return (
    <div className="flex items-center gap-6 rounded-xl border border-line bg-surface-2 px-5 py-4">
      <MacroRing values={values} />
      <ul className="flex-1 space-y-2.5" aria-label="Macros">
        {MACROS.map((macro) => (
          <li key={macro.key} className="flex items-center gap-2.5">
            <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", MACRO_BG[macro.key])} aria-hidden />
            <span className="flex-1 text-sm text-fg-2">{macro.label}</span>
            <span className="tabular text-sm font-semibold text-fg">
              {values[macro.key] === undefined ? "–" : formatNutrientValue(macro.key, values[macro.key]!)}
              <span className="ml-0.5 text-xs font-normal text-fg-3">g</span>
            </span>
            <span className="tabular w-10 text-right text-xs text-fg-3">{split ? `${Math.round(split[macro.key] * 100)}%` : ""}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A serving size's name and weight, typed. Used to correct the size in use
 * (the AI's guess included) and to add one of the user's own.
 */
export function SizeForm({
  initial,
  submitLabel,
  needsGrams,
  onSubmit,
  onCancel,
}: {
  initial: ServingSize;
  submitLabel: string;
  /** A new size is only worth anything with a weight to scale the figures by. */
  needsGrams: boolean;
  onSubmit: (size: ServingSize) => void;
  onCancel: () => void;
}) {
  const parts = splitServingLabel(initial.label);
  const [name, setName] = useState(parts.name);
  const [gramsText, setGramsText] = useState(initial.grams ? formatQuantity(initial.grams) : parts.grams ? formatQuantity(parts.grams) : "");
  const grams = Number(gramsText.replace(",", "."));
  const gramsValid = gramsText.trim() !== "" && Number.isFinite(grams) && grams > 0 && grams <= 100_000;
  const valid = (name.trim() !== "" || gramsValid) && (gramsValid || (!needsGrams && gramsText.trim() === ""));

  function submit() {
    if (!valid) return;
    const weight = gramsValid ? grams : null;
    onSubmit({ label: withGrams(name.trim() || (weight ? "" : "1 serving"), weight), grams: weight });
  }

  return (
    <div
      className="space-y-3 rounded-lg border border-line bg-surface-2 p-3"
      onKeyDown={(event) => {
        // Enter here belongs to this form, not to the dialog's submit.
        if (event.key === "Enter") {
          event.preventDefault();
          submit();
        }
      }}
    >
      <div className="grid grid-cols-[1fr_7rem] gap-2">
        <label className="space-y-1">
          <span className="text-xs text-fg-3">Name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="1 large egg"
            maxLength={60}
            className={fieldClass({ className: "h-9 px-3" })}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-fg-3">Weight</span>
          <span className="relative block">
            <input
              value={gramsText}
              onChange={(event) => setGramsText(event.target.value.replace(/[^0-9.,]/g, ""))}
              inputMode="decimal"
              placeholder={needsGrams ? "50" : "Optional"}
              aria-label="Weight in grams"
              className={fieldClass({ className: "tabular h-9 pr-7 pl-3" })}
            />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-fg-3">g</span>
          </span>
        </label>
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" disabled={!valid} onClick={submit}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

export function PortionEditor({
  subject,
  customNutrients,
  meal,
  onMealChange,
  time,
  onTimeChange,
  submitLabel,
  onSubmit,
  secondary,
  favorite,
}: {
  subject: PortionSubject;
  customNutrients: readonly CustomNutrient[];
  /** Shown as a meal picker when set. */
  meal?: Meal;
  onMealChange?: (meal: Meal) => void;
  /** When it was eaten, `HH:mm` or null. Shown as a time field when `onTimeChange` is set. */
  time?: string | null;
  onTimeChange?: (time: string | null) => void;
  submitLabel: (meal: Meal | undefined) => string;
  /** Throws to stay open; the message is shown under the button. */
  onSubmit: (item: EntryItem) => Promise<void> | void;
  /** Left of the submit button: back, delete. */
  secondary?: ReactNode;
  favorite?: { on: boolean; toggle: () => void };
}) {
  // The food's own servings, plus any size corrected or added here. Every other
  // size on offer (100 g, 1 g) is worked out from these.
  const [own, setOwn] = useState<Serving[]>(subject.servings);
  const options = useMemo(() => servingOptions(own), [own]);
  const [servingId, setServingId] = useState(subject.initialServingId);
  const serving = options.find((s) => s.id === servingId) ?? options[0]!;
  const [sizeForm, setSizeForm] = useState<"edit" | "add" | null>(null);
  const [amountText, setAmountText] = useState(formatQuantity(subject.initialQuantity));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<NutrientDraft>(() => toNutrientDraft(serving.nutrients));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const grams = isGramServing(serving);
  const typed = Number(amountText.replace(",", "."));
  const valid = amountText.trim() !== "" && Number.isFinite(typed) && typed > 0;
  const quantity = valid ? typed : 0;
  const perServing = editing ? parseNutrientDraft(draft) : serving.nutrients;
  const totals = scaleNutrients(perServing, quantity);
  const totalGrams = serving.grams ? quantity * serving.grams : null;
  const definitions = nutrientDefinitions(customNutrients).filter((d) => totals[d.key] !== undefined && !["calories", "protein", "carbs", "fat"].includes(d.key));
  const weightKnown = options.some((option) => option.grams);

  function select(next: Serving) {
    // Keep the weight eaten across a size change when both know it, so 2 eggs
    // switched to "1 g" reads 100.
    if (valid) setAmountText(formatQuantity(convertQuantity(typed, serving, next)));
    setServingId(next.id);
    setDraft(toNutrientDraft(next.nutrients));
    setSizeForm(null);
  }

  /** A size corrected by hand. Figures scale with the weight when both weights are known. */
  function editSize(size: ServingSize) {
    const base = editing ? { ...serving, nutrients: perServing } : serving;
    const isOwn = own.some((s) => s.id === serving.id);
    const next = servingAt(base, size, isOwn ? serving.id : `custom:${own.length}`);
    setOwn((list) => (isOwn ? list.map((s) => (s.id === serving.id ? next : s)) : [...list, next]));
    setServingId(next.id);
    setDraft(toNutrientDraft(next.nutrients));
    setSizeForm(null);
  }

  /** A new size, worked out by weight from one whose weight is known. */
  function addSize(size: ServingSize) {
    const current = editing ? { ...serving, nutrients: perServing } : serving;
    const base = current.grams ? current : options.find((option) => option.grams)!;
    const next = servingAt(base, size, `custom:${own.length}`);
    setOwn((list) => [...list, next]);
    select(next);
  }

  function step(direction: 1 | -1) {
    const base = valid ? typed : 0;
    const size = grams ? (base >= 100 ? 25 : 10) : 0.5;
    setAmountText(formatQuantity(Math.max(size, Math.round((base + direction * size) / size) * size)));
  }

  async function submit() {
    if (!valid) return setError("Enter an amount.");
    if (perServing.calories === undefined) return setError("Calories are needed.");
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        foodId: subject.foodId,
        name: subject.name,
        brand: subject.brand,
        servingLabel: serving.label,
        servingGrams: serving.grams,
        nutrients: perServing,
        source: subject.source,
        quantity,
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const sectionTitle = "mb-2 text-[11px] font-semibold tracking-wider text-fg-3 uppercase";

  return (
    <form
      className="flex min-h-full flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="space-y-6 px-5 pt-1 pb-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-xl font-semibold tracking-tight text-fg">{subject.name}</h3>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-fg-3">
              {subject.brand ? <span>{subject.brand}</span> : null}
              <Badge tone={subject.source === "ai" ? "volt" : "neutral"}>
                {subject.source === "ai" ? <Sparkles size={11} /> : null}
                {SOURCE_LABELS[subject.source] ?? subject.source}
              </Badge>
            </div>
          </div>
          {favorite ? (
            <IconButton label={favorite.on ? "Remove from favourites" : "Add to favourites"} onClick={favorite.toggle}>
              <Star size={18} className={favorite.on ? "fill-record text-record" : ""} />
            </IconButton>
          ) : null}
        </div>

        {/* Figures for the amount as typed */}
        <MacroCard values={totals} />

        {meal && onMealChange ? (
          <section>
            <h4 className={sectionTitle}>Meal</h4>
            <Segmented value={meal} onChange={onMealChange} options={MEALS.map((m) => ({ value: m, label: MEAL_LABELS[m] }))} aria-label="Meal" />
          </section>
        ) : null}

        {onTimeChange ? (
          <section>
            <h4 className={sectionTitle}>Time eaten</h4>
            <TimeField value={time ?? null} onChange={onTimeChange} aria-label="Time eaten" />
          </section>
        ) : null}

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-[11px] font-semibold tracking-wider text-fg-3 uppercase">Serving size</h4>
            {sizeForm === null ? (
              <button type="button" onClick={() => setSizeForm("edit")} className="press inline-flex items-center gap-1 text-[13px] font-medium text-volt hover:underline">
                <PenLine size={13} /> Edit size
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {options.map((option) => (
              <Chip key={option.id} selected={option.id === serving.id} onClick={() => (option.id === serving.id ? undefined : select(option))}>
                {option.label}
              </Chip>
            ))}
            {weightKnown ? (
              <Chip selected={sizeForm === "add"} onClick={() => setSizeForm((open) => (open === "add" ? null : "add"))}>
                <Plus size={13} /> Custom size
              </Chip>
            ) : null}
          </div>
          {sizeForm ? (
            <div className="mt-3">
              <SizeForm
                key={sizeForm + serving.id}
                initial={sizeForm === "edit" ? { label: serving.label, grams: serving.grams } : { label: "", grams: null }}
                submitLabel={sizeForm === "edit" ? "Update size" : "Add size"}
                needsGrams={sizeForm === "add"}
                onSubmit={sizeForm === "edit" ? editSize : addSize}
                onCancel={() => setSizeForm(null)}
              />
              {sizeForm === "edit" && serving.grams ? (
                <p className="mt-1.5 text-xs text-fg-3">Changing the weight scales the figures with it.</p>
              ) : null}
            </div>
          ) : null}
        </section>

        <section>
          <h4 className={sectionTitle}>{grams ? "Amount in grams" : "Number of servings"}</h4>
          <div className="flex items-center gap-2">
            <IconButton label="Less" onClick={() => step(-1)} className="h-11 w-11 border border-line bg-surface">
              <Minus size={18} />
            </IconButton>
            <label className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line bg-surface-2 focus-within:border-volt/60 focus-within:shadow-[0_0_0_3px_var(--ring)]">
              <input
                value={amountText}
                onChange={(event) => setAmountText(event.target.value.replace(/[^0-9.,]/g, ""))}
                inputMode="decimal"
                data-autofocus
                aria-label={grams ? "Amount in grams" : "Number of servings"}
                className="tabular w-24 bg-transparent text-right text-xl font-semibold text-fg outline-none"
              />
              <span className="w-24 truncate text-sm text-fg-3">{grams ? "g" : `× ${serving.label}`}</span>
            </label>
            <IconButton label="More" onClick={() => step(1)} className="h-11 w-11 border border-line bg-surface">
              <Plus size={18} />
            </IconButton>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {(grams ? QUICK_GRAMS : QUICK_AMOUNTS).map((amount) => (
              <Chip key={amount} selected={valid && typed === amount} onClick={() => setAmountText(formatQuantity(amount))}>
                {grams ? `${amount} g` : amount === 0.5 ? "½" : amount === 1.5 ? "1½" : String(amount)}
              </Chip>
            ))}
            {totalGrams !== null && !grams ? <span className="tabular ml-auto text-xs text-fg-3">= {formatQuantity(Math.round(totalGrams * 10) / 10)} g</span> : null}
          </div>
        </section>

        <Collapsible.Root>
          <div className="flex items-center justify-between">
            <Collapsible.Trigger className="group press inline-flex items-center gap-1 text-[13px] font-medium text-fg-2 hover:text-fg">
              All nutrients ({definitions.length + 4})
              <ChevronDown size={15} className="transition-transform duration-150 group-data-[state=open]:rotate-180" />
            </Collapsible.Trigger>
            <button type="button" onClick={() => setEditing((on) => !on)} className="press text-[13px] font-medium text-volt hover:underline">
              {editing ? "Done correcting" : "Correct figures"}
            </button>
          </div>
          <Collapsible.Content className="mt-2">
            <ul className="divide-y divide-line rounded-lg border border-line">
              {definitions.map((definition) => (
                <li key={definition.key} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span className="text-fg-2">{definition.label}</span>
                  <span className="tabular font-medium text-fg">
                    {formatNutrientValue(definition.key, totals[definition.key]!, customNutrients)} <span className="text-xs font-normal text-fg-3">{definition.unit}</span>
                  </span>
                </li>
              ))}
              {definitions.length === 0 ? <li className="px-4 py-2 text-sm text-fg-3">Only calories and macros are known for this food.</li> : null}
            </ul>
          </Collapsible.Content>
        </Collapsible.Root>

        {editing ? (
          <section className="space-y-2">
            <p className="text-xs text-fg-3">Per one {serving.label}. Changes apply here only, not to the saved food.</p>
            <NutrientFields value={draft} onChange={setDraft} customNutrients={customNutrients} />
          </section>
        ) : null}
      </div>

      <div className="sticky bottom-0 mt-auto flex items-center gap-2 border-t border-line bg-surface/95 px-5 py-3 backdrop-blur">
        {secondary}
        {error ? <span className="flex-1 text-xs text-alarm">{error}</span> : <span className="flex-1" />}
        <Button type="submit" variant="primary" disabled={!valid || busy}>
          {busy ? "Saving…" : submitLabel(meal)}
        </Button>
      </div>
    </form>
  );
}

/** Changing a diary entry: its amount, size, meal, time, or its figures. */
export function EntryDialog({
  entry,
  onClose,
  customNutrients,
  onSave,
  onDelete,
}: {
  entry: FoodEntry | null;
  onClose: () => void;
  customNutrients: readonly CustomNutrient[];
  onSave: (entry: FoodEntry, item: EntryItem, meal: Meal, time: string | null) => Promise<void>;
  onDelete: (entry: FoodEntry) => void;
}) {
  const [meal, setMeal] = useState<Meal>(entry?.meal ?? "snacks");
  const [time, setTime] = useState<string | null>(entry?.time ?? null);
  const [shown, setShown] = useState(entry);
  if (entry && entry !== shown) {
    setShown(entry);
    setMeal(entry.meal);
    setTime(entry.time ?? null);
  }

  return (
    <Dialog open={!!entry} onClose={onClose} title="Edit entry" size="md">
      {shown ? (
        <PortionEditor
          key={shown.id}
          subject={subjectFromItem(shown)}
          customNutrients={customNutrients}
          meal={meal}
          onMealChange={setMeal}
          time={time}
          onTimeChange={setTime}
          submitLabel={() => "Save"}
          onSubmit={(item) => onSave(shown, item, meal, time)}
          secondary={
            <Button variant="danger" onClick={() => onDelete(shown)}>
              <Trash2 size={15} /> Delete
            </Button>
          }
        />
      ) : null}
    </Dialog>
  );
}

/** Changing one template item before the template is saved. */
export function EditItemDialog({
  open,
  onClose,
  item,
  onSave,
  customNutrients = [],
}: {
  open: boolean;
  onClose: () => void;
  item: EntryItem | null;
  onSave: (item: EntryItem) => void;
  customNutrients?: readonly CustomNutrient[];
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Edit item" size="md">
      {item ? (
        <PortionEditor
          subject={subjectFromItem(item)}
          customNutrients={customNutrients}
          submitLabel={() => "Update item"}
          onSubmit={(next) => {
            onSave(next);
            onClose();
          }}
        />
      ) : null}
    </Dialog>
  );
}
