/**
 * Deciding what a picked file actually is, and describing it before anything
 * is written.
 *
 * The screen asks which app the file came from, but the answer is a hint, not a
 * contract. People pick "Hevy" and hand over a Lift backup, or pick "Something
 * else" and hand over a Hevy CSV. Sniffing the contents rather than trusting the
 * choice is what keeps that from being an error message.
 */

import {
  collectExerciseNames,
  countSets,
  filterWorkoutsSince,
  IMPORT_SOURCE_LABELS,
  parseWorkoutCsv,
  type ImportedWorkout,
  type ParsedImport,
  type ParseOptions,
} from '@lift/shared/import';

import { inspectBackup, type BackupFile } from '@/features/backup';
import {
  inspectShare,
  routineAsImportedWorkout,
  SHARE_FORMAT,
  type SharedFile,
} from '@/features/share';

import { planExercises, type UnresolvedImportName } from './exercise-resolver';
import { countAlreadyPresent } from './repository';

/** A Lift backup: everything, restored by the backup module rather than here. */
export interface BackupPreview {
  kind: 'backup';
  file: BackupFile;
  /** The raw text, kept so the restore doesn't parse it a second time. */
  json: string;
}

/** A per-set export from any app, including Lift's own CSV. */
export interface WorkoutsPreview {
  kind: 'workouts';
  parsed: ParsedImport;
  /** What the file says it is, in words: "Hevy", "a workout app". */
  sourceLabel: string;
  /** Sessions in the file the log already holds. Excluded from any import. */
  alreadyPresent: number;
  /** Earliest and latest session in the file. Null when it holds none. */
  span: { from: Date; to: Date } | null;
  /**
   * Names with no library entry, across the whole file.
   *
   * The whole file rather than the chosen range, because the range moves and
   * this read is the expensive one: the caller narrows it with
   * `newExercisesIn`, which needs no database at all.
   */
  newExercises: string[];
  /**
   * Names that missed an exact match but have catalog rows the user can pick.
   *
   * The whole file, same as `newExercises`. The range filter is
   * `unresolvedExercisesIn`.
   */
  unresolved: UnresolvedImportName[];
}

/** One routine or one session, sent by another person. See `features/share`. */
export interface SharePreview {
  kind: 'share';
  file: SharedFile;
  /**
   * Names in the share with no library entry here.
   *
   * Planned for both kinds even though only a routine writes them itself: a
   * session goes on to `importWorkouts`, which plans again, and this is what
   * lets the confirmation say "adds 2 exercises to your library" before the
   * user commits to either.
   */
  newExercises: string[];
  unresolved: UnresolvedImportName[];
}

export type ImportPreview = BackupPreview | WorkoutsPreview | SharePreview;

/**
 * Reads a file and works out what can be done with it.
 *
 * A leading `{` is the whole test for JSON, which is enough: the only JSON this
 * app writes is a backup or a share, and both inspectors reject anything else
 * with a sentence about what they wanted.
 *
 * The two are told apart on their `format` tag rather than by trying one and
 * catching the other. A backup that fails to parse and a share that fails to
 * parse have different things to say, and running both would report whichever
 * threw last instead of the one the user actually picked.
 */
export async function readImportFile(
  text: string,
  options: ParseOptions = {},
): Promise<ImportPreview> {
  if (text.trimStart().startsWith('{')) {
    if (looksLikeShare(text)) {
      const file = inspectShare(text);
      const workout =
        file.kind === 'routine' ? routineAsImportedWorkout(file.routine) : file.session;
      const plan = await planExercises([workout]);

      return { kind: 'share', file, newExercises: plan.created, unresolved: plan.unresolved };
    }

    const file = inspectBackup(text);
    return { kind: 'backup', file, json: text };
  }

  const parsed = parseWorkoutCsv(text, options);
  const plan = await planExercises(parsed.workouts);

  return {
    kind: 'workouts',
    parsed,
    sourceLabel: IMPORT_SOURCE_LABELS[parsed.source],
    alreadyPresent: await countAlreadyPresent(parsed.workouts),
    span: spanOf(parsed.workouts),
    newExercises: plan.created,
    unresolved: plan.unresolved,
  };
}

function spanOf(workouts: readonly ImportedWorkout[]): { from: Date; to: Date } | null {
  if (workouts.length === 0) return null;

  // The parser returns them oldest first, so the ends are the ends.
  return {
    from: new Date(workouts[0]!.startedAt),
    to: new Date(workouts[workouts.length - 1]!.startedAt),
  };
}

export interface RangeSelection {
  workouts: ImportedWorkout[];
  sets: number;
}

/** What a chosen cutoff leaves, for the line above the import button. */
export function selectRange(parsed: ParsedImport, cutoff: number | null): RangeSelection {
  const workouts = filterWorkoutsSince(parsed.workouts, cutoff);
  return { workouts, sets: countSets(workouts) };
}

/**
 * The subset of a preview's new exercises that the chosen range actually
 * reaches.
 *
 * Narrowing the dates narrows the library: importing last week should not add
 * the forty exercises that only appear in 2023. Derived in memory from the
 * preview rather than re-planned, so dragging the range picker costs nothing.
 */
export function newExercisesIn(
  preview: WorkoutsPreview,
  workouts: readonly ImportedWorkout[],
): string[] {
  const present = new Set(
    collectExerciseNames(workouts).map((name) => name.toLowerCase()),
  );

  return preview.newExercises.filter((name) => present.has(name.toLowerCase()));
}

export function unresolvedExercisesIn(
  preview: WorkoutsPreview,
  workouts: readonly ImportedWorkout[],
): UnresolvedImportName[] {
  const present = new Set(
    collectExerciseNames(workouts).map((name) => name.toLowerCase()),
  );

  return preview.unresolved.filter((entry) => present.has(entry.name.toLowerCase()));
}

/**
 * Whether a JSON file claims to be a share, without committing to parsing it.
 *
 * A substring test rather than a parse, because the caller is about to hand
 * whichever inspector wins the full text and both parse it properly. This only
 * has to pick the right one, and a file large enough for the double parse to
 * matter is not a single routine.
 */
function looksLikeShare(text: string): boolean {
  return text.includes(`"${SHARE_FORMAT}"`);
}
