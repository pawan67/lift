/**
 * The page's half of the food tracker, through `app/api/nutrition`, which adds
 * the session token and forwards to the Lift API. Typed with the same
 * `@lift/shared` contract the API parses with, so the two cannot drift.
 */

import type {
  CopyEntriesInput,
  CreateEntriesInput,
  CustomNutrient,
  CustomNutrientInput,
  DaySummary,
  DiaryDay,
  EntryPatch,
  Food,
  FoodCandidate,
  FoodEntry,
  FoodInput,
  FoodPatch,
  FoodSearchResult,
  GoalsInput,
  LogTemplateInput,
  MealTemplate,
  NutritionGoals,
  NutritionProfile,
  NutritionStats,
  NutritionStatsQuery,
  RecentItem,
  TemplateInput,
  TemplatePatch,
} from "@lift/shared";

export class NutritionError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "NutritionError";
  }
}

async function request<T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/nutrition${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new NutritionError(0, "No connection. The food diary needs to be online.");
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let message = response.status >= 500 ? "The server had a problem. Try again in a moment." : "That did not work.";
    try {
      const parsed = JSON.parse(text) as { message?: unknown };
      if (typeof parsed.message === "string" && response.status < 500) message = parsed.message;
    } catch {
      // Not JSON.
    }
    if (response.status === 401) message = "Your session has expired. Sign in again.";
    throw new NutritionError(response.status, message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function query(params: Record<string, string | number | boolean | undefined>): string {
  const pairs = Object.entries(params).filter(([, value]) => value !== undefined && value !== "");
  return pairs.length ? `?${pairs.map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`).join("&")}` : "";
}

export const nutritionApi = {
  profile: () => request<NutritionProfile>("GET", "/profile"),
  setGoals: (input: GoalsInput) => request<NutritionGoals>("PUT", "/goals", input),

  createNutrient: (input: CustomNutrientInput) => request<CustomNutrient>("POST", "/nutrients", input),
  updateNutrient: (id: string, input: Partial<CustomNutrientInput>) => request<CustomNutrient>("PATCH", `/nutrients/${id}`, input),
  deleteNutrient: (id: string) => request<void>("DELETE", `/nutrients/${id}`),

  day: (date: string) => request<DiaryDay>("GET", `/day${query({ date })}`),
  summary: (from: string, to: string) => request<DaySummary[]>("GET", `/summary${query({ from, to })}`),
  stats: (range: NutritionStatsQuery) => request<NutritionStats>("GET", `/stats${query(range)}`),

  createEntries: (input: CreateEntriesInput) => request<FoodEntry[]>("POST", "/entries", input),
  updateEntry: (id: string, patch: EntryPatch) => request<FoodEntry>("PATCH", `/entries/${id}`, patch),
  deleteEntries: (ids: string[]) => request<void>("POST", "/entries/delete", { ids }),
  copyEntries: (input: CopyEntriesInput) => request<FoodEntry[]>("POST", "/entries/copy", input),
  recents: (limit = 40) => request<RecentItem[]>("GET", `/recents${query({ limit })}`),

  foods: (options: { q?: string; favorites?: boolean; limit?: number } = {}) =>
    request<Food[]>("GET", `/foods${query({ q: options.q, favorites: options.favorites, limit: options.limit })}`),
  createFood: (input: FoodInput) => request<Food>("POST", "/foods", input),
  updateFood: (id: string, patch: FoodPatch) => request<Food>("PATCH", `/foods/${id}`, patch),
  deleteFood: (id: string) => request<void>("DELETE", `/foods/${id}`),
  search: (q: string) => request<FoodSearchResult>("GET", `/search${query({ q })}`),
  barcode: (code: string) => request<{ food: Food | FoodCandidate | null }>("GET", `/barcode/${encodeURIComponent(code)}`),

  templates: () => request<MealTemplate[]>("GET", "/templates"),
  createTemplate: (input: TemplateInput) => request<MealTemplate>("POST", "/templates", input),
  updateTemplate: (id: string, patch: TemplatePatch) => request<MealTemplate>("PATCH", `/templates/${id}`, patch),
  deleteTemplate: (id: string) => request<void>("DELETE", `/templates/${id}`),
  logTemplate: (id: string, input: LogTemplateInput) => request<FoodEntry[]>("POST", `/templates/${id}/log`, input),
};

/** Saves a database result so it can be logged by id and found under My foods. A saved food comes back as is. */
export async function ensureSaved(food: Food | FoodCandidate): Promise<Food> {
  if (food.id) return food as Food;
  return nutritionApi.createFood({
    name: food.name,
    brand: food.brand,
    barcode: food.barcode,
    source: food.source,
    sourceId: food.sourceId,
    servings: food.servings,
    isFavorite: food.isFavorite,
  });
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
