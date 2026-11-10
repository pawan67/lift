/**
 * The food diary: one day, its four meals, and how it stands against the goals.
 * The same diary as the phone's Food tab, read from the same account.
 *
 * Wide, the meals take the main column and the day's summary, the week and the
 * full nutrient table sit beside them, so a desk shows at a glance what the
 * phone shows by scrolling. Every meal has its own add button and a menu to
 * copy it or save it as a template; every entry has a menu to copy or delete
 * it; an empty day offers to copy the one before.
 */

"use client";

import {
  CORE_NUTRIENT_KEYS,
  MEALS,
  MEAL_LABELS,
  formatCalories,
  formatNutrientValue,
  formatQuantity,
  groupByMeal,
  itemTotals,
  nutrientDefinitions,
  totalsOf,
  type CopyEntriesInput,
  type CustomNutrient,
  type EntryItem,
  type FoodEntry,
  type Meal,
  type NutrientValues,
} from "@lift/shared";
import { Album, BookmarkPlus, ChevronLeft, ChevronRight, Coffee, Copy, Moon, Plus, SlidersHorizontal, Sparkles, Sun, Trash2, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { AddFoodDialog } from "@/components/food/add-food-dialog";
import { FoodRow } from "@/components/food/food-row";
import { GoalsDialog } from "@/components/food/goals-dialog";
import { EntryDialog } from "@/components/food/portion";
import { DaySummaryPanel, MacroLine } from "@/components/food/summary";
import { TemplateDialog } from "@/components/food/template-dialog";
import { confirm } from "@/components/ui/alert-dialog";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ActionMenu } from "@/components/ui/dropdown-menu";
import { EmptyState, Skeleton } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { toast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { describeError } from "@/lib/nutrition/api";
import { describeDay, describeDayInline, longDate, parseIsoDate, shiftIso, todayIso, weekEnding } from "@/lib/nutrition/dates";
import { useCopyEntries, useDeleteEntries, useDiaryDay, useNutritionProfile, useSummary, useUpdateEntry } from "@/lib/nutrition/queries";

const MEAL_ICONS: Record<Meal, typeof Sun> = { breakfast: Sun, lunch: UtensilsCrossed, dinner: Moon, snacks: Coffee };

function entryDetail(entry: FoodEntry): string {
  const amount = entry.quantity === 1 ? entry.servingLabel : `${formatQuantity(entry.quantity)} × ${entry.servingLabel}`;
  return entry.brand ? `${entry.brand} · ${amount}` : amount;
}

export default function FoodPage() {
  const today = todayIso();
  const [date, setDate] = useState(today);
  const [adding, setAdding] = useState<Meal | null>(null);
  const [editing, setEditing] = useState<FoodEntry | null>(null);
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [templateFrom, setTemplateFrom] = useState<{ name: string; meal: Meal; items: EntryItem[] } | null>(null);

  const day = useDiaryDay(date);
  const profile = useNutritionProfile();
  // The strip shows the selected day with a few either side, but never runs
  // past today unless the selected day already has.
  const weekEnd = date > today ? date : shiftIso(date, 3) < today ? shiftIso(date, 3) : today;
  const week = weekEnding(weekEnd);
  const summary = useSummary(week[0]!, week[6]!);

  const entries = useMemo(() => day.data?.entries ?? [], [day.data]);
  const byMeal = useMemo(() => groupByMeal(entries), [entries]);
  const totals = useMemo(() => totalsOf(entries), [entries]);
  const targets = profile.data?.goals.targets ?? {};
  const customNutrients = profile.data?.customNutrients ?? [];

  const copy = useCopyEntries();
  const remove = useDeleteEntries(date);
  const update = useUpdateEntry(date);

  /** The other place an entry is most likely to be wanted: today, or tomorrow when already on today. */
  const copyTarget = date === today ? shiftIso(today, 1) : today;
  const yesterday = shiftIso(date, -1);

  async function copyTo(input: CopyEntriesInput, done: string) {
    try {
      const copies = await copy.mutateAsync(input);
      if (copies.length === 0) return toast(`Nothing on ${describeDayInline(input.from?.date ?? date)} to copy`, "info");
      toast(input.to.date === date ? done : `${done} to ${describeDayInline(input.to.date)}`);
    } catch (error) {
      toast(describeError(error), "error");
    }
  }

  function deleteEntries(list: FoodEntry[], label: string) {
    remove.mutate(
      list.map((entry) => entry.id),
      { onError: (error) => toast(describeError(error), "error") },
    );
    toast(`${label} deleted`);
  }

  function entryMenu(entry: FoodEntry) {
    return (
      <ActionMenu
        label={`${entry.name} actions`}
        items={[
          { label: "Edit amount", onSelect: () => setEditing(entry) },
          { label: `Copy to ${describeDayInline(copyTarget)}`, icon: <Copy size={15} />, onSelect: () => void copyTo({ ids: [entry.id], to: { date: copyTarget } }, "Copied") },
          ...MEALS.filter((meal) => meal !== entry.meal).map((meal) => ({
            label: `Copy to ${MEAL_LABELS[meal].toLowerCase()}`,
            onSelect: () => void copyTo({ ids: [entry.id], to: { date, meal } }, `Copied to ${MEAL_LABELS[meal].toLowerCase()}`),
          })),
          null,
          { label: "Delete", icon: <Trash2 size={15} />, destructive: true, onSelect: () => deleteEntries([entry], entry.name) },
        ]}
      />
    );
  }

  function mealMenu(meal: Meal) {
    const list = byMeal[meal];
    return (
      <ActionMenu
        label={`${MEAL_LABELS[meal]} actions`}
        items={[
          {
            label: `Copy to ${describeDayInline(copyTarget)}`,
            icon: <Copy size={15} />,
            onSelect: () => void copyTo({ from: { date, meal }, to: { date: copyTarget, meal } }, `${MEAL_LABELS[meal]} copied`),
          },
          {
            label: "Save as template",
            icon: <BookmarkPlus size={15} />,
            onSelect: () =>
              setTemplateFrom({
                name: `${MEAL_LABELS[meal]}, ${parseIsoDate(date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`,
                meal,
                items: list.map(({ foodId, name, brand, servingLabel, servingGrams, nutrients, source, quantity }) => ({
                  foodId,
                  name,
                  brand,
                  servingLabel,
                  servingGrams,
                  nutrients,
                  source,
                  quantity,
                })),
              }),
          },
          null,
          {
            label: list.length === 1 ? "Delete entry" : `Delete all ${list.length}`,
            icon: <Trash2 size={15} />,
            destructive: true,
            onSelect: () =>
              void confirm({
                title: `Clear ${MEAL_LABELS[meal].toLowerCase()}?`,
                body: `Removes ${list.length === 1 ? "its one entry" : `all ${list.length} entries`} from ${describeDayInline(date)}.`,
                confirmLabel: "Delete",
                destructive: true,
              }).then((ok) => ok && deleteEntries(list, MEAL_LABELS[meal])),
          },
        ]}
      />
    );
  }

  const summaryByDate = new Map((summary.data ?? []).map((d) => [d.date, d]));
  const loading = day.isPending;

  return (
    <>
      <PageHeader
        title="Food"
        subtitle="Your food diary, shared with the phone app."
        actions={
          <>
            <Button asChild>
              <Link href="/food/templates">
                <Album size={16} /> Templates
              </Link>
            </Button>
            <Button onClick={() => setGoalsOpen(true)}>
              <SlidersHorizontal size={16} /> Goals
            </Button>
            <Button variant="primary" onClick={() => setAdding(date === today && new Date().getHours() < 11 ? "breakfast" : "snacks")}>
              <Plus size={16} /> Add food
            </Button>
          </>
        }
      />

      {/* Day switcher and week */}
      <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-1">
          <IconButton label="Previous day" onClick={() => setDate(shiftIso(date, -1))}>
            <ChevronLeft size={18} />
          </IconButton>
          <div className="min-w-44 text-center">
            <div className="text-lg font-semibold tracking-tight text-fg">{describeDay(date)}</div>
            {date === today ? (
              <div className="text-xs text-fg-3">{longDate(date)}</div>
            ) : (
              <button type="button" onClick={() => setDate(today)} className="text-xs font-medium text-volt hover:underline">
                Back to today
              </button>
            )}
          </div>
          <IconButton label="Next day" onClick={() => setDate(shiftIso(date, 1))}>
            <ChevronRight size={18} />
          </IconButton>
        </div>
        <div className="flex flex-1 gap-1 sm:max-w-md" role="group" aria-label="This week">
          {week.map((iso) => {
            const daySummary = summaryByDate.get(iso);
            const goal = targets.calories;
            const fraction = daySummary && goal ? Math.min(daySummary.calories / goal, 1) : daySummary ? 1 : 0;
            const over = !!goal && !!daySummary && daySummary.calories > goal * 1.05;
            const selected = iso === date;
            const parsed = parseIsoDate(iso);
            return (
              <Tooltip key={iso} content={daySummary ? `${formatCalories(daySummary.calories)} kcal` : "Nothing logged"}>
                <button
                  type="button"
                  onClick={() => setDate(iso)}
                  aria-pressed={selected}
                  aria-label={`${describeDay(iso)}${daySummary ? `, ${formatCalories(daySummary.calories)} calories` : ", nothing logged"}`}
                  className={cn("press flex flex-1 flex-col items-center gap-1 rounded-lg py-1.5 transition-colors", selected ? "bg-surface-3" : "hover:bg-surface-2")}
                >
                  <span className="text-[11px] text-fg-3">{parsed.toLocaleDateString("en-GB", { weekday: "narrow" })}</span>
                  <span className={cn("tabular text-sm font-medium", iso === today ? "text-volt" : selected ? "text-fg" : "text-fg-2")}>{parsed.getDate()}</span>
                  <span className="flex h-4 w-1 items-end overflow-hidden rounded-full bg-surface-3">
                    <span className={cn("w-full rounded-full", over ? "bg-alarm" : "bg-volt", iso > today && "opacity-0")} style={{ height: `${fraction * 100}%` }} />
                  </span>
                </button>
              </Tooltip>
            );
          })}
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Meals */}
        <div className="space-y-6">
          {day.isError && !day.data ? (
            <Card>
              <EmptyState title="Could not load this day" body={describeError(day.error)} action={<Button onClick={() => void day.refetch()}>Try again</Button>} />
            </Card>
          ) : null}

          {MEALS.map((meal) => {
            const list = byMeal[meal];
            const mealTotals = totalsOf(list);
            const Icon = MEAL_ICONS[meal];
            return (
              <Card key={meal} className="overflow-hidden">
                <div className="flex items-center gap-3 px-5 py-3.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-fg-2">
                    <Icon size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-[15px] font-semibold tracking-tight text-fg">{MEAL_LABELS[meal]}</h2>
                    {list.length > 0 ? (
                      <div className="mt-0.5 flex items-center gap-3 text-xs text-fg-3">
                        <span className="tabular whitespace-nowrap">{formatCalories(mealTotals.calories)} kcal</span>
                        <MacroLine values={mealTotals} />
                      </div>
                    ) : null}
                  </div>
                  {list.length > 0 ? mealMenu(meal) : null}
                  <Button variant="secondary" size="sm" onClick={() => setAdding(meal)} aria-label={`Add food to ${MEAL_LABELS[meal]}`}>
                    <Plus size={14} /> Add
                  </Button>
                </div>
                {loading ? (
                  <div className="space-y-2 border-t border-line px-5 py-3">
                    <Skeleton className="h-10" />
                  </div>
                ) : list.length > 0 ? (
                  <div className="border-t border-line">
                    {list.map((entry) => (
                      <FoodRow
                        key={entry.id}
                        name={entry.name}
                        detail={entryDetail(entry)}
                        nutrients={itemTotals(entry)}
                        badge={entry.source === "ai" ? <Sparkles size={12} className="shrink-0 text-fg-3" aria-label="AI estimate" /> : undefined}
                        onClick={() => setEditing(entry)}
                        menu={entryMenu(entry)}
                      />
                    ))}
                  </div>
                ) : null}
              </Card>
            );
          })}

          {entries.length === 0 && day.isSuccess && !day.isPlaceholderData ? (
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => void copyTo({ from: { date: yesterday }, to: { date } }, `Copied ${describeDayInline(yesterday)}`)} disabled={copy.isPending}>
                <Copy size={15} /> Copy {describeDayInline(yesterday)}
              </Button>
              <Button variant="ghost" asChild>
                <Link href="/food/templates">
                  <Album size={15} /> Templates
                </Link>
              </Button>
            </div>
          ) : null}
        </div>

        {/* Summary column */}
        <div className="space-y-6 lg:sticky lg:top-6">
          <Card>
            <CardHeader title={date === today ? "Today so far" : describeDay(date)} subtitle={`${formatCalories(totals.calories)} kcal from ${entries.length} ${entries.length === 1 ? "entry" : "entries"}`} />
            <div className="px-5 pt-4 pb-5">
              <DaySummaryPanel totals={totals} targets={targets} />
              {!targets.calories && profile.isSuccess ? (
                <button type="button" onClick={() => setGoalsOpen(true)} className="mt-4 text-[13px] font-medium text-volt hover:underline">
                  Set daily goals to see what is left
                </button>
              ) : null}
            </div>
          </Card>
          <Card>
            <CardHeader title="Nutrients" subtitle="Everything else the day's food lists" />
            <div className="px-5 pt-3 pb-4">
              <NutrientTable totals={totals} targets={targets} customNutrients={customNutrients} />
            </div>
          </Card>
        </div>
      </div>

      <AddFoodDialog open={!!adding} onClose={() => setAdding(null)} mode={{ kind: "log", date, meal: adding ?? "snacks" }} />
      <EntryDialog
        entry={editing}
        onClose={() => setEditing(null)}
        customNutrients={customNutrients}
        onSave={async (entry, item, meal) => {
          await update.mutateAsync({
            id: entry.id,
            patch: { quantity: item.quantity, meal, ...(item.nutrients !== entry.nutrients ? { nutrients: item.nutrients } : {}) },
          });
          toast(`${entry.name} updated`);
          setEditing(null);
        }}
        onDelete={(entry) => {
          deleteEntries([entry], entry.name);
          setEditing(null);
        }}
      />
      <GoalsDialog open={goalsOpen} onClose={() => setGoalsOpen(false)} />
      <TemplateDialog open={!!templateFrom} onClose={() => setTemplateFrom(null)} template={null} initial={templateFrom ?? undefined} />
    </>
  );
}

/** Every nutrient past the core four that the day has a figure or a goal for, against that goal. */
function NutrientTable({ totals, targets, customNutrients }: { totals: NutrientValues; targets: NutrientValues; customNutrients: readonly CustomNutrient[] }) {
  const rows = nutrientDefinitions(customNutrients).filter(
    (definition) => !(CORE_NUTRIENT_KEYS as readonly string[]).includes(definition.key) && (totals[definition.key] !== undefined || targets[definition.key] !== undefined),
  );
  if (rows.length === 0) return <p className="py-2 text-sm text-fg-3">Nothing logged lists more than calories and macros.</p>;
  return (
    <ul className="divide-y divide-line">
      {rows.map((definition) => {
        const value = totals[definition.key];
        const goal = targets[definition.key];
        const fraction = goal ? Math.min((value ?? 0) / goal, 1) : 0;
        return (
          <li key={definition.key} className="py-2.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-fg-2">{definition.label}</span>
              <span className="tabular">
                <span className={value === undefined ? "text-fg-3" : "font-medium text-fg"}>{value === undefined ? "–" : formatNutrientValue(definition.key, value, customNutrients)}</span>
                <span className="text-xs text-fg-3">{goal ? ` / ${formatNutrientValue(definition.key, goal, customNutrients)} ${definition.unit}` : ` ${definition.unit}`}</span>
              </span>
            </div>
            {goal ? (
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-3">
                <div className="h-full rounded-full bg-volt" style={{ width: `${fraction * 100}%` }} />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
