/**
 * Adding food: every way in, in one dialog, with the amount as its second step.
 *
 * Recent opens first, because most of a diary is food eaten before, led by
 * what is usually eaten at the chosen meal. Every row of food the user already
 * has gets a one-click add: recents at the amount used last time, saved foods
 * at one serving. Typing shows matching recents at once, then searches the
 * user's own foods, USDA's generic foods and OpenFoodFacts' products, and
 * offers to hand the words to an AI estimate, since "2 rotis and dal" is a
 * meal rather than a product. A string of digits is looked up as a barcode
 * instead, which is how a desk without a camera scans one. The buttons under
 * the search open an AI estimate, a quick add, or a new food.
 *
 * Every add's toast carries Undo, so a mis-click costs one more click.
 *
 * In pick mode (the template editor) nothing is logged: the chosen amount is
 * handed back through `onPicked` and the dialog stays open for the next one.
 */

"use client";

import {
  MEALS,
  MEAL_LABELS,
  describeAmount,
  itemTotals,
  matchRecents,
  recentKey,
  totalsOf,
  usualAt,
  type EntryItem,
  type Food,
  type FoodCandidate,
  type Meal,
  type MealTemplate,
  type RecentItem,
} from "@lift/shared";
import { useQuery } from "@tanstack/react-query";
import { Album, ArrowLeft, Barcode, Loader2, PenLine, Search, Sparkles, Star, Zap } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import { confirm } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionMenu } from "@/components/ui/dropdown-menu";
import { EmptyState, Skeleton } from "@/components/ui/empty-state";
import { fieldClass } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { nowClock } from "@/components/ui/time-field";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { describeError, ensureSaved, nutritionApi } from "@/lib/nutrition/api";
import { describeDay, todayIso } from "@/lib/nutrition/dates";
import {
  invalidateFoods,
  useCreateEntries,
  nutritionKeys,
  useDeleteEntries,
  useFavorites,
  useFoodSearch,
  useLogTemplate,
  useMyFoods,
  useNutritionProfile,
  useRecents,
  useTemplates,
} from "@/lib/nutrition/queries";

import { EstimateDialog } from "./estimate-dialog";
import { FoodFormDialog, type FoodFormMode } from "./food-form-dialog";
import { FoodRow } from "./food-row";
import { PortionEditor, SOURCE_LABELS, subjectFromFood, type PortionSubject } from "./portion";

export type AddFoodMode = { kind: "log"; date: string; meal: Meal } | { kind: "pick"; onPicked: (item: EntryItem) => void };

type Tab = "recent" | "favorites" | "mine" | "templates";

const BARCODE = /^\d{6,14}$/;

function foodDetail(food: Food | FoodCandidate): string {
  const serving = food.servings[0]?.label ?? "";
  return food.brand ? `${food.brand} · ${serving}` : serving;
}

function amountDetail(item: Pick<EntryItem, "quantity" | "servingLabel">): string {
  return describeAmount(item);
}

/** A saved food as a diary item: one of its first serving, the amount it opens with. */
function servingItem(food: Food): EntryItem {
  const serving = food.servings[0]!;
  return {
    foodId: food.id,
    name: food.name,
    brand: food.brand,
    servingLabel: serving.label,
    servingGrams: serving.grams,
    nutrients: serving.nutrients,
    source: food.source,
    quantity: 1,
  };
}

type Trailing = { label: string; onClick: () => void; done?: boolean } | undefined;

/** A recent is a snapshot, not a food: it opens as a one-serving food so the amount can change. */
function recentAsFood(item: RecentItem): FoodCandidate {
  return {
    id: item.foodId,
    name: item.name,
    brand: item.brand,
    barcode: null,
    source: item.source,
    sourceId: null,
    isFavorite: false,
    servings: [{ id: "logged", label: item.servingLabel, grams: item.servingGrams, nutrients: item.nutrients }],
  };
}

export function AddFoodDialog({ open, onClose, mode }: { open: boolean; onClose: () => void; mode: AddFoodMode }) {
  const title = mode.kind === "pick" ? "Add to template" : `Add to ${MEAL_LABELS[mode.meal]}`;
  return (
    <Dialog open={open} onClose={onClose} title={title} size="full">
      {/* Remounted per open, so each visit starts on Recent with an empty search. */}
      {open ? <AddFood mode={mode} /> : null}
    </Dialog>
  );
}

function AddFood({ mode }: { mode: AddFoodMode }) {
  const [meal, setMeal] = useState<Meal>(mode.kind === "log" ? mode.meal : "snacks");
  // Logging today defaults to now; a past or future day has no time until one is given.
  const [time, setTime] = useState<string | null>(() => (mode.kind === "log" && mode.date === todayIso() ? nowClock() : null));
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [tab, setTab] = useState<Tab>("recent");
  const [portion, setPortion] = useState<{ subject: PortionSubject; food: Food | FoodCandidate | null } | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<{ mode: FoodFormMode; food?: Food; barcode?: string; name?: string } | null>(null);
  /** Open with the words to estimate, or "" for an empty estimate. */
  const [estimating, setEstimating] = useState<string | null>(null);

  const profile = useNutritionProfile();
  const customNutrients = profile.data?.customNutrients ?? [];
  const create = useCreateEntries();
  const remove = useDeleteEntries(mode.kind === "log" ? mode.date : "");
  const logTemplate = useLogTemplate();
  const recents = useRecents();
  // The diary behind this dialog already has the day cached; in pick mode there is no day.
  const day = useQuery({
    queryKey: nutritionKeys.day(mode.kind === "log" ? mode.date : ""),
    queryFn: () => nutritionApi.day(mode.kind === "log" ? mode.date : ""),
    enabled: mode.kind === "log",
  });

  const trimmed = debounced.trim();
  const isBarcode = BARCODE.test(trimmed);
  const search = useFoodSearch(isBarcode ? "" : trimmed);
  const barcode = useQuery({
    queryKey: ["nutrition", "barcode", trimmed],
    queryFn: () => nutritionApi.barcode(trimmed),
    enabled: isBarcode,
    staleTime: 5 * 60_000,
  });

  const searching = query.trim().length >= 2;
  const date = mode.kind === "log" ? mode.date : null;

  const timer = useRef<number | undefined>(undefined);
  function onQuery(next: string) {
    setQuery(next);
    // Debounced in the handler rather than an effect: the next keystroke
    // replaces the timer, and there is nothing else to clean up.
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDebounced(next), 300);
  }

  function pick(food: Food | FoodCandidate, quantity = 1) {
    setPortion({ subject: subjectFromFood(food, quantity), food });
  }

  // Keyed by meal too: switching meals and adding the same food again is a
  // second, separate add.
  const rowKey = (kind: string, id: string) => `${meal}:${kind}:${id}`;

  /** Says what was added, with Undo, which also turns the row's tick back into a plus. */
  function announce(label: string, ids: string[], key?: string) {
    toast(`Added ${label} to ${MEAL_LABELS[meal].toLowerCase()}`, "success", {
      label: "Undo",
      onAction: () => {
        remove.mutate(ids);
        if (key) {
          setAdded((prev) => {
            const next = new Set(prev);
            next.delete(key);
            return next;
          });
        }
      },
    });
    if (key) setAdded((prev) => new Set(prev).add(key));
  }

  async function logItems(items: EntryItem[], label: string, key?: string, at: string | null = null) {
    if (mode.kind !== "log") return;
    const created = await create.mutateAsync({ date: mode.date, meal, items, ...(at ? { time: at } : {}) });
    announce(
      label,
      created.map((entry) => entry.id),
      key,
    );
  }

  async function submitPortion(item: EntryItem) {
    let next = item;
    const food = portion?.food;
    // A database result is saved on first use, so it turns up under My foods
    // and in search next time without asking the database again.
    if (food && !food.id && food.source !== "ai") {
      const saved = await ensureSaved(food);
      next = { ...next, foodId: saved.id };
      void invalidateFoods();
    }
    if (mode.kind === "pick") {
      mode.onPicked(next);
      toast(`Added ${next.name} to the template`);
    } else {
      await logItems([next], next.name, undefined, time);
    }
    setPortion(null);
  }

  async function quickLog(item: EntryItem, key: string) {
    try {
      await logItems([item], item.name, key);
    } catch (error) {
      toast(describeError(error), "error");
    }
  }

  /** The one-click add for a row, or none in pick mode where nothing is logged. */
  function recentTrailing(item: RecentItem): Trailing {
    if (mode.kind !== "log") return undefined;
    const key = rowKey("recent", recentKey(item));
    const entry: EntryItem = {
      foodId: item.foodId,
      name: item.name,
      brand: item.brand,
      servingLabel: item.servingLabel,
      servingGrams: item.servingGrams,
      nutrients: item.nutrients,
      source: item.source,
      quantity: item.quantity,
    };
    return { label: `Add ${item.name} to ${MEAL_LABELS[meal].toLowerCase()}`, done: added.has(key), onClick: () => void quickLog(entry, key) };
  }
  function foodTrailing(food: Food): Trailing {
    if (mode.kind !== "log" || !food.servings[0]) return undefined;
    const key = rowKey("food", food.id);
    return {
      label: `Add one ${food.servings[0].label} to ${MEAL_LABELS[meal].toLowerCase()}`,
      done: added.has(key),
      onClick: () => void quickLog(servingItem(food), key),
    };
  }

  // Habits for the chosen meal lead Recent; what the meal already has is left out.
  const inMeal = new Set((day.data?.entries ?? []).filter((entry) => entry.meal === meal).map(recentKey));
  const usual = mode.kind === "log" ? usualAt(recents.data ?? [], meal, { exclude: inMeal, limit: 5 }) : [];
  const recentMatches = query.trim().length >= 2 ? matchRecents(recents.data ?? [], query) : [];

  async function addTemplate(template: MealTemplate) {
    if (mode.kind !== "log") return;
    try {
      const created = await logTemplate.mutateAsync({ id: template.id, input: { date: mode.date, meal } });
      announce(
        template.name,
        created.map((entry) => entry.id),
        rowKey("template", template.id),
      );
    } catch (error) {
      toast(describeError(error), "error");
    }
  }

  function foodMenu(food: Food) {
    return (
      <ActionMenu
        label={`${food.name} actions`}
        items={[
          {
            label: food.isFavorite ? "Remove from favourites" : "Add to favourites",
            icon: <Star size={15} />,
            onSelect: () =>
              void nutritionApi
                .updateFood(food.id, { isFavorite: !food.isFavorite })
                .then(() => invalidateFoods())
                .catch((error) => toast(describeError(error), "error")),
          },
          { label: "Edit food", icon: <PenLine size={15} />, onSelect: () => setForm({ mode: "edit", food }) },
          null,
          {
            label: "Delete food",
            destructive: true,
            onSelect: () =>
              void confirm({
                title: `Delete ${food.name}?`,
                body: "It leaves your foods. Anything already logged with it stays in your diary.",
                confirmLabel: "Delete",
                destructive: true,
              }).then(async (ok) => {
                if (!ok) return;
                try {
                  await nutritionApi.deleteFood(food.id);
                  await invalidateFoods();
                  toast(`${food.name} deleted`);
                } catch (error) {
                  toast(describeError(error), "error");
                }
              }),
          },
        ]}
      />
    );
  }

  const formDialog = (
    <FoodFormDialog
      open={!!form}
      onClose={() => setForm(null)}
      mode={form?.mode ?? "new"}
      food={form?.food}
      barcode={form?.barcode}
      initialName={form?.name}
      target={mode.kind === "log" ? { date: mode.date, meal } : null}
      onCreated={(food) => {
        setForm(null);
        pick(food);
      }}
    />
  );

  if (portion) {
    return (
      <>
        <PortionEditor
          key={portion.subject.name + portion.subject.initialServingId}
          subject={portion.subject}
          customNutrients={customNutrients}
          meal={mode.kind === "log" ? meal : undefined}
          onMealChange={setMeal}
          time={time}
          onTimeChange={mode.kind === "log" ? setTime : undefined}
          submitLabel={(m) => (mode.kind === "pick" ? "Add to template" : `Add to ${MEAL_LABELS[m ?? meal]}`)}
          onSubmit={submitPortion}
          secondary={
            <Button variant="ghost" onClick={() => setPortion(null)}>
              <ArrowLeft size={15} /> Back
            </Button>
          }
        />
        {formDialog}
      </>
    );
  }

  const tabs: { value: Tab; label: string }[] = [
    { value: "recent", label: "Recent" },
    { value: "favorites", label: "Favourites" },
    { value: "mine", label: "My foods" },
    ...(mode.kind === "log" ? [{ value: "templates" as const, label: "Templates" }] : []),
  ];

  return (
    <div className="space-y-5 px-5 pt-1 pb-6">
      <div className="space-y-3">
        <label className="relative block">
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-3" aria-hidden />
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Search foods, describe a meal, or type a barcode"
            aria-label="Search foods"
            data-autofocus
            className={fieldClass({ className: "h-11 pr-3 pl-9 text-[15px]" })}
          />
        </label>
        {mode.kind === "log" ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Segmented value={meal} onChange={setMeal} options={MEALS.map((m) => ({ value: m, label: MEAL_LABELS[m] }))} aria-label="Meal" size="sm" />
            <span className="text-xs text-fg-3">{describeDay(date!)}</span>
          </div>
        ) : null}
      </div>

      {searching ? (
        isBarcode ? (
          <BarcodeResult
            loading={barcode.isFetching}
            error={barcode.isError ? describeError(barcode.error) : null}
            food={barcode.data?.food ?? null}
            done={barcode.isSuccess}
            code={trimmed}
            onPick={pick}
            onCreate={() => setForm({ mode: "new", barcode: trimmed })}
          />
        ) : (
          <SearchResults
            loading={search.isFetching || query.trim() !== trimmed}
            error={search.isError ? describeError(search.error) : null}
            result={search.data}
            query={query.trim()}
            recents={recentMatches}
            onPick={pick}
            onPickRecent={(item) => pick(recentAsFood(item), item.quantity)}
            recentTrailing={recentTrailing}
            foodTrailing={foodTrailing}
            onEstimate={mode.kind === "log" ? () => setEstimating(query.trim()) : undefined}
            onCreate={() => setForm({ mode: "new", name: query.trim() })}
            menuFor={foodMenu}
          />
        )
      ) : (
        <>
          <div className={cn("grid gap-2", mode.kind === "log" ? "grid-cols-3" : "grid-cols-1 sm:grid-cols-3")}>
            {mode.kind === "log" ? (
              <>
                <ActionTile icon={<Sparkles size={18} />} label="AI estimate" hint="Describe it or add a photo" accent onClick={() => setEstimating("")} />
                <ActionTile icon={<Zap size={18} />} label="Quick add" hint="Type the figures in" onClick={() => setForm({ mode: "quick" })} />
              </>
            ) : null}
            <ActionTile icon={<PenLine size={18} />} label="New food" hint="Save one of your own" onClick={() => setForm({ mode: "new" })} />
          </div>

          <Segmented value={tab} onChange={setTab} options={tabs} aria-label="Lists" />

          {tab === "recent" ? (
            <RecentList meal={meal} usual={usual} onPick={(item) => pick(recentAsFood(item), item.quantity)} trailing={recentTrailing} />
          ) : null}
          {tab === "favorites" ? <FoodList which="favorites" onPick={pick} menuFor={foodMenu} trailing={foodTrailing} /> : null}
          {tab === "mine" ? <FoodList which="mine" onPick={pick} menuFor={foodMenu} trailing={foodTrailing} /> : null}
          {tab === "templates" ? <TemplateList meal={meal} isAdded={(id) => added.has(rowKey("template", id))} onAdd={addTemplate} /> : null}
        </>
      )}

      {formDialog}
      {mode.kind === "log" ? (
        <EstimateDialog
          open={estimating !== null}
          onClose={() => setEstimating(null)}
          date={mode.date}
          meal={meal}
          initialDescription={estimating ?? undefined}
        />
      ) : null}
    </div>
  );
}

function ActionTile({ icon, label, hint, onClick, accent }: { icon: React.ReactNode; label: string; hint: string; onClick: () => void; accent?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        // Icon over label on a phone, where three tiles share 350 pixels; side by side from `sm` up.
        "press flex flex-col items-center gap-2 rounded-xl border px-2 py-3 text-center transition-colors sm:flex-row sm:gap-3 sm:px-3.5 sm:text-left",
        accent ? "border-volt/30 bg-volt-tint hover:border-volt/60" : "border-line bg-surface hover:border-line-strong hover:bg-surface-2",
      )}
    >
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", accent ? "bg-volt text-volt-ink" : "bg-surface-3 text-fg")}>{icon}</span>
      <span className="min-w-0">
        <span className={cn("block text-[13px] font-medium whitespace-nowrap sm:text-sm", accent ? "text-volt" : "text-fg")}>{label}</span>
        <span className="hidden truncate text-xs text-fg-3 sm:block">{hint}</span>
      </span>
    </button>
  );
}

function ListFrame({
  loading,
  error,
  empty,
  emptyState,
  children,
  bare,
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  emptyState: React.ReactNode;
  children: React.ReactNode;
  /** The children draw their own cards, as grouped lists do. */
  bare?: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14" />
        ))}
      </div>
    );
  }
  if (error) return <EmptyState title="Could not load" body={error} />;
  if (empty) return <>{emptyState}</>;
  if (bare) return <>{children}</>;
  return <div className="overflow-hidden rounded-xl border border-line bg-surface">{children}</div>;
}

function RecentList({
  meal,
  usual,
  onPick,
  trailing,
}: {
  meal: Meal;
  /** Usually eaten at `meal`, shown first under their own heading. */
  usual: RecentItem[];
  onPick: (item: RecentItem) => void;
  trailing: (item: RecentItem) => Trailing;
}) {
  const recents = useRecents();
  const shown = new Set(usual.map(recentKey));
  const others = (recents.data ?? []).filter((item) => !shown.has(recentKey(item)));
  return (
    <ListFrame
      loading={recents.isPending}
      error={recents.isError ? describeError(recents.error) : null}
      empty={recents.data?.length === 0}
      emptyState={<EmptyState title="Nothing logged yet" body="Foods you log show up here, ready to add again in one click." />}
      bare
    >
      <div className="space-y-5">
        {usual.length > 0 ? (
          <section>
            <h4 className="mb-2 text-[11px] font-semibold tracking-wider text-fg-3 uppercase">Usually at {MEAL_LABELS[meal].toLowerCase()}</h4>
            <RecentRows items={usual} onPick={onPick} trailing={trailing} />
          </section>
        ) : null}
        {others.length > 0 ? (
          <section>
            {usual.length > 0 ? <h4 className="mb-2 text-[11px] font-semibold tracking-wider text-fg-3 uppercase">Recent</h4> : null}
            <RecentRows items={others} onPick={onPick} trailing={trailing} />
          </section>
        ) : null}
      </div>
    </ListFrame>
  );
}

function RecentRows({ items, onPick, trailing }: { items: RecentItem[]; onPick: (item: RecentItem) => void; trailing: (item: RecentItem) => Trailing }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      {items.map((item) => (
        <FoodRow
          key={recentKey(item)}
          name={item.name}
          detail={`${amountDetail(item)}${item.timesLogged > 1 ? ` · ${item.timesLogged}×` : ""}`}
          nutrients={itemTotals(item)}
          badge={item.source === "ai" ? <Sparkles size={12} className="shrink-0 text-fg-3" /> : undefined}
          onClick={() => onPick(item)}
          trailing={trailing(item)}
        />
      ))}
    </div>
  );
}

function FoodList({
  which,
  onPick,
  menuFor,
  trailing,
}: {
  which: "favorites" | "mine";
  onPick: (food: Food) => void;
  menuFor: (food: Food) => React.ReactNode;
  trailing: (food: Food) => Trailing;
}) {
  const favorites = useFavorites();
  const mine = useMyFoods();
  const query = which === "favorites" ? favorites : mine;
  return (
    <ListFrame
      loading={query.isPending}
      error={query.isError ? describeError(query.error) : null}
      empty={query.data?.length === 0}
      emptyState={
        <EmptyState
          title={which === "favorites" ? "No favourites yet" : "No foods of your own yet"}
          body={which === "favorites" ? "Star a food on its amount step, or from its menu here." : "Foods you create or pick from search are kept here."}
        />
      }
    >
      {query.data?.map((food) => (
        <FoodRow
          key={food.id}
          name={food.name}
          detail={foodDetail(food)}
          nutrients={food.servings[0]?.nutrients ?? {}}
          badge={food.isFavorite ? <Star size={12} className="shrink-0 fill-record text-record" /> : undefined}
          onClick={() => onPick(food)}
          menu={menuFor(food)}
          trailing={trailing(food)}
        />
      ))}
    </ListFrame>
  );
}

function TemplateList({ meal, isAdded, onAdd }: { meal: Meal; isAdded: (id: string) => boolean; onAdd: (template: MealTemplate) => void }) {
  const templates = useTemplates();
  return (
    <div className="space-y-3">
      <ListFrame
        loading={templates.isPending}
        error={templates.isError ? describeError(templates.error) : null}
        empty={templates.data?.length === 0}
        emptyState={<EmptyState icon={<Album size={22} />} title="No templates yet" body="Save a meal you eat often as a template from its menu in the diary, then add it here in one click." />}
      >
        {templates.data?.map((template) => (
          <FoodRow
            key={template.id}
            name={template.name}
            detail={`${template.items.length} ${template.items.length === 1 ? "food" : "foods"}`}
            nutrients={totalsOf(template.items)}
            badge={<Album size={13} className="shrink-0 text-fg-3" />}
            trailing={{ label: `Add ${template.name} to ${MEAL_LABELS[meal].toLowerCase()}`, done: isAdded(template.id), onClick: () => onAdd(template) }}
          />
        ))}
      </ListFrame>
      <div className="text-center">
        <Link href="/food/templates" className="text-[13px] font-medium text-volt hover:underline">
          Manage templates
        </Link>
      </div>
    </div>
  );
}

function SearchResults({
  loading,
  error,
  result,
  query,
  recents,
  onPick,
  onPickRecent,
  recentTrailing,
  foodTrailing,
  onEstimate,
  onCreate,
  menuFor,
}: {
  loading: boolean;
  error: string | null;
  result: ReturnType<typeof useFoodSearch>["data"];
  query: string;
  /** Recents matching the query, filtered in the browser so they show before the server answers. */
  recents: RecentItem[];
  onPick: (food: Food | FoodCandidate) => void;
  onPickRecent: (item: RecentItem) => void;
  recentTrailing: (item: RecentItem) => Trailing;
  foodTrailing: (food: Food) => Trailing;
  /** Absent in pick mode, where an estimate cannot be logged. */
  onEstimate?: () => void;
  onCreate: () => void;
  menuFor: (food: Food) => React.ReactNode;
}) {
  // A food already shown as a recent is listed once, as the recent: it adds at
  // the amount actually eaten, which a saved food's first serving may not be.
  const recentFoodIds = new Set(recents.map((item) => item.foodId).filter(Boolean));
  const mine = (result?.mine ?? []).filter((food) => !recentFoodIds.has(food.id));
  const nothing = !!result && recents.length === 0 && mine.length === 0 && result.external.length === 0;

  return (
    <div className="space-y-5">
      {onEstimate ? (
        <button
          type="button"
          onClick={onEstimate}
          className="press flex w-full items-center gap-3 rounded-xl border border-volt/30 bg-volt-tint px-3.5 py-3 text-left transition-colors hover:border-volt/60"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-volt text-volt-ink">
            <Sparkles size={17} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-volt">Estimate “{query}”</span>
            <span className="block text-xs text-fg-3">AI works out calories and macros from your words</span>
          </span>
        </button>
      ) : null}

      {recents.length > 0 ? (
        <section>
          <h4 className="mb-2 text-[11px] font-semibold tracking-wider text-fg-3 uppercase">Recent</h4>
          <RecentRows items={recents} onPick={onPickRecent} trailing={recentTrailing} />
        </section>
      ) : null}

      {!result && loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-fg-3">
          <Loader2 size={16} className="animate-spin" /> Searching your foods, USDA and OpenFoodFacts
        </div>
      ) : null}
      {!result && !loading && error ? <EmptyState title="Search failed" body={error} /> : null}

      {result ? (
        <div className={cn("space-y-5 transition-opacity", loading && "opacity-60")}>
          {mine.length > 0 ? (
            <section>
              <h4 className="mb-2 text-[11px] font-semibold tracking-wider text-fg-3 uppercase">Your foods</h4>
              <div className="overflow-hidden rounded-xl border border-line bg-surface">
                {mine.map((food) => (
                  <FoodRow
                    key={food.id}
                    name={food.name}
                    detail={foodDetail(food)}
                    nutrients={food.servings[0]?.nutrients ?? {}}
                    badge={food.isFavorite ? <Star size={12} className="shrink-0 fill-record text-record" /> : undefined}
                    onClick={() => onPick(food)}
                    menu={menuFor(food)}
                    trailing={foodTrailing(food)}
                  />
                ))}
              </div>
            </section>
          ) : null}
          {result.external.length > 0 ? (
            <section>
              <h4 className="mb-2 text-[11px] font-semibold tracking-wider text-fg-3 uppercase">Food databases</h4>
              <div className="overflow-hidden rounded-xl border border-line bg-surface">
                {result.external.map((food) => (
                  <FoodRow
                    key={`${food.source}:${food.sourceId}`}
                    name={food.name}
                    detail={`${SOURCE_LABELS[food.source] ?? food.source} · ${foodDetail(food)}`}
                    nutrients={food.servings[0]?.nutrients ?? {}}
                    onClick={() => onPick(food)}
                  />
                ))}
              </div>
            </section>
          ) : null}
          {result.unavailable.length > 0 ? (
            <p className="text-center text-xs text-fg-3">
              {result.unavailable.map((source) => SOURCE_LABELS[source] ?? source).join(" and ")} did not answer, so these results may be incomplete.
            </p>
          ) : null}
          {nothing ? (
            <EmptyState
              icon={<Search size={20} />}
              title="No matches"
              body={onEstimate ? "Try fewer words, let AI estimate it from the words above, or make it yourself." : "Try fewer words, or make it yourself."}
            />
          ) : null}
        </div>
      ) : null}

      <div className="text-center">
        <button type="button" onClick={onCreate} className="text-[13px] font-medium text-volt hover:underline">
          Create a food instead
        </button>
      </div>
    </div>
  );
}

function BarcodeResult({
  loading,
  error,
  food,
  done,
  code,
  onPick,
  onCreate,
}: {
  loading: boolean;
  error: string | null;
  food: Food | FoodCandidate | null;
  done: boolean;
  code: string;
  onPick: (food: Food | FoodCandidate) => void;
  onCreate: () => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-fg-3">
        <Loader2 size={16} className="animate-spin" /> Looking up barcode {code}
      </div>
    );
  }
  if (error) return <EmptyState icon={<Barcode size={20} />} title="Lookup failed" body={error} />;
  if (done && !food) {
    return (
      <EmptyState
        icon={<Barcode size={20} />}
        title="Not in the food databases"
        body={`Nothing is known about ${code} yet. Save it once and it will be found next time.`}
        action={
          <Button variant="primary" onClick={onCreate}>
            Create this food
          </Button>
        }
      />
    );
  }
  if (!food) return null;
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <FoodRow
        name={food.name}
        detail={`${food.id ? "Your food" : (SOURCE_LABELS[food.source] ?? food.source)} · ${foodDetail(food)}`}
        nutrients={food.servings[0]?.nutrients ?? {}}
        badge={<Barcode size={13} className="shrink-0 text-fg-3" />}
        onClick={() => onPick(food)}
      />
    </div>
  );
}
