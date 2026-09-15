/**
 * The finish screen's document.
 *
 * Two orders of magnitude smaller than the training review, on purpose. The
 * review is asked to read a block of training; this is asked to say something
 * useful about one workout, and the only context it needs beyond the session
 * itself is what the same lifts did last time and what the week now looks like.
 * Sending the full review document for a three-sentence answer would cost a
 * hundred times the tokens to produce a worse one, because the interesting part
 * would be buried.
 *
 * Every figure in it is read from the database or computed by `@lift/shared`.
 * Nothing here asks a model for a number.
 */

import {
  describeVolumeGaps,
  formatPrValue,
  formatWeight,
  isWorkingSet,
  MUSCLE_GROUP_LABELS,
  PR_KIND_LABELS,
  type WeightUnit,
} from '@lift/shared';
import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db/client';
import { personalRecords } from '@/db/schema';
import { getVolumeAdvice } from './volume-advice';
import { getPreviousPerformance, getWorkoutDetail } from '@/features/workouts/repository';
import { useSettings } from '@/store/settings';

/** The worst three. More than that is a programme, not a note on one session. */
const MAX_GAPS = 3;

/**
 * Builds the document, or returns null when there is nothing worth asking about.
 *
 * A session with no completed working sets is one somebody opened and abandoned,
 * and the honest thing to do with it is nothing at all rather than spend a
 * request having a model observe that it was empty.
 */
export async function buildSessionDocument(workoutId: string): Promise<string | null> {
  const detail = await getWorkoutDetail(workoutId);
  if (!detail) return null;

  const { weightUnit } = useSettings.getState();

  const blocks: string[] = [];
  let workingSets = 0;

  for (const entry of detail.exercises) {
    const done = entry.sets.filter((set) => set.isCompleted && isWorkingSet(set.setType));
    if (done.length === 0) continue;
    workingSets += done.length;

    const lines = [`### ${entry.exercise.name}`, `Today: ${describeSets(done, weightUnit)}`];

    // What makes "did anything move?" answerable. Without it the model can only
    // describe the session, and describing a session back to the person who
    // just did it is the failure mode this brief is written against.
    const previous = await getPreviousPerformance(entry.exercise.id, {
      excludeWorkoutId: workoutId,
      before: detail.workout.startedAt.getTime(),
    }).catch(() => null);

    const last = previous?.sets.filter((set) => set.isCompleted && isWorkingSet(set.setType)) ?? [];
    lines.push(
      last.length > 0
        ? `Last time: ${describeSets(last, weightUnit)}`
        : 'Last time: no earlier session with this exercise.',
    );

    if (entry.workoutExercise.notes) lines.push(`Note: ${entry.workoutExercise.notes.trim()}`);

    blocks.push(lines.join('\n'));
  }

  if (workingSets === 0) return null;

  const sections = [
    '## The session just finished',
    '',
    `${detail.workout.name}, ${detail.workout.totalSets} working sets, ${detail.workout.totalReps} reps, ${Math.round((detail.workout.durationSeconds ?? 0) / 60)} minutes.`,
    '',
    blocks.join('\n\n'),
  ];

  const prs = await readPrs(workoutId, weightUnit);
  if (prs.length > 0) {
    sections.push('', '## Personal records set today', '', ...prs.map((line) => `- ${line}`));
  }

  // The week's shape, so the answer can say the thing only the app knows: that
  // an otherwise fine session left a muscle short of what grows it.
  const advice = await getVolumeAdvice().catch(() => null);
  if (advice && advice.gaps.length > 0) {
    sections.push(
      '',
      '## Weekly set counts outside their range, over the last four weeks',
      '',
      describeVolumeGaps(advice.gaps.slice(0, MAX_GAPS), MUSCLE_GROUP_LABELS),
      '',
      'These are measured. Do not recalculate them.',
    );
  }

  return sections.join('\n');
}

/**
 * "80 kg x 8, 80 kg x 8, 77.5 kg x 6 (RPE 9)".
 *
 * Every figure carries its unit, following the rule the review document is
 * written under: a reader that skims must not have to hold "we are in pounds
 * now" in its head to read a number.
 */
function describeSets(
  sets: readonly { weightKg: number | null; reps: number | null; rpe: number | null }[],
  unit: WeightUnit,
): string {
  return sets
    .map((set) => {
      const load = set.weightKg === null ? null : formatWeight(set.weightKg, unit);
      const reps = set.reps === null ? null : `${set.reps} reps`;
      const effort = set.rpe === null ? null : `RPE ${set.rpe}`;
      const body = [load, reps].filter(Boolean).join(' x ') || 'logged';
      return effort ? `${body} (${effort})` : body;
    })
    .join(', ');
}

async function readPrs(workoutId: string, unit: WeightUnit): Promise<string[]> {
  const rows = await db
    .select({ kind: personalRecords.kind, value: personalRecords.value })
    .from(personalRecords)
    .where(and(eq(personalRecords.workoutId, workoutId), isNull(personalRecords.deletedAt)))
    .catch(() => []);

  // The same formatter the summary screen prints these with. Seven kinds share
  // one `value` column across four dimensions, and a second implementation is
  // how the screen and the document end up disagreeing about a personal best.
  return rows.map((row) => `${PR_KIND_LABELS[row.kind]}: ${formatPrValue(row.kind, row.value, unit)}`);
}
