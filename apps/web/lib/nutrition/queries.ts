/**
 * Server state for the food tracker, through TanStack Query.
 *
 * Everything food-related is fetched rather than read from SQLite, so caching
 * is what makes it feel local: a day already seen opens instantly from cache
 * and refreshes behind the paint, and a write updates the screen before the
 * request returns. Every write invalidates by prefix (`["nutrition", "day"]`
 * and so on) rather than by exact key, because a copy or a template can land on
 * a day other than the one on screen.
 */

import type {
  CopyEntriesInput,
  CreateEntriesInput,
  DiaryDay,
  EntryPatch,
  FoodEntry,
  LogTemplateInput,
} from "@lift/shared";
import {
  QueryClient,
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { NutritionError, nutritionApi } from "./api";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A diary changes only when this user changes it, from this phone or the
      // web app, so a minute of staleness is plenty and saves a refetch on
      // every tab switch.
      staleTime: 60_000,
      gcTime: 30 * 60_000,
      retry: (count, error) => !(error instanceof NutritionError && error.status > 0 && error.status < 500) && count < 2,
    },
  },
});

export const nutritionKeys = {
  all: ["nutrition"] as const,
  profile: ["nutrition", "profile"] as const,
  days: ["nutrition", "day"] as const,
  day: (date: string) => ["nutrition", "day", date] as const,
  summaries: ["nutrition", "summary"] as const,
  summary: (from: string, to: string) => ["nutrition", "summary", from, to] as const,
  /** Under `summary` so every diary write, which invalidates that prefix, refreshes the statistics too. */
  stats: (from: string, to: string, today: string) => ["nutrition", "summary", "stats", from, to, today] as const,
  recents: ["nutrition", "recents"] as const,
  foods: ["nutrition", "foods"] as const,
  favorites: ["nutrition", "foods", "favorites"] as const,
  search: (q: string) => ["nutrition", "search", q] as const,
  templates: ["nutrition", "templates"] as const,
};

export function useNutritionProfile() {
  return useQuery({ queryKey: nutritionKeys.profile, queryFn: nutritionApi.profile });
}

export function useDiaryDay(date: string) {
  return useQuery({
    queryKey: nutritionKeys.day(date),
    queryFn: () => nutritionApi.day(date),
    // Paging between days keeps the last one on screen until the next lands,
    // rather than flashing an empty diary.
    placeholderData: keepPreviousData,
  });
}

export function useSummary(from: string, to: string) {
  return useQuery({
    queryKey: nutritionKeys.summary(from, to),
    queryFn: () => nutritionApi.summary(from, to),
    placeholderData: keepPreviousData,
  });
}

/** The statistics page's one request. Keeps the last range on screen while the next loads. */
export function useNutritionStats(from: string, to: string, today: string) {
  return useQuery({
    queryKey: nutritionKeys.stats(from, to, today),
    queryFn: () => nutritionApi.stats({ from, to, today }),
    placeholderData: keepPreviousData,
  });
}

export function useRecents() {
  return useQuery({ queryKey: nutritionKeys.recents, queryFn: () => nutritionApi.recents(40) });
}

export function useFavorites() {
  return useQuery({
    queryKey: nutritionKeys.favorites,
    queryFn: () => nutritionApi.foods({ favorites: true, limit: 100 }),
  });
}

export function useMyFoods() {
  return useQuery({
    queryKey: [...nutritionKeys.foods, "all"],
    queryFn: () => nutritionApi.foods({ limit: 200 }),
  });
}

export function useFoodSearch(q: string) {
  const trimmed = q.trim();
  // Past the server's 100 characters this is a meal being described for the
  // AI estimate, not a food name; searching for it is a 400 shown as an error.
  const searchable = trimmed.length >= 2 && trimmed.length <= 100;
  return useQuery({
    queryKey: nutritionKeys.search(trimmed.toLowerCase()),
    queryFn: () => nutritionApi.search(trimmed),
    enabled: searchable,
    staleTime: 5 * 60_000,
    // A description is not kept showing the results of the words before it.
    placeholderData: searchable ? keepPreviousData : undefined,
  });
}

export function useTemplates() {
  return useQuery({ queryKey: nutritionKeys.templates, queryFn: nutritionApi.templates });
}

/** Everything a diary write can change: any day, the totals, and what counts as recent. */
export function invalidateDiary(client = queryClient): Promise<void> {
  return Promise.all([
    client.invalidateQueries({ queryKey: nutritionKeys.days }),
    client.invalidateQueries({ queryKey: nutritionKeys.summaries }),
    client.invalidateQueries({ queryKey: nutritionKeys.recents }),
  ]).then(() => undefined);
}

export function invalidateFoods(client = queryClient): Promise<void> {
  return Promise.all([
    client.invalidateQueries({ queryKey: nutritionKeys.foods }),
    client.invalidateQueries({ queryKey: ["nutrition", "search"] }),
  ]).then(() => undefined);
}

// ---------------------------------------------------------------------------
// Diary writes
// ---------------------------------------------------------------------------

export function useCreateEntries() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEntriesInput) => nutritionApi.createEntries(input),
    onSuccess: (entries, input) => {
      // The new rows go straight onto the cached day so the diary shows them
      // the moment the add screen closes, before the refetch.
      client.setQueryData<DiaryDay>(nutritionKeys.day(input.date), (day) =>
        day ? { ...day, entries: [...day.entries, ...entries] } : day,
      );
      void invalidateDiary(client);
    },
  });
}

export function useUpdateEntry(date: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: EntryPatch }) => nutritionApi.updateEntry(id, patch),
    onMutate: async ({ id, patch }) => {
      await client.cancelQueries({ queryKey: nutritionKeys.day(date) });
      const previous = client.getQueryData<DiaryDay>(nutritionKeys.day(date));
      if (previous) {
        const moved = (patch.date && patch.date !== date) || false;
        client.setQueryData<DiaryDay>(nutritionKeys.day(date), {
          ...previous,
          entries: moved
            ? previous.entries.filter((e) => e.id !== id)
            : previous.entries.map((e) => (e.id === id ? ({ ...e, ...patch } as FoodEntry) : e)),
        });
      }
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) client.setQueryData(nutritionKeys.day(date), context.previous);
    },
    onSettled: () => invalidateDiary(client),
  });
}

export function useDeleteEntries(date: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => nutritionApi.deleteEntries(ids),
    onMutate: async (ids) => {
      await client.cancelQueries({ queryKey: nutritionKeys.day(date) });
      const previous = client.getQueryData<DiaryDay>(nutritionKeys.day(date));
      if (previous) {
        const gone = new Set(ids);
        client.setQueryData<DiaryDay>(nutritionKeys.day(date), {
          ...previous,
          entries: previous.entries.filter((e) => !gone.has(e.id)),
        });
      }
      return { previous };
    },
    onError: (_error, _ids, context) => {
      if (context?.previous) client.setQueryData(nutritionKeys.day(date), context.previous);
    },
    onSettled: () => invalidateDiary(client),
  });
}

export function useCopyEntries() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CopyEntriesInput) => nutritionApi.copyEntries(input),
    onSuccess: () => invalidateDiary(client),
  });
}

export function useLogTemplate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: LogTemplateInput }) => nutritionApi.logTemplate(id, input),
    onSuccess: () => {
      void invalidateDiary(client);
      void client.invalidateQueries({ queryKey: nutritionKeys.templates });
    },
  });
}

export { describeError } from "./api";
