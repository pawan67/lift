/**
 * The food tracker's server side.
 *
 * Every method takes the signed-in user's id first and scopes every query by
 * it; nothing here can read or write another user's row. Bodies arrive already
 * parsed by the controller, so this file trusts their shape and only enforces
 * what a schema cannot: that a referenced row exists and belongs to the caller.
 */

import {
  buildNutritionStats,
  previousRange,
  type CopyEntriesInput,
  type CreateEntriesInput,
  type CustomNutrient,
  type CustomNutrientInput,
  type DaySummary,
  type DiaryDay,
  type EntryItem,
  type EntryPatch,
  type Food,
  type FoodCandidate,
  type FoodEntry,
  type FoodInput,
  type FoodPatch,
  type FoodSearchResult,
  type FoodSource,
  type GoalsInput,
  type LogTemplateInput,
  type Meal,
  type MealTemplate,
  type NutrientValues,
  type NutritionGoals,
  type NutritionProfile,
  type NutritionStats,
  type NutritionStatsQuery,
  type RecentItem,
  type Serving,
  type TemplateInput,
  type TemplatePatch,
  uuidv7,
} from '@lift/shared';
import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';

import { db, schema } from '../db/client.js';

import { lookupBarcode, searchOpenFoodFacts, searchUsda, settle } from './food-providers.js';

const { foods, foodEntries, mealTemplates, nutritionGoals, customNutrients } = schema;

type FoodRow = typeof foods.$inferSelect;
type EntryRow = typeof foodEntries.$inferSelect;
type TemplateRow = typeof mealTemplates.$inferSelect;

function toFood(row: FoodRow): Food {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    barcode: row.barcode,
    source: row.source as FoodSource,
    sourceId: row.sourceId,
    servings: row.servings as Serving[],
    isFavorite: row.isFavorite,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toEntry(row: EntryRow): FoodEntry {
  return {
    id: row.id,
    date: row.date,
    meal: row.meal as Meal,
    time: row.time,
    position: row.position,
    quantity: row.quantity,
    foodId: row.foodId,
    name: row.name,
    brand: row.brand,
    servingLabel: row.servingLabel,
    servingGrams: row.servingGrams,
    nutrients: row.nutrients as NutrientValues,
    source: row.source as FoodSource,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toTemplate(row: TemplateRow): MealTemplate {
  return {
    id: row.id,
    name: row.name,
    meal: row.meal as Meal | null,
    items: row.items as EntryItem[],
    useCount: row.useCount,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Rounds away float dust (0.30000000000000004) before it is stored. */
function tidyNutrients(values: NutrientValues): NutrientValues {
  const out: NutrientValues = {};
  for (const [key, value] of Object.entries(values)) out[key] = Math.round(value * 1000) / 1000;
  return out;
}

/** Escapes `%` and `_` so a search for "100%" is not a wildcard. */
function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

@Injectable()
export class NutritionService {
  // -------------------------------------------------------------------------
  // Profile: goals and custom nutrients
  // -------------------------------------------------------------------------

  async profile(userId: string): Promise<NutritionProfile> {
    const [goals, custom] = await Promise.all([this.goals(userId), this.customNutrients(userId)]);
    return { goals, customNutrients: custom };
  }

  async goals(userId: string): Promise<NutritionGoals> {
    const [row] = await db.select().from(nutritionGoals).where(eq(nutritionGoals.userId, userId));
    return row ? { targets: row.targets as NutrientValues, updatedAt: row.updatedAt } : { targets: {}, updatedAt: null };
  }

  async setGoals(userId: string, input: GoalsInput): Promise<NutritionGoals> {
    const now = Date.now();
    const targets = tidyNutrients(input.targets);
    await db
      .insert(nutritionGoals)
      .values({ userId, targets, updatedAt: now })
      .onConflictDoUpdate({ target: nutritionGoals.userId, set: { targets, updatedAt: now } });
    return { targets, updatedAt: now };
  }

  async customNutrients(userId: string): Promise<CustomNutrient[]> {
    const rows = await db
      .select()
      .from(customNutrients)
      .where(eq(customNutrients.userId, userId))
      .orderBy(asc(customNutrients.createdAt));
    return rows.map(({ id, name, unit, createdAt }) => ({ id, name, unit, createdAt }));
  }

  async createCustomNutrient(userId: string, input: CustomNutrientInput): Promise<CustomNutrient> {
    const row = { id: uuidv7(), userId, name: input.name, unit: input.unit, createdAt: Date.now() };
    await db.insert(customNutrients).values(row);
    return { id: row.id, name: row.name, unit: row.unit, createdAt: row.createdAt };
  }

  async updateCustomNutrient(userId: string, id: string, input: Partial<CustomNutrientInput>): Promise<CustomNutrient> {
    const [row] = await db
      .update(customNutrients)
      .set(input)
      .where(and(eq(customNutrients.userId, userId), eq(customNutrients.id, id)))
      .returning();
    if (!row) throw new NotFoundException('No such nutrient.');
    return { id: row.id, name: row.name, unit: row.unit, createdAt: row.createdAt };
  }

  /**
   * Removes the definition and its goal. Values already stored under its id on
   * foods and entries are left alone: they are invisible without a definition,
   * and leaving them means nothing is lost if the user adds it back by mistake.
   */
  async deleteCustomNutrient(userId: string, id: string): Promise<void> {
    await db.transaction(async (tx) => {
      const deleted = await tx
        .delete(customNutrients)
        .where(and(eq(customNutrients.userId, userId), eq(customNutrients.id, id)))
        .returning({ id: customNutrients.id });
      if (deleted.length === 0) throw new NotFoundException('No such nutrient.');
      await tx
        .update(nutritionGoals)
        .set({ targets: sql`${nutritionGoals.targets} - ${id}` })
        .where(eq(nutritionGoals.userId, userId));
    });
  }

  // -------------------------------------------------------------------------
  // Diary
  // -------------------------------------------------------------------------

  async day(userId: string, date: string): Promise<DiaryDay> {
    const rows = await db
      .select()
      .from(foodEntries)
      .where(and(eq(foodEntries.userId, userId), eq(foodEntries.date, date)))
      .orderBy(asc(foodEntries.position), asc(foodEntries.createdAt));
    return { date, entries: rows.map(toEntry) };
  }

  /**
   * Every entry over a range, oldest day first and in diary order within a
   * day. For exports and the coach, which want the food itself rather than the
   * totals `summary` and `stats` reduce it to.
   */
  async entries(userId: string, from: string, to: string): Promise<FoodEntry[]> {
    const rows = await db
      .select()
      .from(foodEntries)
      .where(and(eq(foodEntries.userId, userId), gte(foodEntries.date, from), lte(foodEntries.date, to)))
      .orderBy(asc(foodEntries.date), asc(foodEntries.position), asc(foodEntries.createdAt));
    return rows.map(toEntry);
  }

  /** Per-day core totals over a range, for the week strip and trends. Days with nothing are omitted. */
  async summary(userId: string, from: string, to: string): Promise<DaySummary[]> {
    const total = (key: string) =>
      sql<number>`coalesce(sum(coalesce((${foodEntries.nutrients} ->> ${key})::float8, 0) * ${foodEntries.quantity}), 0)`;
    const rows = await db
      .select({
        date: foodEntries.date,
        calories: total('calories'),
        protein: total('protein'),
        carbs: total('carbs'),
        fat: total('fat'),
        entryCount: sql<number>`count(*)::int`,
      })
      .from(foodEntries)
      .where(and(eq(foodEntries.userId, userId), gte(foodEntries.date, from), lte(foodEntries.date, to)))
      .groupBy(foodEntries.date)
      .orderBy(asc(foodEntries.date));
    return rows.map((row) => ({
      date: row.date,
      calories: Number(row.calories),
      protein: Number(row.protein),
      carbs: Number(row.carbs),
      fat: Number(row.fat),
      entryCount: row.entryCount,
    }));
  }

  /**
   * Everything the statistics screens draw for one range. The figures are
   * worked out by `buildNutritionStats` in `@lift/shared`, which is pure and
   * tested there; this only gathers its inputs.
   *
   * The entries are loaded whole rather than summed in SQL because the page
   * wants every nutrient, the meal split and the food rankings, and a year of
   * a diary is a few thousand rows. The range before is only ever compared on
   * the core four, so it comes from `summary`. The streak needs logged dates
   * from before `from`, so those are read on their own, newest first.
   */
  async stats(userId: string, query: NutritionStatsQuery): Promise<NutritionStats> {
    const { from, to, today } = query;
    const before = previousRange(from, to);
    const [entries, goals, logged, previous] = await Promise.all([
      db
        .select({
          date: foodEntries.date,
          meal: foodEntries.meal,
          name: foodEntries.name,
          brand: foodEntries.brand,
          quantity: foodEntries.quantity,
          nutrients: foodEntries.nutrients,
        })
        .from(foodEntries)
        .where(and(eq(foodEntries.userId, userId), gte(foodEntries.date, from), lte(foodEntries.date, to))),
      this.goals(userId),
      db
        .selectDistinct({ date: foodEntries.date })
        .from(foodEntries)
        .where(and(eq(foodEntries.userId, userId), lte(foodEntries.date, today && today > to ? today : to)))
        .orderBy(desc(foodEntries.date))
        // A streak longer than this reads the same as this.
        .limit(1000),
      this.summary(userId, before.from, before.to),
    ]);
    return buildNutritionStats({
      from,
      to,
      today: today ?? null,
      entries: entries.map((row) => ({ ...row, meal: row.meal as Meal, nutrients: row.nutrients as NutrientValues })),
      targets: goals.targets,
      loggedDates: logged.map((row) => row.date),
      previous,
    });
  }

  /** Where the next entry in a meal goes: after everything already there. */
  private async nextPosition(
    tx: Pick<typeof db, 'select'>,
    userId: string,
    date: string,
    meal: Meal,
  ): Promise<number> {
    const [row] = await tx
      .select({ max: sql<number | null>`max(${foodEntries.position})` })
      .from(foodEntries)
      .where(and(eq(foodEntries.userId, userId), eq(foodEntries.date, date), eq(foodEntries.meal, meal)));
    return row?.max === null || row?.max === undefined ? 0 : Number(row.max) + 1;
  }

  /**
   * Appends items to one meal, in the order given.
   *
   * A `foodId` that is not this user's is dropped to null rather than refused:
   * the entry carries its own figures, so the reference is a convenience, and
   * the honest failure is a lost link rather than a lost entry.
   */
  private async insertItems(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    userId: string,
    date: string,
    meal: Meal,
    items: readonly EntryItem[],
    time: string | null = null,
  ): Promise<FoodEntry[]> {
    const foodIds = [...new Set(items.map((i) => i.foodId).filter((id): id is string => !!id))];
    const owned = foodIds.length
      ? new Set(
          (
            await tx
              .select({ id: foods.id })
              .from(foods)
              .where(and(eq(foods.userId, userId), inArray(foods.id, foodIds)))
          ).map((r) => r.id),
        )
      : new Set<string>();

    const start = await this.nextPosition(tx, userId, date, meal);
    const now = Date.now();
    const rows = items.map((item, index) => ({
      id: uuidv7(now),
      userId,
      date,
      meal,
      time,
      position: start + index,
      quantity: item.quantity,
      foodId: item.foodId && owned.has(item.foodId) ? item.foodId : null,
      name: item.name,
      brand: item.brand,
      servingLabel: item.servingLabel,
      servingGrams: item.servingGrams,
      nutrients: tidyNutrients(item.nutrients),
      source: item.source,
      createdAt: now,
      updatedAt: now,
    }));
    const inserted = await tx.insert(foodEntries).values(rows).returning();
    return inserted.map(toEntry);
  }

  async createEntries(userId: string, input: CreateEntriesInput & { items: EntryItem[] }): Promise<FoodEntry[]> {
    return db.transaction((tx) => this.insertItems(tx, userId, input.date, input.meal, input.items, input.time ?? null));
  }

  async updateEntry(userId: string, id: string, patch: EntryPatch): Promise<FoodEntry> {
    return db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(foodEntries)
        .where(and(eq(foodEntries.userId, userId), eq(foodEntries.id, id)));
      if (!current) throw new NotFoundException('No such entry.');

      const moving =
        (patch.date !== undefined && patch.date !== current.date) ||
        (patch.meal !== undefined && patch.meal !== current.meal);
      const position = moving
        ? await this.nextPosition(tx, userId, patch.date ?? current.date, (patch.meal ?? current.meal) as Meal)
        : current.position;

      const [row] = await tx
        .update(foodEntries)
        .set({
          ...patch,
          ...(patch.nutrients ? { nutrients: tidyNutrients(patch.nutrients) } : {}),
          position,
          updatedAt: Date.now(),
        })
        .where(and(eq(foodEntries.userId, userId), eq(foodEntries.id, id)))
        .returning();
      return toEntry(row!);
    });
  }

  async deleteEntries(userId: string, ids: string[]): Promise<void> {
    await db.delete(foodEntries).where(and(eq(foodEntries.userId, userId), inArray(foodEntries.id, ids)));
  }

  /**
   * Copies entries onto another day or meal, preserving their order. Each copy
   * is a new row with a fresh id; the originals are untouched.
   */
  async copyEntries(userId: string, input: CopyEntriesInput): Promise<FoodEntry[]> {
    return db.transaction(async (tx) => {
      const where = input.ids
        ? and(eq(foodEntries.userId, userId), inArray(foodEntries.id, input.ids))
        : and(
            eq(foodEntries.userId, userId),
            eq(foodEntries.date, input.from!.date),
            input.from!.meal ? eq(foodEntries.meal, input.from!.meal) : undefined,
          );
      const sources = (
        await tx.select().from(foodEntries).where(where).orderBy(asc(foodEntries.position), asc(foodEntries.createdAt))
      ).map(toEntry);

      const byMeal = new Map<Meal, FoodEntry[]>();
      for (const entry of sources) {
        const meal = input.to.meal ?? entry.meal;
        byMeal.set(meal, [...(byMeal.get(meal) ?? []), entry]);
      }

      const copies: FoodEntry[] = [];
      for (const [meal, entries] of byMeal) {
        copies.push(...(await this.insertItems(tx, userId, input.to.date, meal, entries)));
      }
      return copies;
    });
  }

  /**
   * Distinct things logged recently, newest first, each with the quantity used
   * last time. Distinct by name and serving, so the same food at two serving
   * sizes shows twice: those are different taps.
   */
  async recents(userId: string, limit: number): Promise<RecentItem[]> {
    const rows = await db.execute<{
      food_id: string | null;
      name: string;
      brand: string | null;
      serving_label: string;
      serving_grams: number | null;
      nutrients: NutrientValues;
      source: FoodSource;
      quantity: number;
      created_at: string;
      times: number;
      breakfast: number;
      lunch: number;
      dinner: number;
      snacks: number;
    }>(sql`
      SELECT * FROM (
        SELECT DISTINCT ON (lower(name), serving_label)
          food_id, name, brand, serving_label, serving_grams, nutrients, source, quantity, created_at,
          (count(*) OVER w)::int AS times,
          (count(*) FILTER (WHERE meal = 'breakfast') OVER w)::int AS breakfast,
          (count(*) FILTER (WHERE meal = 'lunch') OVER w)::int AS lunch,
          (count(*) FILTER (WHERE meal = 'dinner') OVER w)::int AS dinner,
          (count(*) FILTER (WHERE meal = 'snacks') OVER w)::int AS snacks
        FROM food_entries
        WHERE user_id = ${userId}
        WINDOW w AS (PARTITION BY lower(name), serving_label)
        ORDER BY lower(name), serving_label, created_at DESC
      ) latest
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
    return rows.map((row) => ({
      foodId: row.food_id,
      name: row.name,
      brand: row.brand,
      servingLabel: row.serving_label,
      servingGrams: row.serving_grams,
      nutrients: row.nutrients,
      source: row.source,
      quantity: row.quantity,
      lastLoggedAt: Number(row.created_at),
      timesLogged: row.times,
      meals: { breakfast: row.breakfast, lunch: row.lunch, dinner: row.dinner, snacks: row.snacks },
    }));
  }

  // -------------------------------------------------------------------------
  // Foods
  // -------------------------------------------------------------------------

  async listFoods(userId: string, options: { query?: string; favorites?: boolean; limit: number }): Promise<Food[]> {
    const conditions = [eq(foods.userId, userId)];
    if (options.favorites) conditions.push(eq(foods.isFavorite, true));
    if (options.query) {
      const pattern = likePattern(options.query);
      conditions.push(or(ilike(foods.name, pattern), ilike(foods.brand, pattern), eq(foods.barcode, options.query))!);
    }
    const rows = await db
      .select()
      .from(foods)
      .where(and(...conditions))
      .orderBy(desc(foods.isFavorite), desc(foods.updatedAt))
      .limit(options.limit);
    return rows.map(toFood);
  }

  /**
   * Saves a food. One with a `sourceId` is an import, and importing the same
   * product again returns the row already saved (refreshing its figures)
   * rather than making a duplicate.
   */
  async createFood(userId: string, input: FoodInput & { servings: Serving[] }): Promise<Food> {
    const now = Date.now();
    const values = {
      id: uuidv7(now),
      userId,
      name: input.name,
      brand: input.brand ?? null,
      barcode: input.barcode ?? null,
      source: input.source ?? 'custom',
      sourceId: input.sourceId ?? null,
      servings: input.servings.map((s) => ({ ...s, nutrients: tidyNutrients(s.nutrients) })),
      isFavorite: input.isFavorite ?? false,
      createdAt: now,
      updatedAt: now,
    };

    if (values.sourceId === null) {
      const [row] = await db.insert(foods).values(values).returning();
      return toFood(row!);
    }

    const [row] = await db
      .insert(foods)
      .values(values)
      .onConflictDoUpdate({
        target: [foods.userId, foods.source, foods.sourceId],
        set: {
          servings: values.servings,
          // Starring an imported food that was already saved stars it; saving
          // it again by logging it must not unstar it.
          ...(input.isFavorite ? { isFavorite: true } : {}),
          updatedAt: now,
        },
      })
      .returning();
    return toFood(row!);
  }

  async updateFood(userId: string, id: string, patch: FoodPatch): Promise<Food> {
    const [row] = await db
      .update(foods)
      .set({
        ...patch,
        ...(patch.servings
          ? { servings: patch.servings.map((s) => ({ ...s, nutrients: tidyNutrients(s.nutrients) })) }
          : {}),
        updatedAt: Date.now(),
      })
      .where(and(eq(foods.userId, userId), eq(foods.id, id)))
      .returning();
    if (!row) throw new NotFoundException('No such food.');
    return toFood(row);
  }

  async deleteFood(userId: string, id: string): Promise<void> {
    const deleted = await db
      .delete(foods)
      .where(and(eq(foods.userId, userId), eq(foods.id, id)))
      .returning({ id: foods.id });
    if (deleted.length === 0) throw new NotFoundException('No such food.');
  }

  /**
   * The user's own foods, then both outside databases in parallel. A provider
   * that fails or is slow is reported in `unavailable` and the rest still
   * answer, because a search that dies with USDA is worse than one without it.
   */
  async search(userId: string, query: string): Promise<FoodSearchResult> {
    const [mine, off, usda] = await Promise.all([
      this.listFoods(userId, { query, limit: 15 }),
      settle('OpenFoodFacts', () => searchOpenFoodFacts(query, 20)),
      settle('USDA', () => searchUsda(query, 15)),
    ]);

    const saved = new Set(mine.map((food) => `${food.source}:${food.sourceId}`));
    const fresh = (list: FoodCandidate[] | null) =>
      (list ?? []).filter((candidate) => !saved.has(`${candidate.source}:${candidate.sourceId}`));

    // Generic foods first: someone typing "banana" wants the fruit before a
    // banana-flavoured yoghurt. Then products.
    return {
      mine,
      external: [...fresh(usda), ...fresh(off)],
      unavailable: [...(off === null ? (['openfoodfacts'] as const) : []), ...(usda === null ? (['usda'] as const) : [])],
    };
  }

  /** A saved food with this barcode if there is one, otherwise whatever OpenFoodFacts knows. */
  async barcode(userId: string, code: string): Promise<{ food: Food | FoodCandidate | null }> {
    const [row] = await db
      .select()
      .from(foods)
      .where(and(eq(foods.userId, userId), eq(foods.barcode, code)))
      .orderBy(desc(foods.updatedAt))
      .limit(1);
    if (row) return { food: toFood(row) };
    return { food: await lookupBarcode(code) };
  }

  // -------------------------------------------------------------------------
  // Templates
  // -------------------------------------------------------------------------

  async templates(userId: string): Promise<MealTemplate[]> {
    const rows = await db
      .select()
      .from(mealTemplates)
      .where(eq(mealTemplates.userId, userId))
      .orderBy(desc(mealTemplates.useCount), asc(mealTemplates.name));
    return rows.map(toTemplate);
  }

  async createTemplate(userId: string, input: TemplateInput & { items: EntryItem[] }): Promise<MealTemplate> {
    const now = Date.now();
    const [row] = await db
      .insert(mealTemplates)
      .values({
        id: uuidv7(now),
        userId,
        name: input.name,
        meal: input.meal ?? null,
        items: input.items.map((item) => ({ ...item, nutrients: tidyNutrients(item.nutrients) })),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return toTemplate(row!);
  }

  async updateTemplate(userId: string, id: string, patch: TemplatePatch): Promise<MealTemplate> {
    const [row] = await db
      .update(mealTemplates)
      .set({ ...patch, updatedAt: Date.now() })
      .where(and(eq(mealTemplates.userId, userId), eq(mealTemplates.id, id)))
      .returning();
    if (!row) throw new NotFoundException('No such template.');
    return toTemplate(row);
  }

  async deleteTemplate(userId: string, id: string): Promise<void> {
    const deleted = await db
      .delete(mealTemplates)
      .where(and(eq(mealTemplates.userId, userId), eq(mealTemplates.id, id)))
      .returning({ id: mealTemplates.id });
    if (deleted.length === 0) throw new NotFoundException('No such template.');
  }

  async logTemplate(userId: string, id: string, input: LogTemplateInput & { scale: number }): Promise<FoodEntry[]> {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(mealTemplates)
        .where(and(eq(mealTemplates.userId, userId), eq(mealTemplates.id, id)));
      if (!row) throw new NotFoundException('No such template.');
      const template = toTemplate(row);

      const meal = input.meal ?? template.meal ?? 'snacks';
      const items = template.items.map((item) => ({ ...item, quantity: item.quantity * input.scale }));
      const entries = await this.insertItems(tx, userId, input.date, meal, items);

      await tx
        .update(mealTemplates)
        .set({ useCount: sql`${mealTemplates.useCount} + 1`, lastUsedAt: Date.now() })
        .where(eq(mealTemplates.id, id));
      return entries;
    });
  }
}
