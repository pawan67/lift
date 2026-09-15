/**
 * The training-review prompt.
 *
 * Turns a window of the log into one Markdown document addressed *to* a
 * language model: the sessions as they were performed, the weekly set count per
 * muscle against the landmarks the statistics screens judge it by, the routines
 * the work came out of, and a brief saying what kind of answer is wanted. The
 * user hands it to ChatGPT, Claude or whatever else they keep open and gets a
 * critique back. An export whose destination happens to be a model rather than
 * a spreadsheet.
 *
 * It is pure, and it lives here rather than in the app because it is the half
 * of the feature worth testing. The queries behind it are ordinary reads; the
 * document is where the mistakes hide, and they are quiet ones. A session log
 * that drops its last exercise, or a figure printed in kilograms under a
 * heading that said pounds, produces confident advice about training that never
 * happened, and nothing in the app will ever contradict it.
 *
 * Two rules run through the whole document.
 *
 * Every figure carries its unit on the figure itself, never inherited from a
 * heading three sections up. A reader that skims (and this one skims) must
 * not have to hold "we are in pounds now" in its head to read a number.
 *
 * And anything left out says so, in the text, where it was left out: a capped
 * session log, a muscle with no landmarks, a bodyweight the app was never told.
 * A gap a reader cannot see is a gap it will fill with an assumption.
 */

import { landmarksFor, volumeZone, VOLUME_ZONE_LABELS, type TrainingLevel } from './landmarks.ts';
import { MEASUREMENT_KIND_META, SEX_LABELS, type Sex } from './measurements.ts';
import {
  EQUIPMENT_LABELS,
  MEASUREMENT_KIND_LABELS,
  MUSCLE_GROUP_LABELS,
  PR_KIND_LABELS,
  type DistanceUnit,
  type Equipment,
  type MeasurementKind,
  type MeasurementUnit,
  type MuscleGroup,
  type PrKind,
  type SetType,
  type TrackingType,
  type WeightUnit,
} from './types.ts';
import {
  formatDistance,
  formatDuration,
  formatDurationShort,
  formatVolume,
  formatWeight,
} from './units.ts';

/**
 * Bumped when the document's shape changes enough that an answer written
 * against the old one would read the new one wrongly. It is printed in the
 * footer: someone comparing two critiques months apart can see whether they
 * were asked the same question.
 */
export const COACH_PROMPT_VERSION = 1;

/**
 * The landmarks the muscle table is printed against.
 *
 * Intermediate, matching every other screen in the app. `landmarksFor` takes
 * the same default. A picker here would let the document disagree with the body
 * map the user is looking at while they read it, over a distinction the brief
 * already invites them to correct in their own words.
 */
const REVIEW_LEVEL: TrainingLevel = 'intermediate';

// ---------------------------------------------------------------------------
// What a review is written from
// ---------------------------------------------------------------------------

/** Display units, carried together because every formatter needs a pair of them. */
export interface CoachUnits {
  weightUnit: WeightUnit;
  distanceUnit: DistanceUnit;
  measurementUnit: MeasurementUnit;
}

export interface CoachProfile extends CoachUnits {
  /** Storage units throughout: kilograms and centimetres. Null means unrecorded. */
  bodyweightKg: number | null;
  heightCm: number | null;
  sex: Sex | null;
  /**
   * Whatever the user typed on the way out: a goal, an injury, the days they
   * can train. The one thing in the document the log cannot supply, and the
   * thing that most changes what a useful answer looks like.
   */
  note: string | null;
}

export interface CoachSet {
  setType: SetType;
  weightKg: number | null;
  reps: number | null;
  durationSeconds: number | null;
  distanceKm: number | null;
  rpe: number | null;
}

export interface CoachExercise {
  name: string;
  equipment: Equipment;
  primaryMuscle: MuscleGroup;
  secondaryMuscles: MuscleGroup[];
  trackingType: TrackingType;
  notes: string | null;
  /** Exercises sharing a group were performed back to back. */
  supersetGroup: number | null;
  /** Completed sets only, in the order they were performed. Warm-ups included. */
  sets: CoachSet[];
}

export interface CoachSession {
  startedAt: number;
  name: string;
  durationSeconds: number | null;
  notes: string | null;
  volumeKg: number;
  /** Working sets: the denormalised totals from the workout row. */
  sets: number;
  reps: number;
  prCount: number;
  exercises: CoachExercise[];
}

/**
 * One muscle's share of the window.
 *
 * Sets, and not volume or reps, for the reason `muscle-stats.ts` gives: set
 * count is the unit training distribution is judged in, and volume lets one
 * heavy squat bury a whole session of arm work. The loads are all in the
 * session log anyway, where they belong to the exercise that moved them.
 */
export interface CoachMuscle {
  muscle: MuscleGroup;
  /** Working sets, indirect ones counted at a half. Fractional as a result. */
  sets: number;
  /** Sets where this muscle was the target. Whole. */
  directSets: number;
  /** Distinct exercises that trained it. */
  exercises: number;
  /** `sets` over the weeks the window spans: what the landmarks judge. */
  setsPerWeek: number;
}

export interface CoachRoutineTarget {
  setType: SetType;
  reps: number | null;
  weightKg: number | null;
  rpe: number | null;
  durationSeconds: number | null;
  distanceKm: number | null;
}

export interface CoachRoutineExercise {
  name: string;
  equipment: Equipment;
  primaryMuscle: MuscleGroup;
  notes: string | null;
  restSeconds: number | null;
  supersetGroup: number | null;
  sets: CoachRoutineTarget[];
}

export interface CoachRoutine {
  name: string;
  notes: string | null;
  lastPerformedAt: number | null;
  exercises: CoachRoutineExercise[];
}

export interface CoachRecord {
  exercise: string;
  kind: PrKind;
  /** Canonical unit for the kind: kg, reps, seconds or km. */
  value: number;
  /** Reps a weight record was set at, where the kind has them. */
  reps: number | null;
  achievedAt: number;
}

export interface CoachMeasurement {
  kind: MeasurementKind;
  /** Storage units: kg for bodyweight, percent for body fat, cm for the rest. */
  value: number;
  measuredAt: number;
}

export interface CoachTotals {
  workouts: number;
  /** Distinct calendar days trained, which is not the workout count. */
  activeDays: number;
  sets: number;
  reps: number;
  volumeKg: number;
  durationSeconds: number;
  prs: number;
}

export interface CoachReport {
  generatedAt: number;
  /** Inclusive start. Null when the window is the whole log. */
  from: number | null;
  /** Exclusive end. */
  to: number;
  /** "Last 3 months": the range as the user chose it. */
  rangeLabel: string;
  /** Weeks the window spans, floored at 1. The divisor behind every rate. */
  weeks: number;
  profile: CoachProfile;
  totals: CoachTotals;
  /** Busiest muscle first. */
  muscles: CoachMuscle[];
  /** Oldest first. Empty when the user asked for totals without the log. */
  sessions: CoachSession[];
  /** Every routine on the device, in the order they are listed in the app. */
  routines: CoachRoutine[];
  /** Current bests, for the exercises trained in the window. */
  records: CoachRecord[];
  /** Latest entry per measurement kind, whenever it was taken. */
  measurements: CoachMeasurement[];
  /** Bodyweight inside the window, oldest first. Drives the trend line. */
  bodyweightSeries: CoachMeasurement[];
  /**
   * Sessions the log was capped at, and what the cap left out. The totals and
   * the muscle table always cover the whole window regardless.
   */
  omittedSessions: number;
  /** False when the user turned the session log off rather than it being empty. */
  sessionsIncluded: boolean;
  routinesIncluded: boolean;
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

/**
 * The brief.
 *
 * Written as an ordered list because the failure mode of asking a model for
 * "feedback on my training" is four paragraphs of encouragement, and someone
 * who exported their whole log did not do it to be told they are consistent.
 * Each heading names the question it wants answered, and the rules underneath
 * spend their words on the two things a model gets wrong here: praising instead
 * of criticising, and inventing sets to criticise.
 */
export const COACH_BRIEF = `You are an experienced strength and hypertrophy coach reviewing a client's training log.

Everything below is a real export from Lift, a workout tracker: the sessions as they were performed, the weekly set counts they add up to, the routines they came from, and the current personal bests. Read all of it before you answer.

Answer under these headings, in this order:

1. **What this block of training actually was.** Two or three sentences. Frequency, emphasis, how hard, whether it progressed. No preamble.
2. **What is working.** The specific things worth keeping, and why they are working.
3. **What is holding me back.** The costliest problems first. Be blunt and be specific. Name the exercise, the muscle, the session date. Where a muscle is under- or over-worked, say by how many sets per week.
4. **Progression.** Which lifts moved over this window and which stalled, read off the session log. For each stalled lift say what to change: load, reps, frequency, exercise selection, or effort.
5. **Fix my routines.** Concrete edits to the routines listed below. Exercises to add, drop, swap or reorder, and the sets and rep ranges to prescribe. Give me the edited routine, not a new programme.
6. **The next four weeks.** Week by week, in a form I can log: exercises, sets, target reps, and how to progress load.
7. **What you could not tell from this.** Anything missing that you would need to answer properly, and how I should record it.

Rules:

- Specifics over principles. "Side delts got 4 sets a week against an MEV of 10. Add 3 sets of lateral raises to Push A and Push B" is worth more than "make sure you train your shoulders".
- Use only the sets that are in this document. Do not invent work I did not do, and do not assume work happened outside the window.
- Where the data is thin, missing or contradictory, say so instead of filling the gap.
- Skip the encouragement. I want the criticism.`;

/**
 * The log itself, without the brief in front of it.
 *
 * Split out because the two halves are addressed differently once the app talks
 * to a model directly rather than through a paste. The brief is an instruction
 * and belongs in the system position, where it stays out of the conversation and
 * cannot be argued with; the document is evidence and belongs in the first user
 * turn, where a provider that caches prompt prefixes can hold on to it across
 * every follow-up question. A year of training is tens of thousands of tokens
 * and re-sending it to ask "why that exercise?" is most of the cost of a chat.
 *
 * `buildCoachPrompt` still exists and still returns exactly what it did, because
 * the export path is not going anywhere: it is the whole feature for anyone who
 * has not given the app a key.
 */
export function buildCoachDocument(report: CoachReport): string {
  const sections: string[] = [
    aboutSection(report),
    windowSection(report),
    muscleSection(report),
    sessionSection(report),
    routineSection(report),
    recordSection(report),
    measurementSection(report),
    notesSection(report),
  ];

  return sections.filter((section) => section.length > 0).join('\n\n');
}

/** Renders a whole report as the Markdown document the user hands to a model. */
export function buildCoachPrompt(report: CoachReport): string {
  return ['# Training review request', COACH_BRIEF, buildCoachDocument(report)]
    .filter((section) => section.length > 0)
    .join('\n\n');
}

/**
 * A rough token count, for the screen to warn with before a paste.
 *
 * Four characters to the token is the usual English approximation and is close
 * enough for the only decision it informs: whether a year of training is going
 * to fit in one message. It is deliberately not presented as exact anywhere.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** `lift-review-2026-04-14.md`: stable, sortable, and obviously ours. */
export function coachFileName(generatedAt: number): string {
  return `lift-review-${isoDay(new Date(generatedAt))}.md`;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function aboutSection(report: CoachReport): string {
  const { profile } = report;
  const lines = ['## About me', ''];

  lines.push(
    `- Weights are in ${profile.weightUnit}, distances in ${profile.distanceUnit}, body measurements in ${profile.measurementUnit}.`,
  );
  lines.push(
    `- Bodyweight: ${
      profile.bodyweightKg == null
        ? 'not recorded. Treat any bodyweight exercise below as unloaded reps'
        : formatWeight(profile.bodyweightKg, profile.weightUnit)
    }`,
  );
  lines.push(
    `- Height: ${
      profile.heightCm == null
        ? 'not recorded'
        : formatMeasure(profile.heightCm, profile.measurementUnit)
    }`,
  );
  lines.push(`- Sex: ${profile.sex == null ? 'not recorded' : SEX_LABELS[profile.sex]}`);

  if (profile.note && profile.note.trim().length > 0) {
    // Last, and quoted, so it is unmistakably the client speaking rather than
    // another field the exporter filled in.
    lines.push('', 'In my own words:', '', quote(profile.note.trim()));
  }

  return lines.join('\n');
}

function windowSection(report: CoachReport): string {
  const { totals, weeks } = report;
  const lines = ['## The window', ''];

  lines.push(`- Range: ${report.rangeLabel}: ${describeSpan(report)}`);
  lines.push(`- Length: ${oneDecimal(weeks)} weeks`);
  lines.push(
    `- Sessions: ${totals.workouts} across ${totals.activeDays} separate days (${oneDecimal(
      totals.workouts / weeks,
    )} a week)`,
  );
  lines.push(`- Working sets: ${totals.sets} (${oneDecimal(totals.sets / weeks)} a week)`);
  lines.push(`- Reps: ${totals.reps.toLocaleString('en-US')}`);
  lines.push(`- Volume: ${formatVolume(totals.volumeKg, report.profile.weightUnit)}`);
  lines.push(
    `- Time under the bar: ${
      totals.durationSeconds > 0 ? formatDurationShort(totals.durationSeconds) : 'not recorded'
    }`,
  );
  lines.push(`- Personal records set: ${totals.prs}`);

  return lines.join('\n');
}

/**
 * The set-count table, and the one section that carries an argument rather than
 * only figures.
 *
 * The landmarks are printed beside the counts because they are what the app's
 * own screens colour a muscle by, and a review that judged the same numbers
 * against some other private standard would contradict the body map the user is
 * looking at. The caveat under the table is the same one the landmark table
 * carries in `landmarks.ts` (informed estimates, not measurements) and it is
 * repeated here because this is the copy a stranger reads.
 */
function muscleSection(report: CoachReport): string {
  if (report.muscles.length === 0) {
    return ['## Weekly sets per muscle', '', 'No working sets were logged in this window.'].join('\n');
  }

  const lines = [
    '## Weekly sets per muscle',
    '',
    `Averaged over the ${oneDecimal(report.weeks)} weeks of the window. A set counts whole toward the muscle the exercise targets and a half toward each muscle it only assists, which is why the rate is often fractional; "direct" is the whole-set count on its own.`,
    '',
    '| Muscle | Sets/week | Direct sets | Exercises | MEV | MAV | MRV | Reading |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ];

  for (const entry of report.muscles) {
    const landmarks = landmarksFor(entry.muscle, REVIEW_LEVEL);
    // A row of zeros is the honest entry for the buckets that are not muscles.
    // Cardio, whole-body work, the unclassified, and printing it as real
    // thresholds would have the table calling someone's running overreached.
    const scaled = landmarks.mrv > 0;

    lines.push(
      `| ${MUSCLE_GROUP_LABELS[entry.muscle]} | ${oneDecimal(entry.setsPerWeek)} | ${
        entry.directSets
      } | ${entry.exercises} | ${scaled ? landmarks.mev : '—'} | ${scaled ? landmarks.mav : '—'} | ${
        scaled ? landmarks.mrv : '—'
      } | ${scaled ? VOLUME_ZONE_LABELS[volumeZone(entry.setsPerWeek, landmarks)] : 'no landmark'} |`,
    );
  }

  lines.push(
    '',
    'MEV is the minimum weekly sets growth starts at, MAV the band it grows fastest in, MRV the most that can be recovered from. They are the Renaissance Periodization landmarks for an intermediate lifter. Treat them as informed estimates rather than measurements (the spread between two lifters is wider than the spread between two of these rows) and adjust them if what I said about myself above suggests they are wrong for me.',
  );

  return lines.join('\n');
}

function sessionSection(report: CoachReport): string {
  if (!report.sessionsIncluded) {
    return [
      '## Session log',
      '',
      'Left out of this export on purpose. Judge the weekly set counts and the routines; say so if you need the sessions to answer something.',
    ].join('\n');
  }

  if (report.sessions.length === 0) {
    return ['## Session log', '', 'No finished sessions in this window.'].join('\n');
  }

  const lines = ['## Session log', ''];

  if (report.omittedSessions > 0) {
    // The totals above cover every session; only the log is capped. Saying which
    // is which stops a reader adding up the sessions it can see and concluding
    // the summary is wrong.
    const shown = report.sessions.length;
    const total = shown + report.omittedSessions;

    lines.push(
      `The ${shown === 1 ? 'most recent session' : `${shown} most recent sessions`} of ${total} in the window, oldest first. The ${
        report.omittedSessions === 1 ? 'older one is' : `${report.omittedSessions} older ones are`
      } left out for length; the totals and the set counts above still cover all of them.`,
      '',
    );
  }

  for (const session of report.sessions) {
    lines.push(...sessionLines(session, report.profile), '');
  }

  return lines.join('\n').trimEnd();
}

function sessionLines(session: CoachSession, units: CoachUnits): string[] {
  const heading = `### ${stamp(session.startedAt)} · ${session.name}`;

  const facts = [
    session.durationSeconds ? formatDurationShort(session.durationSeconds) : null,
    `${session.sets} working sets`,
    `${session.reps} reps`,
    formatVolume(session.volumeKg, units.weightUnit),
    session.prCount > 0 ? `${session.prCount} PR${session.prCount === 1 ? '' : 's'}` : null,
  ].filter((part): part is string => part !== null);

  const lines = [heading, facts.join(' · ')];

  if (session.notes) lines.push('', quote(session.notes));

  for (const exercise of session.exercises) {
    lines.push('', ...exerciseLines(exercise, units));
  }

  return lines;
}

function exerciseLines(exercise: CoachExercise, units: CoachUnits): string[] {
  const context = [
    MUSCLE_GROUP_LABELS[exercise.primaryMuscle],
    EQUIPMENT_LABELS[exercise.equipment].toLowerCase(),
    exercise.supersetGroup != null ? `superset ${exercise.supersetGroup}` : null,
  ].filter((part): part is string => part !== null);

  const lines = [`**${exercise.name}**: ${context.join(', ')}`];
  if (exercise.notes) lines.push(`Note: ${collapse(exercise.notes)}`);

  // Warm-ups are printed but not numbered: they are part of what happened: a
  // heavy top single after two ramping sets is a different session from the same
  // single cold, and they are excluded from every count in the app, so
  // numbering them would put a "4" beside a set no total includes.
  let working = 0;

  for (const set of exercise.sets) {
    const label = set.setType === 'warmup' ? 'W' : String(++working);
    const tag = set.setType === 'drop' ? ' (drop set)' : set.setType === 'failure' ? ' (to failure)' : '';
    lines.push(`- ${label}: ${describeSet(set, exercise.trackingType, units)}${tag}`);
  }

  if (exercise.sets.length === 0) lines.push('- no completed sets');

  return lines;
}

/**
 * The routines, rendered exactly as the review document renders them.
 *
 * Exported because the volume advisor needs the same section and nothing else
 * from the document: to say "add three sets of lateral raises to Push A" a model
 * has to know that Push A exists and what is already in it. Reusing this rather
 * than writing a second, shorter routine formatter keeps one description of a
 * routine in the codebase, which matters because the interesting parts of it
 * (prescribed targets, superset grouping, the units on every figure) are exactly
 * the parts a quick reimplementation would drop.
 */
export function buildRoutineSection(report: CoachReport): string {
  return routineSection(report);
}

function routineSection(report: CoachReport): string {
  if (!report.routinesIncluded) {
    return [
      '## Routines',
      '',
      'Left out of this export on purpose. Suggest changes to the sessions themselves instead.',
    ].join('\n');
  }

  if (report.routines.length === 0) {
    return [
      '## Routines',
      '',
      'I have no saved routines: every session above was put together as I went. Say whether a routine would help, and if so write me one.',
    ].join('\n');
  }

  const lines = [
    '## Routines',
    '',
    'These are my saved templates: what I intend to do, as opposed to the sessions above, which are what I did. Point 5 of the brief is about editing these.',
  ];

  for (const routine of report.routines) {
    lines.push('', ...routineLines(routine, report.profile));
  }

  return lines.join('\n');
}

function routineLines(routine: CoachRoutine, units: CoachUnits): string[] {
  const prescribed = routine.exercises.reduce((sum, entry) => sum + entry.sets.length, 0);

  const facts = [
    `${routine.exercises.length} exercise${routine.exercises.length === 1 ? '' : 's'}`,
    `${prescribed} prescribed set${prescribed === 1 ? '' : 's'}`,
    routine.lastPerformedAt ? `last performed ${stamp(routine.lastPerformedAt)}` : 'never performed',
  ];

  const lines = [`### ${routine.name}`, facts.join(' · ')];
  if (routine.notes) lines.push('', quote(routine.notes));

  routine.exercises.forEach((exercise, index) => {
    const context = [
      MUSCLE_GROUP_LABELS[exercise.primaryMuscle],
      EQUIPMENT_LABELS[exercise.equipment].toLowerCase(),
      exercise.supersetGroup != null ? `superset ${exercise.supersetGroup}` : null,
      exercise.restSeconds != null ? `${formatDuration(exercise.restSeconds)} rest` : null,
    ].filter((part): part is string => part !== null);

    lines.push('', `${index + 1}. **${exercise.name}**: ${context.join(', ')}`);
    if (exercise.notes) lines.push(`   Note: ${collapse(exercise.notes)}`);

    if (exercise.sets.length === 0) {
      lines.push('   - no sets prescribed');
      return;
    }

    // Identical consecutive targets are folded into "3 × 8 reps @ 80 kg", which
    // is how the prescription is written everywhere else in lifting. Spelling
    // out four identical lines per exercise tripled the length of this section
    // and buried the one set in it that was different.
    for (const run of runsOf(exercise.sets, sameTarget)) {
      lines.push(`   - ${run.count} × ${describeTarget(run.head, units)}`);
    }
  });

  return lines;
}

function recordSection(report: CoachReport): string {
  if (report.records.length === 0) return '';

  const lines = [
    '## Current personal bests',
    '',
    'All-time, for the exercises I trained in this window. Not limited to the window itself. A best set two years ago is still the number to beat.',
    '',
    '| Exercise | Record | Value | Set on |',
    '| --- | --- | ---: | --- |',
  ];

  for (const record of report.records) {
    lines.push(
      `| ${record.exercise} | ${PR_KIND_LABELS[record.kind]} | ${describeRecord(
        record,
        report.profile,
      )} | ${isoDay(new Date(record.achievedAt))} |`,
    );
  }

  return lines.join('\n');
}

function measurementSection(report: CoachReport): string {
  if (report.measurements.length === 0 && report.bodyweightSeries.length === 0) return '';

  const lines = ['## Body measurements', ''];

  const trend = bodyweightTrend(report);
  if (trend) lines.push(trend, '');

  if (report.measurements.length > 0) {
    lines.push(
      'Most recent of each, whenever it was taken:',
      '',
      '| Measurement | Value | Taken |',
      '| --- | ---: | --- |',
    );

    for (const entry of report.measurements) {
      lines.push(
        `| ${MEASUREMENT_KIND_LABELS[entry.kind]} | ${describeMeasurement(
          entry,
          report.profile,
        )} | ${isoDay(new Date(entry.measuredAt))} |`,
      );
    }
  }

  return lines.join('\n').trimEnd();
}

/**
 * Bodyweight across the window, as one sentence.
 *
 * A gaining or losing phase changes what almost every other criticism in the
 * review should be. Stalled lifts in a deficit are not the same finding as
 * stalled lifts eating over maintenance, so the direction is stated in prose
 * rather than left for a reader to derive from a column of dates.
 */
function bodyweightTrend(report: CoachReport): string | null {
  const series = report.bodyweightSeries;
  const first = series[0];
  const last = series[series.length - 1];
  // Two entries at minimum: one weigh-in is a fact about a day, not a trend,
  // and the sentence below would read "82 kg → 82 kg (unchanged)".
  if (!first || !last || series.length < 2) return null;

  const deltaKg = last.value - first.value;
  const unit = report.profile.weightUnit;

  const direction =
    Math.abs(deltaKg) < 0.05
      ? 'unchanged'
      : `${deltaKg > 0 ? 'up' : 'down'} ${formatWeight(Math.abs(deltaKg), unit)}`;

  return `Bodyweight over the window: ${formatWeight(first.value, unit)} on ${isoDay(
    new Date(first.measuredAt),
  )} → ${formatWeight(last.value, unit)} on ${isoDay(new Date(last.measuredAt))} (${direction} across ${
    series.length
  } weigh-ins).`;
}

/**
 * The footnotes.
 *
 * Every one of these is a rule the numbers above obey that a reader would
 * otherwise have to guess at, and each guess is a specific wrong critique:
 * warm-ups counted as working sets, an unchecked set read as a failed one,
 * push-ups valued at zero because nobody ever entered a bodyweight.
 */
function notesSection(report: CoachReport): string {
  const lines = [
    '## How to read this',
    '',
    '- Only completed sets are here. A set I planned but did not tick off is not in the log at all, so nothing above is a failed attempt unless it says so.',
    '- Warm-up sets are marked `W` and are excluded from every count, total and volume figure. Working sets are numbered, and a set that was a drop set or was taken to failure says so beside it.',
    '- Volume is weight × reps for loaded work. Bodyweight exercises are valued using the bodyweight given above; timed and distance work contributes no volume, so a session of those will show a small volume figure and a real amount of work.',
    '- RPE is only present where I recorded it. Its absence is not a light set.',
  ];

  if (report.profile.bodyweightKg == null) {
    lines.push(
      '- No bodyweight is on record, so every push-up, pull-up and dip below contributes zero volume. Read those by their reps.',
    );
  }

  lines.push(
    '',
    `Exported from Lift on ${stamp(report.generatedAt)} · review format v${COACH_PROMPT_VERSION}`,
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

/**
 * One performed set, as much of it as was recorded.
 *
 * Assembled from the fields that are present rather than switched on the
 * tracking type, because the two disagree more often than they should: an
 * exercise retyped from `weight_reps` to `reps_only` leaves loaded sets in the
 * history, and a set row written by an older build may carry a field its type
 * no longer claims. Printing what is there cannot be wrong; printing what the
 * type promises can.
 */
function describeSet(set: CoachSet, trackingType: TrackingType, units: CoachUnits): string {
  const parts: string[] = [];

  const weight = set.weightKg != null ? formatWeight(set.weightKg, units.weightUnit) : null;
  const load =
    trackingType === 'assisted_bodyweight' && weight ? `−${weight} assistance` : weight;

  if (load && set.reps != null) parts.push(`${load} × ${set.reps}`);
  else if (load) parts.push(load);
  else if (set.reps != null) parts.push(`${set.reps} reps`);

  if (set.distanceKm != null) parts.push(formatDistance(set.distanceKm, units.distanceUnit));
  if (set.durationSeconds != null) parts.push(formatDuration(set.durationSeconds));
  if (set.rpe != null) parts.push(`RPE ${trimNumber(set.rpe)}`);

  return parts.length > 0 ? parts.join(' · ') : 'completed, nothing recorded';
}

/** One prescribed set. Same assembly as a performed one, minus the outcome. */
function describeTarget(target: CoachRoutineTarget, units: CoachUnits): string {
  const parts: string[] = [];

  if (target.reps != null) parts.push(`${target.reps} reps`);
  if (target.weightKg != null) parts.push(`@ ${formatWeight(target.weightKg, units.weightUnit)}`);
  if (target.distanceKm != null) parts.push(formatDistance(target.distanceKm, units.distanceUnit));
  if (target.durationSeconds != null) parts.push(formatDuration(target.durationSeconds));
  // Separated rather than run on, because "8 reps @ 80 kg RPE 9" reads as one
  // phrase in which the RPE could belong to the weight.
  if (target.rpe != null) parts.push(`· RPE ${trimNumber(target.rpe)}`);

  const tag =
    target.setType === 'warmup'
      ? ' (warm-up)'
      : target.setType === 'drop'
        ? ' (drop set)'
        : target.setType === 'failure'
          ? ' (to failure)'
          : '';

  return `${parts.length > 0 ? parts.join(' ') : 'no target set'}${tag}`;
}

/** A record in the unit its kind is actually measured in. */
function describeRecord(record: CoachRecord, units: CoachUnits): string {
  switch (record.kind) {
    case 'heaviest_weight':
      return record.reps != null
        ? `${formatWeight(record.value, units.weightUnit)} × ${record.reps}`
        : formatWeight(record.value, units.weightUnit);
    case 'best_1rm':
      return formatWeight(record.value, units.weightUnit);
    case 'best_set_volume':
    case 'best_session_volume':
      return formatVolume(record.value, units.weightUnit);
    case 'most_reps':
      return `${record.value} reps`;
    case 'best_duration':
      return formatDuration(record.value);
    case 'best_distance':
      return formatDistance(record.value, units.distanceUnit);
  }
}

/** A measurement in the unit its kind is stored in: kg, percent or cm. */
function describeMeasurement(entry: CoachMeasurement, units: CoachUnits): string {
  switch (MEASUREMENT_KIND_META[entry.kind].scale) {
    case 'weight':
      return formatWeight(entry.value, units.weightUnit);
    case 'percent':
      return `${trimNumber(entry.value)}%`;
    case 'length':
      return formatMeasure(entry.value, units.measurementUnit);
  }
}

/**
 * A length in the user's measurement unit.
 *
 * `formatMeasurement` in `units.ts` would do this, but it is one decimal and a
 * unit suffix (the same thing) and importing it here alongside four other
 * formatters from the same module for a two-line conversion was the whole of
 * its usefulness. This exists so the height line and the measurement table
 * cannot round differently.
 */
function formatMeasure(cm: number, unit: MeasurementUnit): string {
  const value = unit === 'cm' ? cm : cm / 2.54;
  return `${trimNumber(value)} ${unit}`;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** The weekdays, in English, because the document is written in English. */
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * `2026-04-14 (Tue)`. A date that cannot be misread.
 *
 * Deliberately not the locale date the app prints everywhere else. `04/06/2026`
 * is two different days depending on where the reader learned to read dates,
 * and the reader here is a model summarising a hundred of them into a claim
 * about training frequency. The weekday is spelled out beside it because the
 * shape of a training week (which days are trained, which are rest) is one of
 * the things being reviewed, and nobody derives that from a numeric date.
 */
function stamp(ms: number): string {
  const date = new Date(ms);
  return `${isoDay(date)} (${WEEKDAYS[date.getDay()]})`;
}

/** Local `YYYY-MM-DD`. Local, so a 9pm session belongs to the day the user had. */
function isoDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function describeSpan(report: CoachReport): string {
  const to = isoDay(new Date(report.to - 1));
  return report.from == null
    ? `everything logged, up to ${to}`
    : `${isoDay(new Date(report.from))} to ${to} inclusive`;
}

/**
 * One decimal, and none at all on a whole number.
 *
 * Weekly rates are averages and the indirect-set discount is a half, so the
 * decimal carries meaning, but "12.0 sets" in a table of counts reads as a
 * precision the figure does not have.
 */
function oneDecimal(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** `8.5` stays, `8.0` becomes `8`. For RPE, percentages and lengths. */
function trimNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * Free text as a Markdown blockquote.
 *
 * Every newline is quoted, not just the first: an unquoted second line reopens
 * the document at body level, and a session note that happens to start a line
 * with `#` would otherwise become a heading and swallow everything under it
 * into the wrong section.
 */
function quote(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`.trimEnd())
    .join('\n');
}

/** Free text on one line, for the places a blockquote would break the list. */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Collapses adjacent equivalent items into "the first one, this many times".
 *
 * Returns the head rather than the whole run because that is all a "3 × 8 reps"
 * line needs, and because a run of identical rows has nothing else in it.
 */
function runsOf<T>(
  items: readonly T[],
  same: (a: T, b: T) => boolean,
): { head: T; count: number }[] {
  const runs: { head: T; count: number }[] = [];

  for (const item of items) {
    const current = runs[runs.length - 1];
    if (current && same(current.head, item)) current.count += 1;
    else runs.push({ head: item, count: 1 });
  }

  return runs;
}

function sameTarget(a: CoachRoutineTarget, b: CoachRoutineTarget): boolean {
  return (
    a.setType === b.setType &&
    a.reps === b.reps &&
    a.weightKg === b.weightKg &&
    a.rpe === b.rpe &&
    a.durationSeconds === b.durationSeconds &&
    a.distanceKm === b.distanceKm
  );
}
