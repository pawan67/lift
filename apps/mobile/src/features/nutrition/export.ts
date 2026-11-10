/**
 * Writing the food statistics' range out as a file and handing it to the
 * share sheet (or, in a browser, to the downloads folder).
 *
 * The file itself is built by `buildNutritionExport` in `@lift/shared`; this
 * only fetches the entries it needs and gets the result off the device.
 */

import {
  buildNutritionExport,
  eachIsoDate,
  NUTRITION_EXPORT_FORMATS,
  nutritionExportFileName,
  type CustomNutrient,
  type FoodEntry,
  type NutritionExportFormat,
  type NutritionStats,
} from '@lift/shared';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { SyncHttpError } from '@/features/sync/auth-client';

import { nutritionApi } from './api';

/** Day requests in flight at once on the fallback path. */
const PARALLEL_DAYS = 6;

/**
 * Every entry in a range.
 *
 * One request where the server has the `entries` route. A server from before
 * it answers 404, and then the range is read a day at a time, a few days at
 * once: slower, but an export never fails for want of a deploy.
 */
export async function loadEntries(from: string, to: string): Promise<FoodEntry[]> {
  try {
    return await nutritionApi.entries(from, to);
  } catch (error) {
    if (!(error instanceof SyncHttpError) || error.status !== 404) throw error;
  }

  const dates = eachIsoDate(from, to);
  const out: FoodEntry[] = [];
  for (let i = 0; i < dates.length; i += PARALLEL_DAYS) {
    const days = await Promise.all(dates.slice(i, i + PARALLEL_DAYS).map((date) => nutritionApi.day(date)));
    for (const day of days) out.push(...day.entries);
  }
  return out;
}

export type ExportOutcome = { kind: 'shared' } | { kind: 'downloaded' } | { kind: 'saved'; uri: string };

export async function exportNutrition(options: {
  format: NutritionExportFormat;
  from: string;
  to: string;
  stats: NutritionStats | null;
  customNutrients: CustomNutrient[];
}): Promise<ExportOutcome> {
  const { format, from, to } = options;
  const entries = await loadEntries(from, to);
  const contents = buildNutritionExport(format, {
    from,
    to,
    entries,
    stats: options.stats,
    customNutrients: options.customNutrients,
    exportedAt: new Date(),
  });
  const name = nutritionExportFileName(from, to, format);
  const meta = NUTRITION_EXPORT_FORMATS.find((option) => option.value === format)!;

  if (Platform.OS === 'web') {
    const blob = new Blob([contents], { type: `${meta.mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { kind: 'downloaded' };
  }

  const file = new File(Paths.cache, name);
  // Overwrite, so exporting the same range twice does not fail.
  file.create({ overwrite: true });
  file.write(contents);

  if (!(await Sharing.isAvailableAsync())) return { kind: 'saved', uri: file.uri };

  await Sharing.shareAsync(file.uri, {
    // `text/plain` for Markdown, which almost nothing on Android registers
    // for: the share sheet filters by type, and the honest one would leave it
    // empty. The `.md` extension still travels with the file.
    mimeType: format === 'markdown' ? 'text/plain' : meta.mimeType,
    dialogTitle: 'Food log',
  });
  return { kind: 'shared' };
}
