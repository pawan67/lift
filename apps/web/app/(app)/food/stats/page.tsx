/**
 * Food statistics: a range of the diary at a glance, the food counterpart of
 * the training Statistics page and the same content as the phone's.
 *
 * Laid out like that page: the range picker in the header, a strip of figures
 * against the range before, then one card per question. Is the eating on
 * target (calories against the goal, as a chart and as a calendar)? What is
 * it made of (macros in grams and as a share of calories)? When is it eaten
 * (the meal split)? What is it (the foods logged most and the ones that bring
 * the most calories)? Everything comes from one request,
 * `GET /api/nutrition/stats`, worked out by `buildNutritionStats` in
 * `@lift/shared`, whose header explains why averages count logged days only
 * and leave an unfinished today out.
 *
 * "All" is not offered: the server reads at most a year per request.
 */

"use client";

import {
  CORE_NUTRIENT_KEYS,
  MEAL_LABELS,
  bucketDays,
  bucketSizeFor,
  formatCalories,
  formatNutrientValue,
  nutrientDefinitions,
  type CustomNutrient,
  type FoodTally,
  type NutrientValues,
  type NutritionStats,
  type StatsBucket,
  type StatsBucketSize,
} from "@lift/shared";
import { useMemo, useState } from "react";

import { BarChart, CHART_COLORS, HBarList, type SeriesPoint } from "@/components/charts/charts";
import { MacroBar, MACROS } from "@/components/food/summary";
import { AdherenceCalendar, MacroSplitBars } from "@/components/food/stats";
import { GoalsDialog } from "@/components/food/goals-dialog";
import { RangePicker } from "@/components/stats/range-picker";
import { Section, TH } from "@/components/stats/section";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, Skeleton } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { describeError } from "@/lib/nutrition/api";
import { parseIsoDate, shiftIso, todayIso } from "@/lib/nutrition/dates";
import { useNutritionProfile, useNutritionStats } from "@/lib/nutrition/queries";
import { useSettings } from "@/lib/settings";
import { STAT_RANGES, STAT_RANGE_LABELS, type StatRange } from "@/lib/stats/windows";

/** The training ranges, less "All". See the note at the top. */
const RANGES: readonly StatRange[] = ["7d", "30d", "3m", "1y"];

/** Rows per food ranking. The server keeps ten. */
const TOP = 8;

function shortDate(iso: string, options: Intl.DateTimeFormatOptions): string {
  return parseIsoDate(iso).toLocaleDateString(undefined, options);
}

function bucketPoint(bucket: StatsBucket, size: StatsBucketSize, count: number, goal: number | undefined): SeriesPoint {
  const label =
    size === "day"
      ? shortDate(bucket.start, count <= 7 ? { weekday: "short" } : { day: "numeric", month: "short" })
      : size === "week"
        ? shortDate(bucket.start, { day: "numeric", month: "short" })
        : shortDate(bucket.start, { month: "short" });
  const title =
    size === "day"
      ? shortDate(bucket.start, { weekday: "short", day: "numeric", month: "short" }) + (bucket.inProgress ? ", so far" : "")
      : size === "week"
        ? `${shortDate(bucket.start, { day: "numeric", month: "short" })} to ${shortDate(bucket.end, { day: "numeric", month: "short" })}, ${bucket.daysLogged} ${bucket.daysLogged === 1 ? "day" : "days"} logged`
        : `${shortDate(bucket.start, { month: "long", year: "numeric" })}, ${bucket.daysLogged} ${bucket.daysLogged === 1 ? "day" : "days"} logged`;
  const over = !!goal && bucket.calories > goal * 1.1;
  return {
    label,
    title,
    value: Math.round(bucket.calories),
    // A part day is drawn dim, like a week that is not over on the training chart.
    highlight: bucket.inProgress ? false : undefined,
    color: over ? CHART_COLORS.alarm : undefined,
  };
}

/** "+120 kcal vs before", quiet either way: more calories is not better or worse on its own. */
function change(now: number, before: number | undefined, unit: string): string | undefined {
  if (before === undefined) return undefined;
  const difference = Math.round(now - before);
  if (difference === 0) return "Same as before";
  return `${difference > 0 ? "+" : "−"}${formatCalories(Math.abs(difference))}${unit} vs before`;
}

export default function FoodStatsPage() {
  const [range, setRange] = useState<StatRange>("30d");
  const [goalsOpen, setGoalsOpen] = useState(false);
  const firstDayOfWeek = useSettings((s) => s.firstDayOfWeek);

  const today = todayIso();
  const days = STAT_RANGES.find((option) => option.value === range)?.days ?? 30;
  const from = shiftIso(today, -(days - 1));
  const stats = useNutritionStats(from, today, today);
  const profile = useNutritionProfile();
  const customNutrients = profile.data?.customNutrients ?? [];

  // The placeholder keeps the last range while the next loads; it is shown
  // under its own range only, so figures never sit under the wrong label.
  const data = stats.data && stats.data.from === from ? stats.data : null;

  return (
    <>
      <PageHeader
        title="Food statistics"
        subtitle={`${STAT_RANGE_LABELS[range]}, against the ${STAT_RANGE_LABELS[range].replace(/^Last /, "").toLowerCase()} before`}
        back={{ href: "/food", label: "Food" }}
        actions={<RangePicker value={range} onChange={setRange} options={RANGES} />}
      />

      {stats.isError && !stats.data ? (
        <Card>
          <EmptyState title="Could not load statistics" body={describeError(stats.error)} action={<Button onClick={() => void stats.refetch()}>Try again</Button>} />
        </Card>
      ) : !data ? (
        <div className="space-y-6">
          <Skeleton className="h-20" />
          <Skeleton className="h-72" />
        </div>
      ) : data.daysLogged === 0 ? (
        <Card>
          <EmptyState
            title="Nothing logged in this range"
            body="Every day you log food shows up here: calories against your goal, macros, meals and the foods you eat most."
          />
        </Card>
      ) : (
        <Report stats={data} today={today} firstDayOfWeek={firstDayOfWeek} customNutrients={customNutrients} onSetGoals={() => setGoalsOpen(true)} />
      )}

      <GoalsDialog open={goalsOpen} onClose={() => setGoalsOpen(false)} />
    </>
  );
}

function Report({
  stats,
  today,
  firstDayOfWeek,
  customNutrients,
  onSetGoals,
}: {
  stats: NutritionStats;
  today: string;
  firstDayOfWeek: 0 | 1;
  customNutrients: readonly CustomNutrient[];
  onSetGoals: () => void;
}) {
  const goals = stats.goals;
  const size = bucketSizeFor(stats.days);
  const chartData = useMemo(() => {
    const buckets = bucketDays(stats.daily, stats.from, stats.to, size);
    return buckets.map((bucket) => bucketPoint(bucket, size, buckets.length, goals.calories));
  }, [stats, size, goals.calories]);

  const previous = stats.previous;
  const average = stats.averages.calories ?? 0;
  const eaten = stats.daily.reduce((sum, day) => sum + day.calories, 0);
  const loggedDelta = previous ? stats.daysLogged - previous.daysLogged : null;

  return (
    <>
      <div className="mb-8 grid grid-cols-2 gap-x-6 gap-y-5 border-b border-line pb-6 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Daily average" value={formatCalories(average)} unit="kcal" hint={change(average, previous?.averages.calories, " kcal")} size="sm" />
        <Stat
          label="On target"
          value={stats.adherence ? stats.adherence.on : "–"}
          unit={stats.adherence ? `of ${stats.daysCounted} days` : undefined}
          hint={goals.calories ? `${formatCalories(goals.calories)} kcal ±10%` : "No calorie goal"}
          size="sm"
        />
        <Stat
          label="Days logged"
          value={stats.daysLogged}
          unit={`of ${stats.days}`}
          hint={loggedDelta === null ? "Nothing before" : loggedDelta === 0 ? "Same as before" : `${loggedDelta > 0 ? "+" : "−"}${Math.abs(loggedDelta)} vs before`}
          tone={loggedDelta !== null && loggedDelta > 0 ? "up" : undefined}
          size="sm"
        />
        <Stat
          label="Streak"
          value={stats.streak.current}
          unit={stats.streak.current === 1 ? "day" : "days"}
          hint={`Longest here ${stats.streak.longest}`}
          size="sm"
        />
        <Stat label="Protein" value={Math.round(stats.averages.protein ?? 0)} unit="g a day" hint={change(stats.averages.protein ?? 0, previous?.averages.protein, " g")} size="sm" />
        <Stat label="Entries" value={stats.daily.reduce((sum, day) => sum + day.entryCount, 0)} hint={`${formatCalories(eaten)} kcal in all`} size="sm" />
      </div>

      <div className="mb-10 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader
            title="Calories"
            subtitle={size === "day" ? "Per day" : size === "week" ? "A day, by week" : "A day, by month"}
          />
          <CardBody>
            <BarChart data={chartData} format={(value) => formatCalories(value)} valueLabel="kcal" goal={goals.calories} height={260} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title={goals.calories ? "Days against the goal" : "Days logged"}
            subtitle={goals.calories ? `On target is ${formatCalories(goals.calories * 0.9)} to ${formatCalories(goals.calories * 1.1)} kcal` : undefined}
            action={
              goals.calories ? undefined : (
                <Button size="sm" onClick={onSetGoals}>
                  Set a goal
                </Button>
              )
            }
          />
          <CardBody>
            <AdherenceCalendar from={stats.from} to={stats.to} today={today} daily={stats.daily} hasGoal={!!goals.calories} firstDayOfWeek={firstDayOfWeek} />
          </CardBody>
        </Card>
      </div>

      <div className="mb-10 grid gap-x-12 gap-y-10 lg:grid-cols-2">
        <Section title="Macros" meta="daily average">
          <div className="space-y-3.5 pt-3">
            {MACROS.map((macro) => (
              <MacroBar key={macro.key} macro={macro} value={stats.averages[macro.key] ?? 0} goal={goals[macro.key]} />
            ))}
          </div>
          {stats.macroSplit ? (
            <div className="mt-6">
              <div className={TH}>Share of calories{stats.goalSplit ? ", against your goals" : ""}</div>
              <MacroSplitBars split={stats.macroSplit} goalSplit={stats.goalSplit} />
            </div>
          ) : null}
        </Section>

        <Section title="Meals" meta="calories a day">
          <div className="pt-3">
            <HBarList
              items={stats.meals.map((meal) => ({
                key: meal.meal,
                label: MEAL_LABELS[meal.meal],
                value: meal.average,
                detail: `${Math.round(meal.share * 100)}%`,
              }))}
              format={(value) => `${formatCalories(value)} kcal`}
            />
          </div>
        </Section>

        <Section title="Most logged" meta="by entries">
          <FoodList foods={stats.topFoods.slice(0, TOP)} figure={(food) => `${food.entries}×`} detail={(food) => `${food.days} ${food.days === 1 ? "day" : "days"}, ${formatCalories(food.calories / food.entries)} kcal each`} />
        </Section>

        <Section title="Top calorie sources" meta="share of everything eaten">
          <FoodList
            foods={stats.topCalorieSources.slice(0, TOP)}
            figure={(food) => `${formatCalories(food.calories)} kcal`}
            detail={(food) => `${Math.round((food.calories / Math.max(1, eaten)) * 100)}%, ${food.entries} ${food.entries === 1 ? "time" : "times"}`}
          />
        </Section>
      </div>

      <OtherNutrients averages={stats.averages} targets={goals} customNutrients={customNutrients} />
    </>
  );
}

function FoodList({ foods, figure, detail }: { foods: FoodTally[]; figure: (food: FoodTally) => string; detail: (food: FoodTally) => string }) {
  if (foods.length === 0) return <EmptyState title="Nothing here yet" className="py-8" />;
  return (
    <ol>
      {foods.map((food, index) => (
        <li key={`${food.name}-${food.brand ?? ""}`} className="flex items-center gap-3 py-2">
          <span className="tabular w-4 shrink-0 text-center text-xs text-fg-3">{index + 1}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-fg">{food.name}</div>
            <div className="truncate text-xs text-fg-3">{food.brand ? `${food.brand}, ${detail(food)}` : detail(food)}</div>
          </div>
          <div className="tabular shrink-0 text-sm font-medium text-fg">{figure(food)}</div>
        </li>
      ))}
    </ol>
  );
}

/** The daily average of every nutrient past the core four that was logged or has a target. */
function OtherNutrients({ averages, targets, customNutrients }: { averages: NutrientValues; targets: NutrientValues; customNutrients: readonly CustomNutrient[] }) {
  const rows = nutrientDefinitions(customNutrients).filter(
    (definition) => !(CORE_NUTRIENT_KEYS as readonly string[]).includes(definition.key) && (averages[definition.key] !== undefined || targets[definition.key] !== undefined),
  );
  if (rows.length === 0) return null;
  return (
    <Section title="Other nutrients" meta="daily average, from the foods that list them">
      <ul className="grid gap-x-12 sm:grid-cols-2">
        {rows.map((definition) => {
          const value = averages[definition.key];
          const goal = targets[definition.key];
          const fraction = goal ? Math.min((value ?? 0) / goal, 1) : 0;
          return (
            <li key={definition.key} className="border-b border-line py-2.5">
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
    </Section>
  );
}
