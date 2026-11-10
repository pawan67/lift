/**
 * How much: the amount step between choosing a food and logging it.
 *
 * `PortionEditor` is the step itself, shared by three callers: the add dialog
 * (a food about to be logged or picked for a template), `EntryDialog` (a diary
 * entry being changed) and `EditItemDialog` (a template item). The amount is a
 * number of servings or, when the serving's weight is known, grams; every
 * figure follows it as it changes, so the cost of a second helping is visible
 * before it is logged. Same behaviour as the phone's amount screen.
 */

"use client";

import {
  MEALS,
  MEAL_LABELS,
  formatCalories,
  formatNutrientValue,
  formatQuantity,
  nutrientDefinitions,
  scaleNutrients,
  type CustomNutrient,
  type EntryItem,
  type Food,
  type FoodCandidate,
  type FoodEntry,
  type Meal,
  type Serving,
} from "@lift/shared";
import { ChevronDown, Minus, Plus, Sparkles, Star, Trash2 } from "lucide-react";
import { Collapsible } from "radix-ui";
import { useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/cn";

import { NutrientFields, parseNutrientDraft, toNutrientDraft, type NutrientDraft } from "./nutrient-fields";
import { MACROS, MACRO_BG } from "./summary";

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

export function PortionEditor({
  subject,
  customNutrients,
  meal,
  onMealChange,
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
  submitLabel: (meal: Meal | undefined) => string;
  /** Throws to stay open; the message is shown under the button. */
  onSubmit: (item: EntryItem) => Promise<void> | void;
  /** Left of the submit button: back, delete. */
  secondary?: ReactNode;
  favorite?: { on: boolean; toggle: () => void };
}) {
  const [servingId, setServingId] = useState(subject.initialServingId);
  const serving = subject.servings.find((s) => s.id === servingId) ?? subject.servings[0]!;
  const [inGrams, setInGrams] = useState(false);
  const [amountText, setAmountText] = useState(formatQuantity(subject.initialQuantity));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<NutrientDraft>(() => toNutrientDraft(serving.nutrients));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const typed = Number(amountText.replace(",", "."));
  const valid = amountText.trim() !== "" && Number.isFinite(typed) && typed > 0;
  const quantity = valid ? (inGrams && serving.grams ? typed / serving.grams : typed) : 0;
  const perServing = editing ? parseNutrientDraft(draft) : serving.nutrients;
  const totals = scaleNutrients(perServing, quantity);
  const definitions = nutrientDefinitions(customNutrients).filter((d) => totals[d.key] !== undefined && !["calories", "protein", "carbs", "fat"].includes(d.key));

  function selectServing(next: Serving) {
    // Keep the weight across a serving change when both know it.
    if (!inGrams && serving.grams && next.grams && valid) setAmountText(formatQuantity((typed * serving.grams) / next.grams));
    setServingId(next.id);
    setDraft(toNutrientDraft(next.nutrients));
    setInGrams(false);
  }

  function toggleGrams() {
    if (!serving.grams) return;
    if (valid) setAmountText(formatQuantity(inGrams ? typed / serving.grams : typed * serving.grams));
    setInGrams(!inGrams);
  }

  function step(direction: 1 | -1) {
    const base = valid ? typed : 0;
    const size = inGrams ? (base >= 100 ? 25 : 10) : 0.5;
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
        <div className="flex items-center gap-6 rounded-xl border border-line bg-surface-2 px-5 py-4">
          <div className="text-center">
            <div className="tabular text-[30px] leading-none font-semibold tracking-[-0.02em] text-fg">{formatCalories(totals.calories)}</div>
            <div className="mt-1 text-xs text-fg-3">kcal</div>
          </div>
          <div className="grid flex-1 grid-cols-3 gap-3">
            {MACROS.map((macro) => (
              <div key={macro.key}>
                <div className={cn("mb-1.5 h-0.5 w-5 rounded-full", MACRO_BG[macro.key])} />
                <div className="tabular text-base font-semibold text-fg">
                  {totals[macro.key] === undefined ? "–" : formatNutrientValue(macro.key, totals[macro.key]!)}
                  <span className="ml-0.5 text-xs font-normal text-fg-3">g</span>
                </div>
                <div className="text-xs text-fg-3">{macro.label}</div>
              </div>
            ))}
          </div>
        </div>

        {subject.servings.length > 1 || serving.grams ? (
          <section>
            <h4 className="mb-2 text-[11px] font-semibold tracking-wider text-fg-3 uppercase">Serving</h4>
            <div className="flex flex-wrap gap-2">
              {subject.servings.map((option) => (
                <Chip key={option.id} selected={option.id === serving.id && !inGrams} onClick={() => (inGrams && option.id === serving.id ? toggleGrams() : selectServing(option))}>
                  {option.label}
                </Chip>
              ))}
              {serving.grams ? (
                <Chip selected={inGrams} onClick={toggleGrams}>
                  Grams
                </Chip>
              ) : null}
            </div>
          </section>
        ) : null}

        <section>
          <h4 className="mb-2 text-[11px] font-semibold tracking-wider text-fg-3 uppercase">{inGrams ? "Grams" : `Servings · ${serving.label}`}</h4>
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
                aria-label={inGrams ? "Amount in grams" : "Number of servings"}
                className="tabular w-24 bg-transparent text-right text-xl font-semibold text-fg outline-none"
              />
              <span className="w-24 text-sm text-fg-3">{inGrams ? "g" : "×"}</span>
            </label>
            <IconButton label="More" onClick={() => step(1)} className="h-11 w-11 border border-line bg-surface">
              <Plus size={18} />
            </IconButton>
          </div>
          {!inGrams ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {QUICK_AMOUNTS.map((amount) => (
                <Chip key={amount} selected={valid && typed === amount} onClick={() => setAmountText(formatQuantity(amount))}>
                  {amount === 0.5 ? "½" : amount === 1.5 ? "1½" : String(amount)}
                </Chip>
              ))}
            </div>
          ) : (
            <p className="tabular mt-2 text-xs text-fg-3">
              {formatQuantity(quantity)} × {serving.label}
            </p>
          )}
        </section>

        {meal && onMealChange ? (
          <section>
            <h4 className="mb-2 text-[11px] font-semibold tracking-wider text-fg-3 uppercase">Meal</h4>
            <Segmented value={meal} onChange={onMealChange} options={MEALS.map((m) => ({ value: m, label: MEAL_LABELS[m] }))} aria-label="Meal" />
          </section>
        ) : null}

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

/** Changing a diary entry: its amount, its meal, or its figures. */
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
  onSave: (entry: FoodEntry, item: EntryItem, meal: Meal) => Promise<void>;
  onDelete: (entry: FoodEntry) => void;
}) {
  const [meal, setMeal] = useState<Meal>(entry?.meal ?? "snacks");
  const [shown, setShown] = useState(entry);
  if (entry && entry !== shown) {
    setShown(entry);
    setMeal(entry.meal);
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
          submitLabel={() => "Save"}
          onSubmit={(item) => onSave(shown, item, meal)}
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
