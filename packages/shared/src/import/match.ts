/**
 * Matching an imported name to a library row without guessing.
 *
 * Exact and token-sorted equality are still the only silent hits: a near-miss
 * filed under the wrong catalog row splits the user's history with nothing on
 * screen to explain it. Extra equipment words (Lyfta "Dumbbell Incline Bench
 * Press" against the catalog's "Incline Bench Press") and one-sided muscle
 * words ("Cable Pushdown" against "Triceps Pressdown") are the two differences
 * that show up across exporters and are still unique enough to trust.
 *
 * Anything with more than one plausible row is returned as a question, not an
 * answer. The import screen offers those rows; creating a custom exercise is
 * what happens when nobody picks.
 */

import type { Equipment } from '../types.ts';

import { exerciseMatchKey, inferEquipment } from './exercises.ts';

export interface ImportMatchCandidate {
  id: string;
  name: string;
  equipment: Equipment;
}

export type ImportNameDecision =
  | { kind: 'hit'; id: string }
  | { kind: 'ask'; suggestions: ImportMatchCandidate[] }
  | { kind: 'miss' };

export interface ImportMatchIndex {
  byExact: Map<string, ImportMatchCandidate>;
  byKey: Map<string, ImportMatchCandidate>;
  byStripped: Map<string, ImportMatchCandidate[]>;
  all: ImportMatchCandidate[];
}

/** How many catalog rows the import screen will offer when a name is ambiguous. */
export const IMPORT_SUGGESTION_LIMIT = 5;

/**
 * Equipment words exporters keep in the title and the catalog often drops.
 *
 * Includes Gymvisual's "Lever" / "Sled" machine prefixes, which `inferEquipment`
 * also maps to `machine`. "Bar" is the short form of a pulldown handle, not of
 * barbell: barbell is its own token.
 */
const EQUIPMENT_TOKENS = new Set([
  'lever',
  'sled',
  'bar',
  'barbell',
  'dumbbell',
  'cable',
  'machine',
  'smith',
  'kettlebell',
  'band',
  'trx',
  'suspension',
  'plate',
  'bodyweight',
  'weighted',
  'resistance',
  'medicine',
  'med',
  'cardio',
]);

/**
 * Muscle words one catalog adds and the other omits, never the movement itself.
 *
 * "Triceps Pressdown" versus "Cable Pushdown" differs by `tricep` once the
 * equipment and the pushdown/pressdown spelling agree. Allowing that extra
 * token is what makes a unique remaining movement a hit. Allowing movement
 * words would collapse "Front Squat" into "Squat".
 */
const FILLER_TOKENS = new Set([
  'tricep',
  'bicep',
  'chest',
  'back',
  'delt',
  'ab',
  'quad',
  'hamstring',
  'glute',
  'calf',
  'forearm',
  'core',
  'waist',
  'thigh',
]);

/** Spellings two catalogs use for the same movement, applied before matching. */
const TOKEN_SYNONYMS: Record<string, string> = {
  pushdown: 'pressdown',
  lat: 'lateral',
};

export function buildImportMatchIndex(
  rows: readonly ImportMatchCandidate[],
): ImportMatchIndex {
  const byExact = new Map<string, ImportMatchCandidate>();
  const byKey = new Map<string, ImportMatchCandidate>();
  const byStripped = new Map<string, ImportMatchCandidate[]>();

  for (const row of rows) {
    const lower = row.name.toLowerCase();
    if (!byExact.has(lower)) byExact.set(lower, row);

    const key = canonicalKey(row.name);
    const existing = byKey.get(key);
    if (existing === undefined || row.id < existing.id) byKey.set(key, row);

    const stripped = stripEquipment(key);
    if (!stripped) continue;
    const bucket = byStripped.get(stripped) ?? [];
    bucket.push(row);
    byStripped.set(stripped, bucket);
  }

  return { byExact, byKey, byStripped, all: [...rows] };
}

export function matchImportedName(name: string, index: ImportMatchIndex): ImportNameDecision {
  const exact = index.byExact.get(name.toLowerCase());
  if (exact) return { kind: 'hit', id: exact.id };

  const key = canonicalKey(name);
  const keyed = index.byKey.get(key);
  if (keyed) return { kind: 'hit', id: keyed.id };

  const importEquipment = inferEquipment(name);
  const stripped = stripEquipment(key);
  const strippedHits = uniqueById(index.byStripped.get(stripped) ?? []);
  const strippedDecision = decide(strippedHits, importEquipment);
  if (strippedDecision) return strippedDecision;

  const fillerHits = uniqueFillerHits(key, index.all);
  const fillerDecision = decide(fillerHits, importEquipment);
  if (fillerDecision) return fillerDecision;

  const overlap = rankedOverlap(key, index.all, importEquipment);
  if (overlap.length > 0) return ask(overlap);

  return { kind: 'miss' };
}

/**
 * One remaining row with agreeing equipment is a hit. One row with the wrong
 * equipment, or several remaining rows, is a question: the screen can still
 * offer them, and a silent miss-file cannot.
 */
function decide(
  rows: readonly ImportMatchCandidate[],
  equipment: Equipment,
): ImportNameDecision | null {
  if (rows.length === 0) return null;

  const equipped =
    equipment === 'other' ? [...rows] : rows.filter((row) => row.equipment === equipment);

  if (equipped.length === 1) return { kind: 'hit', id: equipped[0]!.id };
  if (equipped.length > 1) return ask(equipped);
  return ask(rows);
}

function canonicalKey(name: string): string {
  const tokens = exerciseMatchKey(name)
    .split(' ')
    .filter(Boolean)
    .map((token) => TOKEN_SYNONYMS[token] ?? token);

  return [...new Set(tokens)].sort().join(' ');
}

function stripEquipment(key: string): string {
  return key
    .split(' ')
    .filter((token) => token.length > 0 && !EQUIPMENT_TOKENS.has(token))
    .join(' ');
}

function uniqueFillerHits(
  importKey: string,
  catalog: readonly ImportMatchCandidate[],
): ImportMatchCandidate[] {
  const importTokens = new Set(stripEquipment(importKey).split(' ').filter(Boolean));
  if (importTokens.size === 0) return [];

  const hits: ImportMatchCandidate[] = [];
  for (const row of catalog) {
    const catalogTokens = new Set(stripEquipment(canonicalKey(row.name)).split(' ').filter(Boolean));
    if (!isSubset(importTokens, catalogTokens)) continue;
    if (!isSubset(catalogTokens, union(importTokens, FILLER_TOKENS))) continue;
    if (catalogTokens.size < importTokens.size) continue;
    hits.push(row);
  }

  return uniqueById(hits);
}

function rankedOverlap(
  importKey: string,
  catalog: readonly ImportMatchCandidate[],
  equipment: Equipment,
): ImportMatchCandidate[] {
  const importTokens = new Set(stripEquipment(importKey).split(' ').filter(Boolean));
  if (importTokens.size < 2) return [];

  const scored: { row: ImportMatchCandidate; score: number }[] = [];
  for (const row of catalog) {
    const catalogTokens = new Set(stripEquipment(canonicalKey(row.name)).split(' ').filter(Boolean));
    let intersection = 0;
    for (const token of importTokens) {
      if (catalogTokens.has(token)) intersection += 1;
    }
    if (intersection < 2) continue;
    const unionSize = importTokens.size + catalogTokens.size - intersection;
    const jaccard = unionSize === 0 ? 0 : intersection / unionSize;
    if (jaccard < 0.5) continue;
    scored.push({ row, score: jaccard });
  }

  scored.sort((a, b) => b.score - a.score || a.row.id.localeCompare(b.row.id));
  const ranked = uniqueById(scored.slice(0, IMPORT_SUGGESTION_LIMIT).map((entry) => entry.row));
  if (equipment === 'other') return ranked;
  const equipped = ranked.filter((row) => row.equipment === equipment);
  return equipped.length > 0 ? equipped : ranked;
}

function ask(suggestions: readonly ImportMatchCandidate[]): ImportNameDecision {
  return {
    kind: 'ask',
    suggestions: suggestions.slice(0, IMPORT_SUGGESTION_LIMIT),
  };
}

function uniqueById(rows: readonly ImportMatchCandidate[]): ImportMatchCandidate[] {
  const seen = new Set<string>();
  const unique: ImportMatchCandidate[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    unique.push(row);
  }
  return unique;
}

function isSubset(inner: ReadonlySet<string>, outer: ReadonlySet<string>): boolean {
  for (const token of inner) {
    if (!outer.has(token)) return false;
  }
  return true;
}

function union(left: ReadonlySet<string>, right: ReadonlySet<string>): Set<string> {
  const out = new Set(left);
  for (const token of right) out.add(token);
  return out;
}
