/**
 * Typing a food in: quick add, a new food of your own, or editing one.
 *
 * - **Quick add** logs the figures straight into the diary, for a meal out
 *   with the numbers on the receipt, and saves nothing unless asked.
 * - **New** saves a food and hands it back through `onCreated`, so the add
 *   dialog can go on to its amount: a food is made in order to be eaten.
 * - **Edit** changes a saved food. The diary is untouched, since every entry
 *   carries its own copy of the figures.
 *
 * Only calories are required; an unknown figure is left blank, not zero.
 */

"use client";

import { MEAL_LABELS, uuidv7, type Food, type Meal } from "@lift/shared";
import { Checkbox } from "radix-ui";
import { Check } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { describeError, nutritionApi } from "@/lib/nutrition/api";
import { invalidateFoods, useCreateEntries, useNutritionProfile } from "@/lib/nutrition/queries";

import { NutrientFields, parseNutrientDraft, toNutrientDraft, type NutrientDraft } from "./nutrient-fields";

export type FoodFormMode = "quick" | "new" | "edit";

export function FoodFormDialog({
  open,
  onClose,
  mode,
  food,
  barcode,
  initialName,
  target,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  mode: FoodFormMode;
  food?: Food;
  barcode?: string;
  initialName?: string;
  /** Where a quick add is logged. */
  target: { date: string; meal: Meal } | null;
  onCreated?: (food: Food) => void;
}) {
  const title = mode === "edit" ? "Edit food" : mode === "quick" ? "Quick add" : "New food";
  return (
    <Dialog open={open} onClose={onClose} title={title} size="lg">
      {open ? <FoodForm mode={mode} food={food} barcode={barcode} initialName={initialName} target={target} onDone={onClose} onCreated={onCreated} /> : null}
    </Dialog>
  );
}

function FoodForm({
  mode,
  food,
  barcode,
  initialName,
  target,
  onDone,
  onCreated,
}: {
  mode: FoodFormMode;
  food?: Food;
  barcode?: string;
  initialName?: string;
  target: { date: string; meal: Meal } | null;
  onDone: () => void;
  onCreated?: (food: Food) => void;
}) {
  const quick = mode === "quick";
  const first = food?.servings[0];
  const profile = useNutritionProfile();
  const create = useCreateEntries();

  const [name, setName] = useState(food?.name ?? initialName ?? "");
  const [brand, setBrand] = useState(food?.brand ?? "");
  const [servingLabel, setServingLabel] = useState(first?.label ?? (quick ? "1 serving" : ""));
  const [gramsText, setGramsText] = useState(first?.grams ? String(first.grams) : "");
  const [nutrients, setNutrients] = useState<NutrientDraft>(() => (first ? toNutrientDraft(first.nutrients) : {}));
  const [saveFood, setSaveFood] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const grams = gramsText.trim() ? Number(gramsText.replace(",", ".")) : null;
  const gramsValid = grams === null || (Number.isFinite(grams) && grams > 0);

  async function submit() {
    const values = parseNutrientDraft(nutrients);
    const finalName = name.trim() || (quick ? "Quick add" : "");
    const label = servingLabel.trim() || (grams ? `${grams} g` : "1 serving");
    setError(null);
    if (!finalName) return setError("Give the food a name.");
    if (values.calories === undefined) return setError("Calories are needed.");
    if (!gramsValid) return setError("The serving weight must be a number.");

    setBusy(true);
    try {
      if (mode === "edit" && food) {
        const servings = [{ ...food.servings[0]!, label, grams, nutrients: values }, ...food.servings.slice(1)];
        await nutritionApi.updateFood(food.id, { name: finalName, brand: brand.trim() || null, servings });
        await invalidateFoods();
        toast(`${finalName} saved`);
        onDone();
        return;
      }

      const serving = { id: uuidv7().slice(-12), label, grams, nutrients: values };
      let foodId: string | null = null;
      let saved: Food | null = null;

      if (!quick || saveFood) {
        saved = await nutritionApi.createFood({ name: finalName, brand: brand.trim() || null, barcode: barcode ?? null, source: "custom", servings: [serving] });
        foodId = saved.id;
        void invalidateFoods();
      }

      if (quick) {
        if (!target) throw new Error("Nowhere to log this.");
        await create.mutateAsync({
          date: target.date,
          meal: target.meal,
          items: [{ foodId, name: finalName, brand: null, servingLabel: label, servingGrams: grams, nutrients: values, source: "custom", quantity: 1 }],
        });
        toast(`Added ${finalName} to ${MEAL_LABELS[target.meal].toLowerCase()}`);
        onDone();
        return;
      }

      if (onCreated && saved) onCreated(saved);
      else onDone();
    } catch (failure) {
      setError(describeError(failure));
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
      <div className="space-y-5 px-5 pt-1 pb-5">
        {barcode && mode !== "edit" ? (
          <p className="text-[13px] text-fg-3">Barcode {barcode} is not in the food databases. Saved here, it will be found the next time you look it up.</p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={quick ? "Quick add" : "Masala dosa"} data-autofocus />
          </Field>
          {!quick ? (
            <Field label="Brand" hint="Optional">
              <Input value={brand} onChange={(event) => setBrand(event.target.value)} />
            </Field>
          ) : null}
          <Field label="Serving" hint="What the figures below are for">
            <Input value={servingLabel} onChange={(event) => setServingLabel(event.target.value)} placeholder="1 plate" />
          </Field>
          <Field label="Serving weight (g)" hint="Optional. Lets you log it in grams" error={gramsValid ? undefined : "Not a number."}>
            <Input value={gramsText} onChange={(event) => setGramsText(event.target.value.replace(/[^0-9.,]/g, ""))} inputMode="decimal" placeholder="250" />
          </Field>
        </div>

        <NutrientFields value={nutrients} onChange={setNutrients} customNutrients={profile.data?.customNutrients ?? []} />
      </div>

      <div className="sticky bottom-0 mt-auto flex flex-wrap items-center gap-3 border-t border-line bg-surface/95 px-5 py-3 backdrop-blur">
        {quick ? (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-fg-2 select-none">
            <Checkbox.Root
              checked={saveFood}
              onCheckedChange={(value) => setSaveFood(value === true)}
              className="press flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border border-line-strong bg-surface-2 data-[state=checked]:border-volt data-[state=checked]:bg-volt"
            >
              <Checkbox.Indicator>
                <Check size={13} strokeWidth={3} className="text-volt-ink" />
              </Checkbox.Indicator>
            </Checkbox.Root>
            Save to my foods
          </label>
        ) : null}
        {error ? <span className="flex-1 text-xs text-alarm">{error}</span> : <span className="flex-1" />}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Saving…" : mode === "edit" ? "Save" : quick ? `Add to ${MEAL_LABELS[target?.meal ?? "snacks"]}` : "Save and choose amount"}
        </Button>
      </div>
    </form>
  );
}
