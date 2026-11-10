/**
 * Making or changing a template: a name, the meal it is usually eaten at, and
 * the foods in it.
 *
 * Opened three ways: on an existing template, empty for a new one, or with
 * `initial` filled from a meal in the diary ("Save as template"). Foods are
 * added through the same add dialog the diary uses, in its pick mode, so every
 * way of finding a food works here too. Nothing is saved until Save: the items
 * are local state until then, which is what lets Cancel mean cancel.
 */

"use client";

import { MEALS, MEAL_LABELS, formatCalories, formatQuantity, itemTotals, totalsOf, type EntryItem, type Meal, type MealTemplate } from "@lift/shared";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";

import { confirm } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { ActionMenu } from "@/components/ui/dropdown-menu";
import { Field, Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toast";
import { describeError, nutritionApi } from "@/lib/nutrition/api";
import { nutritionKeys } from "@/lib/nutrition/queries";

import { AddFoodDialog } from "./add-food-dialog";
import { EditItemDialog } from "./portion";
import { FoodRow } from "./food-row";
import { MacroLine } from "./summary";

type MealChoice = Meal | "any";

const MEAL_OPTIONS: { value: MealChoice; label: string }[] = [
  { value: "any", label: "Any" },
  ...MEALS.map((meal) => ({ value: meal, label: MEAL_LABELS[meal] })),
];

export function itemDetail(item: EntryItem): string {
  const amount = item.quantity === 1 ? item.servingLabel : `${formatQuantity(item.quantity)} × ${item.servingLabel}`;
  return item.brand ? `${item.brand} · ${amount}` : amount;
}

export function TemplateDialog({
  open,
  onClose,
  template,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  template: MealTemplate | null;
  initial?: { name: string; meal: Meal | null; items: EntryItem[] };
}) {
  return (
    <Dialog open={open} onClose={onClose} title={template ? "Edit template" : "New template"} size="lg">
      {/* Remounted per open and per template, so each opening starts clean. */}
      {open ? <TemplateForm key={template?.id ?? "new"} template={template} initial={initial} onDone={onClose} /> : null}
    </Dialog>
  );
}

function TemplateForm({
  template,
  initial,
  onDone,
}: {
  template: MealTemplate | null;
  initial?: { name: string; meal: Meal | null; items: EntryItem[] };
  onDone: () => void;
}) {
  const client = useQueryClient();
  const seed = template ?? initial;
  const [name, setName] = useState(seed?.name ?? "");
  const [meal, setMeal] = useState<MealChoice>(seed?.meal ?? "any");
  const [items, setItems] = useState<EntryItem[]>(seed?.items ?? []);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const totals = totalsOf(items);
  const nameError = submitted && !name.trim() ? "Give it a name." : null;

  async function save() {
    setSubmitted(true);
    if (!name.trim()) return;
    if (items.length === 0) {
      toast("Add at least one food.", "error");
      return;
    }
    setSaving(true);
    const input = { name: name.trim(), meal: meal === "any" ? null : meal, items };
    try {
      if (template) await nutritionApi.updateTemplate(template.id, input);
      else await nutritionApi.createTemplate(input);
      await client.invalidateQueries({ queryKey: nutritionKeys.templates });
      toast(template ? "Template saved" : `${input.name} saved as a template`);
      onDone();
    } catch (failure) {
      toast(describeError(failure), "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!template) return;
    const ok = await confirm({
      title: `Delete ${template.name}?`,
      body: "The template goes. Anything already logged from it stays in your diary.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await nutritionApi.deleteTemplate(template.id);
      await client.invalidateQueries({ queryKey: nutritionKeys.templates });
      toast(`${template.name} deleted`);
      onDone();
    } catch (failure) {
      toast(describeError(failure), "error");
    }
  }

  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="space-y-5 px-5 pb-5">
          <Field label="Name" error={nameError}>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="My usual breakfast" maxLength={80} data-autofocus />
          </Field>

          <div>
            <span className="mb-1.5 block text-[13px] font-medium text-fg-2">Usually eaten at</span>
            <Segmented value={meal} options={MEAL_OPTIONS} onChange={setMeal} aria-label="Usually eaten at" className="max-w-full overflow-x-auto" />
          </div>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[11px] font-semibold tracking-wider text-fg-3 uppercase">Foods</h3>
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus size={14} /> Add food
              </Button>
            </div>
            {items.length === 0 ? (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="press w-full rounded-lg border border-dashed border-line-strong px-4 py-8 text-center text-sm text-fg-3 hover:border-fg-3/50 hover:text-fg-2"
              >
                No foods yet. Add the ones you usually eat together.
              </button>
            ) : (
              <div className="overflow-hidden rounded-lg border border-line">
                {items.map((item, index) => (
                  <FoodRow
                    key={`${item.name}-${index}`}
                    name={item.name}
                    detail={itemDetail(item)}
                    nutrients={itemTotals(item)}
                    onClick={() => setEditing(index)}
                    badge={item.source === "ai" ? <Sparkles size={12} className="shrink-0 text-fg-3" aria-label="AI estimate" /> : undefined}
                    menu={
                      <ActionMenu
                        label={`${item.name} actions`}
                        items={[
                          { label: "Edit amount", icon: <Pencil size={15} />, onSelect: () => setEditing(index) },
                          {
                            label: "Remove",
                            icon: <Trash2 size={15} />,
                            destructive: true,
                            onSelect: () => setItems((prev) => prev.filter((_, i) => i !== index)),
                          },
                        ]}
                      />
                    }
                  />
                ))}
              </div>
            )}
          </section>

          {items.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-2 px-4 py-3">
              <div className="flex items-baseline gap-1">
                <span className="tabular text-xl font-semibold tracking-[-0.02em] text-fg">{formatCalories(totals.calories)}</span>
                <span className="text-xs text-fg-3">kcal in total</span>
              </div>
              <MacroLine values={totals} />
            </div>
          ) : null}
        </div>

        <DialogFooter className={template ? "justify-between" : undefined}>
          {template ? (
            <Button variant="danger" onClick={() => void remove()}>
              <Trash2 size={15} /> Delete
            </Button>
          ) : null}
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onDone}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? "Saving…" : "Save template"}
            </Button>
          </div>
        </DialogFooter>
      </form>

      <AddFoodDialog
        open={adding}
        onClose={() => setAdding(false)}
        mode={{
          kind: "pick",
          onPicked: (item) => {
            setItems((prev) => [...prev, item]);
            toast(`${item.name} added to the template`);
          },
        }}
      />
      <EditItemDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        item={editing === null ? null : (items[editing] ?? null)}
        onSave={(item) => {
          setItems((prev) => prev.map((existing, i) => (i === editing ? item : existing)));
          setEditing(null);
        }}
      />
    </>
  );
}
