/**
 * The app's half of `/api/nutrition`. Mirrors
 * `apps/api/src/nutrition/nutrition.controller.ts`, typed with the same
 * `@lift/shared` contract the server parses with.
 *
 * Food is not synced the way training is: it lives on the server, and every
 * call here needs a signed-in account and a connection. That is a product
 * decision, not a shortcut, and it is why the food tab shows a sign-in prompt
 * rather than an empty diary when there is no session.
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
  RecentItem,
  TemplateInput,
  TemplatePatch,
} from '@lift/shared';

import { apiRequest } from '@/features/sync/auth-client';

const BASE = '/api/nutrition';

function query(params: Record<string, string | number | boolean | undefined>): string {
  const pairs = Object.entries(params).filter(([, value]) => value !== undefined && value !== '');
  if (pairs.length === 0) return '';
  return `?${pairs.map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`).join('&')}`;
}

export const nutritionApi = {
  profile: () => apiRequest<NutritionProfile>('GET', `${BASE}/profile`),
  setGoals: (input: GoalsInput) => apiRequest<NutritionGoals>('PUT', `${BASE}/goals`, input),

  createNutrient: (input: CustomNutrientInput) => apiRequest<CustomNutrient>('POST', `${BASE}/nutrients`, input),
  updateNutrient: (id: string, input: Partial<CustomNutrientInput>) =>
    apiRequest<CustomNutrient>('PATCH', `${BASE}/nutrients/${id}`, input),
  deleteNutrient: (id: string) => apiRequest<void>('DELETE', `${BASE}/nutrients/${id}`),

  day: (date: string) => apiRequest<DiaryDay>('GET', `${BASE}/day${query({ date })}`),
  summary: (from: string, to: string) => apiRequest<DaySummary[]>('GET', `${BASE}/summary${query({ from, to })}`),

  createEntries: (input: CreateEntriesInput) => apiRequest<FoodEntry[]>('POST', `${BASE}/entries`, input),
  updateEntry: (id: string, patch: EntryPatch) => apiRequest<FoodEntry>('PATCH', `${BASE}/entries/${id}`, patch),
  deleteEntries: (ids: string[]) => apiRequest<void>('POST', `${BASE}/entries/delete`, { ids }),
  copyEntries: (input: CopyEntriesInput) => apiRequest<FoodEntry[]>('POST', `${BASE}/entries/copy`, input),
  recents: (limit = 30) => apiRequest<RecentItem[]>('GET', `${BASE}/recents${query({ limit })}`),

  foods: (options: { q?: string; favorites?: boolean; limit?: number } = {}) =>
    apiRequest<Food[]>('GET', `${BASE}/foods${query({ q: options.q, favorites: options.favorites, limit: options.limit })}`),
  createFood: (input: FoodInput) => apiRequest<Food>('POST', `${BASE}/foods`, input),
  updateFood: (id: string, patch: FoodPatch) => apiRequest<Food>('PATCH', `${BASE}/foods/${id}`, patch),
  deleteFood: (id: string) => apiRequest<void>('DELETE', `${BASE}/foods/${id}`),
  search: (q: string) => apiRequest<FoodSearchResult>('GET', `${BASE}/search${query({ q })}`),
  barcode: (code: string) =>
    apiRequest<{ food: Food | FoodCandidate | null }>('GET', `${BASE}/barcode/${encodeURIComponent(code)}`),

  templates: () => apiRequest<MealTemplate[]>('GET', `${BASE}/templates`),
  createTemplate: (input: TemplateInput) => apiRequest<MealTemplate>('POST', `${BASE}/templates`, input),
  updateTemplate: (id: string, patch: TemplatePatch) =>
    apiRequest<MealTemplate>('PATCH', `${BASE}/templates/${id}`, patch),
  deleteTemplate: (id: string) => apiRequest<void>('DELETE', `${BASE}/templates/${id}`),
  logTemplate: (id: string, input: LogTemplateInput) =>
    apiRequest<FoodEntry[]>('POST', `${BASE}/templates/${id}/log`, input),
};

/**
 * Saves a candidate from an outside database so it can be logged by id and
 * found in "My foods" next time. A food that is already saved comes back as is.
 */
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
