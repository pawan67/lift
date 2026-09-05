import { Ionicons } from '@expo/vector-icons';
import {
  formatDuration,
  isWorkingSet,
  reorder,
  TRACKING_FIELDS,
  detectPrs,
  normalizeSupersets,
  type PositionedRow,
  type SetType,
  type SupersetAssignment,
} from '@lift/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router, Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Button,
  Divider,
  EmptyState,
  HeaderAction,
  ReorderSheet,
  Screen,
  Text,
  useScrollEdge,
  type ReorderItem,
} from '@/components/ui';
import { db } from '@/db/client';
import {
  exercises as exercisesTable,
  routineExercises,
  routineSets,
  workoutExercises,
  workoutSets,
  workouts,
  type WorkoutSet,
} from '@/db/schema';
import { haptics } from '@/features/feedback/haptics';
import { setExerciseUnits } from '@/features/exercises/repository';
import { clearSessionNotice, prepareLiveNotice } from '@/features/notifications/live';
import { ExerciseDemoSheet } from '@/features/exercises/exercise-demo-sheet';
import { ExerciseBlock } from '@/features/workouts/exercise-block';
import { CollapsedLift, SupersetGroup } from '@/features/workouts/collapsed-lift';
import {
  defaultExpandedUnit,
  groupLiftUnits,
  unitIsComplete,
} from '@/features/workouts/lift-units';
import { ghostFill, pairedPreviousSet } from '@/features/workouts/previous';
import {
  cancelRestNotification,
  prepareRestNotifications,
  scheduleRestNotification,
  sweepRestNotifications,
} from '@/features/notifications/rest';
import { RestDurationSheet } from '@/features/workouts/rest-duration-sheet';
import { SessionInsightsSheet } from '@/features/workouts/session-insights-sheet';
import { REST_BAR_HEIGHT, RestTimerBar } from '@/features/workouts/rest-timer-bar';
import { RestTimerSheet } from '@/features/workouts/rest-timer-sheet';
import {
  addExerciseToWorkout,
  addSet,
  applyExerciseOrder,
  applySupersetGroups,
  canLogSet,
  deleteSet,
  discardWorkout,
  getPreviousPerformance,
  getPreviousBests,
  hasRestOverride,
  removeExerciseFromWorkout,
  resolveRestSeconds,
  restAfterSet,
  setExerciseRest,
  substituteExercise,
  updateSet,
  type PreviousPerformance,
  type SetInput,
  type WorkoutExerciseDetail,
} from '@/features/workouts/repository';
import { showSupersetMenu, supersetMap } from '@/features/workouts/superset';
import type { ProgressionInput } from '@/features/workouts/suggestion';
import { useWriteGuard } from '@/features/workouts/use-write-guard';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { useTicker } from '@/hooks/use-ticker';
import { showAlert, showConfirm } from '@/store/dialog';
import { Confetti } from '@/components/celebration/confetti';
import { useExercisePicker, usePickedExercises } from '@/store/exercise-picker';
import { useNoticeRequest } from '@/store/notice-request';
import { useSettings } from '@/store/settings';
import { useTimer } from '@/store/timer';
import { spacing, timing, useColors } from '@/theme';

/** This screen's name on the picker's hand-off channel. */
const PICKER_ADDRESS = 'active-workout';

/**
 * How long a record burst is on screen, and therefore how long it is mounted.
 *
 * Shorter than the summary screen's 3200ms. That burst is the screen's subject
 * and can take its time; this one falls over a session that is still being
 * logged, and the next set is often already being loaded onto the bar while it
 * runs. Long enough to read as a celebration, short enough that the screen is
 * clear before the thumb comes back.
 */
const RECORD_BURST_MS = 2400;

export default function ActiveWorkoutScreen() {
  const scrollEdge = useScrollEdge();

  /*
   * The record burst, counted rather than triggered.
   *
   * Zero is "no burst on screen" and every record bumps it, which gives
   * `Confetti` the `runKey` it reseeds its particles from: two records in one
   * session are two different falls rather than the same one replayed. It is
   * put back to zero when the run is over, so a screen that is open for an
   * hour is not holding forty-odd particle views for the fifty-nine minutes
   * after the burst finished.
   *
   * This replaced `react-native-confetti-cannon`, which was mounted for the
   * life of the session, fired through an imperative ref, and had no reduce-
   * motion path at all: the one celebration in the app that ignored the
   * setting, on the screen where it fires most. `Confetti` is the same burst
   * the summary screen already uses, so a record looks the same when it lands
   * as it does when the session is read back.
   */
  const [recordBurst, setRecordBurst] = useState(0);
  const reduceMotion = useReduceMotion();

  const colors = useColors();

  /*
   * Gold-led, and the same four colours the summary screen falls in. A record
   * is one event with one look, whether it is met as it happens or read back
   * afterwards.
   */
  const recordColors = useMemo(
    () => [colors.record, colors.warning, colors.success, colors.accent],
    [colors],
  );
  const insets = useSafeAreaInsets();
  // Only ever one live session, so this screen is a singleton and needs no id
  // in its address. Unlike the routine editor, which has one instance per
  // routine and has to say which one it is.
  const pendingExerciseIds = usePickedExercises(PICKER_ADDRESS);
  const clearPendingExercises = useExercisePicker((state) => state.clear);
  const openPicker = useExercisePicker((state) => state.open);

  const settings = useSettings();
  const startRest = useTimer((state) => state.startRest);
  const { guard, lostWrites } = useWriteGuard();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  /*
   * The hand-off between one lift and the next.
   *
   * `advanceTo` holds the unit the screen owes the reader a scroll to, and it
   * is a ref rather than state on purpose: nothing renders differently because
   * of it, and putting it in state would re-render every block on the screen to
   * record an intention that is spent one layout pass later.
   *
   * It is only ever set by the *automatic* advance, never by a tap on a
   * collapsed lift. Someone who reaches down the list and opens a block has
   * already put their eye where they want it, and scrolling under them there
   * would be the app arguing with the gesture.
   */
  const advanceTo = useRef<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const [demo, setDemo] = useState<{
    name: string;
    thumbnailUrl: string | null;
    videoUrl: string | null;
  } | null>(null);

  /*
   * Take the burst down once it has landed.
   *
   * Without this the particles stay mounted for the rest of the session,
   * finished and invisible but still forty-four views deep in a screen whose
   * whole job is staying responsive between sets. A second record inside the
   * window restarts this timer along with the fall, which is what should
   * happen: the run is one burst that got extended, not two overlapping.
   */
  useEffect(() => {
    if (recordBurst === 0) return;
    const done = setTimeout(() => setRecordBurst(0), RECORD_BURST_MS);
    return () => clearTimeout(done);
  }, [recordBurst]);

  /*
   * The advance expires if nothing claims it.
   *
   * `advanceTo` is spent by the next layout of the unit it names, and a layout
   * is not a thing this screen can promise: an expand that changes neither the
   * unit's height nor its position fires no event, and the intention would sit
   * in the ref until some unrelated edit re-laid that block out and scrolled
   * the user somewhere they had not asked to go, minutes later. Half a second
   * is many frames longer than the layout it is waiting on and far short of
   * anything a user would connect to the set they just logged.
   */
  useEffect(() => {
    const owed = advanceTo.current;
    if (owed === null) return;
    const lapse = setTimeout(() => {
      if (advanceTo.current === owed) advanceTo.current = null;
    }, 500);
    return () => clearTimeout(lapse);
  }, [expandedId]);

  /*
   * Keeps the screen on mid-set so the phone doesn't lock between reps.
   *
   * Not `useKeepAwake`: its tag argument is only a tag. It falls back to
   * `useId()` and activates either way, so the obvious-looking
   * `useKeepAwake(on ? tag : undefined)` kept the screen awake with the
   * setting off. The setting has to gate the call itself.
   *
   * Deactivation is caught because releasing a tag that is not held rejects on
   * native, and the settings store mounts with defaults before it hydrates from
   * SQLite, so a user who has this off still runs one activate/deactivate pair
   * on the way in.
   */
  useEffect(() => {
    if (!settings.keepAwakeDuringWorkout) return;
    activateKeepAwakeAsync('active-workout').catch(() => {});
    return () => {
      deactivateKeepAwake('active-workout').catch(() => {});
    };
  }, [settings.keepAwakeDuringWorkout]);

  const { data: activeRows = [] } = useLiveQuery(
    db
      .select()
      .from(workouts)
      .where(and(isNull(workouts.finishedAt), isNull(workouts.deletedAt))),
  );

  const workout = activeRows[0];
  const workoutId = workout?.id ?? '';

  const { data: links = [] } = useLiveQuery(
    db
      .select()
      .from(workoutExercises)
      .where(
        and(eq(workoutExercises.workoutId, workoutId), isNull(workoutExercises.deletedAt)),
      )
      .orderBy(asc(workoutExercises.position)),
    [workoutId],
  );

  const linkIds = links.map((link) => link.id);
  const linkKey = linkIds.join(',');

  const { data: sets = [] } = useLiveQuery(
    db
      .select()
      .from(workoutSets)
      // An empty IN () is invalid SQL, so fall back to a sentinel that matches nothing.
      .where(
        and(
          inArray(workoutSets.workoutExerciseId, linkIds.length > 0 ? linkIds : ['__none__']),
          isNull(workoutSets.deletedAt),
        ),
      )
      .orderBy(asc(workoutSets.position)),
    [linkKey],
  );

  /*
   * Only the exercises this workout uses.
   *
   * This was an unfiltered `select().from(exercisesTable)`: all ~6,800 catalog
   * rows marshalled out of SQLite to look up the six the session contains, and
   * `details` below rebuilt a 6,800-entry Map from them on every set edit
   * (measured at 0.87ms on desktop V8, several times that on device). The
   * screen needs a handful of rows; now it asks for a handful.
   */
  const exerciseIds = links.map((link) => link.exerciseId);
  const exerciseIdsKey = exerciseIds.join(',');

  const { data: workoutExerciseRows = [] } = useLiveQuery(
    db
      .select()
      .from(exercisesTable)
      .where(inArray(exercisesTable.id, exerciseIds.length > 0 ? exerciseIds : ['__none__'])),
    [exerciseIdsKey],
  );

  const details = useMemo<WorkoutExerciseDetail[]>(() => {
    const exerciseById = new Map(workoutExerciseRows.map((row) => [row.id, row]));
    const setsByParent = new Map<string, WorkoutSet[]>();

    for (const set of sets) {
      const bucket = setsByParent.get(set.workoutExerciseId);
      if (bucket) bucket.push(set);
      else setsByParent.set(set.workoutExerciseId, [set]);
    }

    return links.flatMap((link) => {
      const exercise = exerciseById.get(link.exerciseId);
      if (!exercise) return [];
      return [{ workoutExercise: link, exercise, sets: setsByParent.get(link.id) ?? [] }];
    });
  }, [links, sets, workoutExerciseRows]);

  /*
   * The rows the superset logic reads: grouping and order, nothing else.
   *
   * Keyed by `workoutExercise.id` rather than by the exercise's, because the
   * same lift can legitimately appear twice in one session and only one of the
   * two may be in the superset.
   *
   * Computed here rather than next to the list so `handleToggleSet` can read
   * `units` from the callback instead of a ref written during render, which
   * `react-hooks/refs` rejects.
   */
  const supersetRows = useMemo(
    () =>
      details.map((detail) => ({
        id: detail.workoutExercise.id,
        name: detail.exercise.name,
        supersetGroup: detail.workoutExercise.supersetGroup,
      })),
    [details],
  );

  const placements = useMemo(() => supersetMap(supersetRows), [supersetRows]);
  const units = useMemo(() => groupLiftUnits(details, placements), [details, placements]);

  // Previous-session values for the ghost column, loaded once per exercise.
  const [previousByExercise, setPreviousByExercise] = useState<Record<string, PreviousPerformance>>(
    {},
  );
  
  const [bestsByExercise, setBestsByExercise] = useState<
    Record<string, Awaited<ReturnType<typeof getPreviousBests>>>
  >({});

  const exerciseIdKey = details.map((detail) => detail.exercise.id).join(',');

  useEffect(() => {
    if (!workoutId) return;
    let cancelled = false;

    void (async () => {
      const ids = exerciseIdKey.split(',').filter(Boolean);
      const perfEntries = await Promise.all(
        ids.map(
          async (id) =>
            [id, await getPreviousPerformance(id, { excludeWorkoutId: workoutId })] as const,
        ),
      );
      const bestsEntries = await Promise.all(
        ids.map(
          async (id) => [id, await getPreviousBests(id)] as const,
        ),
      );
      
      if (!cancelled) {
        setPreviousByExercise(Object.fromEntries(perfEntries));
        setBestsByExercise(Object.fromEntries(bestsEntries));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [exerciseIdKey, workoutId]);

  const recordSetIds = useMemo(() => {
    const ids = new Set<string>();
    for (const detail of details) {
      const bests = bestsByExercise[detail.exercise.id];
      if (!bests) continue;
      
      const ctx = {
        trackingType: detail.exercise.trackingType,
        bodyweightKg: settings.bodyweightKg ?? undefined,
        formula: settings.oneRepMaxFormula,
      };
      
      // `detectPrs` needs completed sets to find PRs.
      // Uncompleted sets won't count.
      const prs = detectPrs(detail.sets, ctx, bests);
      for (const pr of prs) {
        if (pr.setIndex !== null) {
          const setId = detail.sets[pr.setIndex]?.id;
          if (setId) ids.add(setId);
        }
      }
    }
    return ids;
  }, [details, bestsByExercise, settings.bodyweightKg, settings.oneRepMaxFormula]);

  /*
   * What the routine asks for, when the session was started from one.
   *
   * The rep range a suggestion works in is otherwise read back out of what the
   * user has been doing (`inferRepRange`), which is right for a session started
   * from nothing and wrong for one started from a plan: a routine that says
   * 3 × 5 is not asking to be walked up to twelve because last month's history
   * happens to read that way. The prescription wins where there is one.
   *
   * Live rather than fetched once, only because every other read on this screen
   * is. The routine tables are not written during a session, so this emits
   * once and then sits still.
   */
  const routineId = workout?.routineId ?? '';

  const { data: routineTargets = [] } = useLiveQuery(
    db
      .select({
        exerciseId: routineExercises.exerciseId,
        setType: routineSets.setType,
        targetReps: routineSets.targetReps,
      })
      .from(routineSets)
      .innerJoin(routineExercises, eq(routineSets.routineExerciseId, routineExercises.id))
      // No routine behind this session is the common case, so it gets the same
      // sentinel every other query here uses rather than a conditional hook.
      .where(
        and(
          eq(routineExercises.routineId, routineId || '__none__'),
          isNull(routineExercises.deletedAt),
          isNull(routineSets.deletedAt),
        ),
      )
      .orderBy(asc(routineSets.position)),
    [routineId],
  );

  /**
   * Everything the progression engine is allowed to see, per exercise.
   *
   * Assembled here rather than in the block so the block is handed a value and
   * not a query, and so the session editor (which shares that block) can
   * simply not pass one. Keyed off the loaded history: an exercise whose
   * sessions have not arrived yet has no entry, and no line renders.
   */
  const progressionByExercise = useMemo(() => {
    const prescribed = new Map<string, number>();

    for (const target of routineTargets) {
      // Working sets only, and the first one wins. A warm-up's five is not the
      // range the working sets live in, and "3 × 8" is a routine asking for
      // eight however many rows it spells that across.
      if (target.targetReps == null || !isWorkingSet(target.setType)) continue;
      if (!prescribed.has(target.exerciseId)) prescribed.set(target.exerciseId, target.targetReps);
    }

    const byExercise: Record<string, ProgressionInput> = {};
    for (const [exerciseId, previous] of Object.entries(previousByExercise)) {
      byExercise[exerciseId] = {
        sessions: previous.sessions,
        targetReps: prescribed.get(exerciseId) ?? null,
      };
    }

    return byExercise;
  }, [previousByExercise, routineTargets]);

  /*
   * The slot a picker trip is meant to replace, when it is one.
   *
   * A ref rather than state, and held here rather than sent to the picker. The
   * picker is deliberately ignorant of who opened it, so the caller has to
   * remember what it asked for; and a re-render between "open the picker" and
   * "the ids arrived" would re-run the effect below against the same pending
   * list, which is how you end up adding an exercise twice.
   */
  const replacingLinkId = useRef<string | null>(null);

  // Exercises chosen in the picker arrive through the hand-off store.
  useEffect(() => {
    if (pendingExerciseIds.length === 0 || !workoutId) return;

    const replacing = replacingLinkId.current;
    replacingLinkId.current = null;

    guard(
      (async () => {
        const ids = [...pendingExerciseIds];

        // A replacement consumes one choice. Anything else tapped in the same
        // trip is still an exercise the user asked for, so it lands normally
        // rather than being thrown away.
        if (replacing) {
          const first = ids.shift();
          if (first) await substituteExercise(replacing, first);
        }

        for (const id of ids) {
          const created = await addExerciseToWorkout(workoutId, id);
          await addSet(created.id);
        }
        clearPendingExercises(PICKER_ADDRESS);
      })(),
    );
  }, [pendingExerciseIds, workoutId, clearPendingExercises, guard]);

  // Ask once when the logging screen first opens, rather than at app launch.
  // The permission prompt makes far more sense in context. The stale-bell sweep
  // rides along for the same reason: it needs the same "we are in a session"
  // moment, and moving it to bootstrap would drag notification setup back to
  // app start, which is what asking in context was avoiding.
  useEffect(() => {
    if (settings.restTimerEnabled && settings.restTimerNotifications) {
      void (async () => {
        await prepareRestNotifications();
        await sweepRestNotifications();
      })();
    }
  }, [settings.restTimerEnabled, settings.restTimerNotifications]);

  /*
   * The second permission this screen asks for, and the only other place in the
   * app that asks for anything.
   *
   * Separate from the block above because it is a different question with a
   * different consequence. That one is "may we ring a bell", and refusing it
   * silences the rest timer. This one is ACTIVITY_RECOGNITION, the runtime half
   * of Android's `health` foreground-service type, and refusing it costs only
   * the session notification's protection from being killed in the background:
   * the notification, its live countdown and its buttons all still work. So it
   * is not gated on a setting: there is no feature to turn off behind it.
   *
   * Unconditional on the other platforms too, where it resolves false without
   * asking anyone anything.
   */
  useEffect(() => {
    void prepareLiveNotice();
  }, []);

  /*
   * How much of the session is done, in one pass.
   *
   * Both figures rather than only the completed count, because the masthead now
   * states progress as a fraction and draws it as a line, and "12" on its own
   * answers a question nobody has mid-workout. Warm-ups are counted: they are
   * sets you have to get through before the working ones, and leaving them out
   * makes the line lurch when a block's first two rows check off in ten seconds.
   */
  const { completedSets, totalSets } = useMemo(() => {
    let completed = 0;
    let total = 0;

    for (const detail of details) {
      for (const set of detail.sets) {
        total += 1;
        if (set.isCompleted) completed += 1;
      }
    }

    return { completedSets: completed, totalSets: total };
  }, [details]);

  /*
   * Set ids whose weight the user emptied by hand.
   *
   * A cleared field and one that was never touched are the same null in the
   * row, but only the untouched one means "same as last time". Every field edit
   * funnels through the one handler below, so this is the only place that can
   * tell the two apart. It resets if the screen unmounts, which degrades to the
   * old behaviour rather than to a new failure.
   *
   * Recorded for every tracking type, not just the ones where it changes an
   * outcome: the bookkeeping is a set insert, and keeping it type-blind means
   * "when does an empty box mean something?" is answered in exactly one place,
   * where the ghost is committed.
   */
  const clearedWeights = useRef<Set<string>>(new Set());

  const handleUpdateSet = useCallback(
    (setId: string, patch: Partial<WorkoutSet>) => {
      if ('weightKg' in patch) {
        if (patch.weightKg === null) clearedWeights.current.add(setId);
        else clearedWeights.current.delete(setId);
      }
      guard(updateSet(setId, patch));
    },
    [guard],
  );

  const handleToggleSet = useCallback(
    (set: WorkoutSet, detail: WorkoutExerciseDetail): Promise<boolean> => {
      if (set.isCompleted) {
        return guard(updateSet(set.id, { isCompleted: false }));
      }

      const fields = TRACKING_FIELDS[detail.exercise.trackingType];
      const previous = pairedPreviousSet(
        detail.sets,
        previousByExercise[detail.exercise.id]?.sets,
        set,
      );

      // `canLogSet` is the whole acceptance rule, and the set row runs the same
      // call to decide whether to tint before the write returns. Asking it here
      // rather than restating it is what keeps the plate and the screen from
      // disagreeing about which taps land.
      if (!canLogSet(fields, set, previous)) {
        haptics.rejected();
        return Promise.resolve(false);
      }

      // Commit the ghost: the numbers the user was looking at as placeholders
      // are written by the same tap that reads them. It folds into the *same*
      // `updateSet` as `isCompleted`, so the row tints and the digits land in
      // one live-query pass rather than two. See `ghostFill`.
      const patch: SetInput = { isCompleted: true };
      const fill = ghostFill(
        detail.exercise.trackingType,
        previous,
        clearedWeights.current.has(set.id),
      );

      /*
       * Everything the user can perceive happens before the write.
       *
       * The rest clock is the reason: it used to start after four SQLite
       * statements and a live-query round trip, so the countdown was already
       * behind the moment it appeared. Nothing here waits on the write: it goes
       * out through `guard`, whose outcome only the row consumes, to put its
       * plate back if the write never landed.
       */
      haptics.logged();

      // The live query has not refreshed yet, so "is the exercise finished?" is
      // answered from the rows already in hand plus the write just made: every
      // other set complete means this check was the last one.
      const finishesExercise =
        detail.sets.length > 0 &&
        detail.sets.every((other) => other.id === set.id || other.isCompleted);

      // Closing out an exercise used to raise a stats card over the screen. It
      // was information nobody had asked for, at the one moment the user is
      // mid-flow and reaching for the next set: the summary screen already
      // says all of it, afterwards, when there is time to read it. What is left
      // is a heavier tap than a set gets, and the block marking itself done in
      // place: the milestone is still acknowledged, it just no longer interrupts.
      if (finishesExercise) haptics.finished();

      const unit = units.find((entry) =>
        entry.members.some((member) => member.workoutExercise.id === detail.workoutExercise.id),
      );
      if (unit) {
        const finishesUnit = unit.members.every((member) => {
          if (member.sets.length === 0) return false;
          if (member.workoutExercise.id === detail.workoutExercise.id) {
            return member.sets.every((other) => other.id === set.id || other.isCompleted);
          }
          return member.sets.every((other) => other.isCompleted);
        });
        if (finishesUnit) {
          const index = units.findIndex((entry) => entry.id === unit.id);
          const next = units.slice(index + 1).find((entry) => !unitIsComplete(entry));
          if (next) {
            setExpandedId(next.id);
            /*
             * And take the eye to it. See `advanceTo`.
             *
             * The expand on its own moves the page out from under the thumb:
             * the block just finished collapses from a table of five rows to
             * one line, and the next opens somewhere below the fold, so the
             * hand that has just checked off the last set of the squat is
             * looking at whatever happened to slide into that space. The
             * scroll is what turns a re-layout into a hand-off.
             */
            advanceTo.current = next.id;
          }
        }
      }

      if (settings.restTimerEnabled && settings.restTimerAutoStart) {
        // Scaled to the set just performed, not to the exercise: a warm-up is
        // capped and a set followed by a drop gets none at all. The kind rides
        // along so the bar can name the short number instead of looking broken.
        const plan = restAfterSet(detail, set, settings.defaultRestSeconds);

        if (plan.seconds > 0) {
          startRest(plan.seconds, {
            setId: set.id,
            exerciseId: detail.exercise.id,
            exerciseName: detail.exercise.name,
            kind: plan.kind,
          });

          // The in-app countdown only runs while foregrounded, so back it with a
          // scheduled notification for when the phone goes in a pocket.
          if (settings.restTimerNotifications) {
            void scheduleRestNotification(plan.seconds, detail.exercise.name);
          }
        } else {
          // `startRest` no-ops on a non-positive duration rather than clearing
          // what is running, so "no rest" has to be said explicitly or the
          // previous set's countdown sits over the drop.
          useTimer.getState().stopRest();
          void cancelRestNotification();
        }
      }

      const bests = bestsByExercise[detail.exercise.id];
      if (bests) {
        const fakedSets = detail.sets.map((s) =>
          s.id === set.id ? { ...s, isCompleted: true, ...fill } : s,
        );
        const prs = detectPrs(
          fakedSets,
          {
            trackingType: detail.exercise.trackingType,
            bodyweightKg: settings.bodyweightKg ?? undefined,
            formula: settings.oneRepMaxFormula,
          },
          bests,
        );
        if (prs.some((pr) => pr.setIndex !== null && fakedSets[pr.setIndex].id === set.id)) {
          /*
           * The record gets weight as well as colour.
           *
           * The burst was carrying the whole announcement, and a burst is the
           * one part of it a phone in a pocket or a hand mid-rack cannot
           * deliver: the set was already checked off with `logged`, which is
           * the same cue the forty ordinary sets around it get, so a record
           * felt like an ordinary set to the thumb that logged it. `finished`
           * is the heavier cue the vocabulary already keeps for closing
           * something out, and the guard is what stops the last set of an
           * exercise firing it twice in the same frame.
           */
          if (!finishesExercise) haptics.finished();
          // Reduce motion drops the fall and keeps the haptic: the cue is not
          // motion, and it is the half of the announcement that still works
          // with the phone face down on the bench.
          if (!reduceMotion) setRecordBurst((run) => run + 1);
        }
      }

      return guard(updateSet(set.id, patch, fill));
    },
    [settings, startRest, previousByExercise, bestsByExercise, guard, units, reduceMotion],
  );

  /*
   * "Complete set", pressed on the ongoing notification.
   *
   * The notification cannot do this itself (see `store/notice-request`) so it
   * raises a flag and this screen, which owns `handleToggleSet` and everything
   * that hangs off it, answers with the identical path a tap on the row takes.
   * The set chosen is the first unchecked one in exercise order, which is the
   * same one `exercise-block` puts a plate calculation under: the set the user
   * is walking to the rack to do.
   *
   * Subscribed rather than read in an effect: answering calls `setState`, and
   * doing that in the effect body is a cascading render. The flag is taken
   * before anything else can run, so a re-render mid-write cannot tick a second
   * set. If nothing is unchecked the flag is still consumed: the workout is
   * finished, and the request has been answered by there being nothing to
   * answer it with.
   */
  useEffect(() => {
    const answer = () => {
      if (!useNoticeRequest.getState().takeCompleteSet()) return;

      for (const detail of details) {
        const next = detail.sets.find((set) => !set.isCompleted);
        if (next) {
          void handleToggleSet(next, detail);
          return;
        }
      }
    };

    // The notification can fire before this screen is mounted. Subscribe only
    // sees later flips, so a flag already waiting is drained once here.
    if (useNoticeRequest.getState().completeSet) queueMicrotask(answer);

    return useNoticeRequest.subscribe((state, prev) => {
      if (state.completeSet && !prev.completeSet) answer();
    });
  }, [details, handleToggleSet]);

  // Which exercise's rest is being edited, held by `workoutExercises.id` rather
  // than by the row itself so the sheet re-reads the live query's latest copy.
  const [restEditorId, setRestEditorId] = useState<string | null>(null);
  const restEditorDetail = details.find((detail) => detail.workoutExercise.id === restEditorId);

  const openUnitId =
    expandedId && units.some((unit) => unit.id === expandedId)
      ? expandedId
      : (defaultExpandedUnit(units)?.id ?? null);

  const applySupersets = useCallback(
    (writes: SupersetAssignment[]) => {
      if (writes.length === 0) return;
      guard(applySupersetGroups(writes));
    },
    [guard],
  );

  const [reordering, setReordering] = useState(false);

  // Names and set counts only. The sheet reorders a list of labels, and what
  // makes a block recognisable there is what it is called and how much of it
  // there is: not the weights, which is what the screen behind it is for.
  const reorderItems = useMemo<ReorderItem[]>(
    () =>
      details.map((detail) => ({
        id: detail.workoutExercise.id,
        label: detail.exercise.name,
        detail: `${detail.sets.length} ${detail.sets.length === 1 ? 'set' : 'sets'}`,
      })),
    [details],
  );

  /**
   * Writes the order the sheet came back with.
   *
   * The arithmetic is `reorder()`'s, one hop at a time: the sheet reports a
   * final order, and replaying it as a sequence of single moves is what keeps
   * the common case to one row written instead of renumbering the session. The
   * working copy is kept in step as it goes so each hop is computed against the
   * positions the one before it produced, not against the positions on screen
   * when the sheet opened.
   */
  const handleReorder = useCallback(
    (orderedIds: string[]) => {
      setReordering(false);

      let rows: PositionedRow[] = details.map((detail) => ({
        id: detail.workoutExercise.id,
        position: detail.workoutExercise.position,
      }));

      const writes: PositionedRow[] = [];

      orderedIds.forEach((id, target) => {
        const from = rows.findIndex((row) => row.id === id);
        if (from === -1 || from === target) return;

        const moved = reorder(rows, from, target);
        if (moved.length === 0) return;

        const byId = new Map(moved.map((row) => [row.id, row.position]));
        rows = rows
          .map((row) => ({ ...row, position: byId.get(row.id) ?? row.position }))
          .sort((a, b) => a.position - b.position);

        writes.push(...moved);
      });

      if (writes.length === 0) return;

      haptics.selection();
      // Last write wins per row: a row nudged twice while replaying the hops
      // only needs the position it ended on.
      const final = new Map(writes.map((write) => [write.id, write]));
      guard(applyExerciseOrder([...final.values()]));

      /*
       * A drag is a superset control whether or not it meant to be: dropping an
       * exercise between two halves of a pair leaves two lifts carrying a group
       * id with something standing between them, which is no longer a superset.
       * `rows` is already in the order the sheet produced, so the grouping is
       * read back off it and whatever no longer holds is cleared.
       *
       * Usually this writes nothing, and `applySupersetGroups` returns without
       * a statement.
       */
      const groups = new Map(
        details.map((detail) => [detail.workoutExercise.id, detail.workoutExercise.supersetGroup]),
      );

      applySupersets(
        normalizeSupersets(
          rows.map((row) => ({ id: row.id, supersetGroup: groups.get(row.id) ?? null })),
        ),
      );
    },
    [details, guard, applySupersets],
  );

  // The exercise the running timer belongs to, so the bar can show and edit
  // that exercise's rest rather than the app default.
  const restExerciseId = useTimer((state) => state.restExerciseId);
  const restingDetail = details.find((detail) => detail.exercise.id === restExerciseId);

  const [timerSheetOpen, setTimerSheetOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);

  /*
   * Whether the docked bar is occupying the bottom of the screen.
   *
   * A boolean selector rather than the clock itself: this re-renders the whole
   * logging screen, so it has to change twice a rest period. When the
   * countdown starts and when it clears, and never once a second. It exists
   * only to reserve scroll room, because the bar floats over the list rather
   * than sitting in it, and the last thing in that list is Discard workout.
   */
  const resting = useTimer(
    (state) => state.restEndsAt !== null || state.restPausedSeconds !== null,
  );

  const handleSaveRest = useCallback(
    (seconds: number | null) => {
      const detail = restEditorDetail;
      setRestEditorId(null);
      if (!detail) return;

      const before = resolveRestSeconds(detail, settings.defaultRestSeconds);
      const after = seconds ?? settings.defaultRestSeconds;

      guard(setExerciseRest(detail.workoutExercise.id, detail.exercise.id, seconds));

      // A timer already running for this exercise moves by the difference rather
      // than restarting: time already rested is still time rested, and someone
      // who stretches 2:00 to 3:00 halfway through means "a minute more", not
      // "start again".
      const timer = useTimer.getState();
      if (timer.restExerciseId === detail.exercise.id && timer.restEndsAt !== null) {
        timer.adjustRest(after - before);

        const next = useTimer.getState().restEndsAt;
        if (settings.restTimerNotifications && next !== null) {
          void scheduleRestNotification(Math.ceil((next - Date.now()) / 1000), detail.exercise.name);
        } else {
          void cancelRestNotification();
        }
      }
    },
    [restEditorDetail, settings.defaultRestSeconds, settings.restTimerNotifications, guard],
  );

  /*
   * Finishing and discarding both leave the screen, so both are latched.
   *
   * The ref is what actually closes the door. A second tap arrives before any
   * state has re-rendered, and the state exists so the header can dim and say
   * the session is on its way out rather than looking untouched.
   */
  const closingRef = useRef(false);
  const [closing, setClosing] = useState(false);

  /*
   * Finish now *goes* somewhere rather than doing something.
   *
   * It used to raise a confirmation dialog and write the session on its OK,
   * which is a modal asking "are you sure?" about the one thing the user came
   * here to do, and it was also the only place the app admitted that unchecked
   * sets get dropped. Both belong on a screen with room for them, so the review
   * screen owns the confirmation, the name, the note and the write, and this is
   * a plain push.
   *
   * The empty-session check stays here anyway. It is two lines and it is the
   * difference between a rejection at the button the user pressed and a
   * rejection on a screen they were pushed to for no reason; the review screen
   * repeats it as a backstop for the session that empties underneath it.
   */
  const handleFinish = useCallback(() => {
    if (!workout || closingRef.current) return;

    const anyCompleted = details.some((detail) => detail.sets.some((set) => set.isCompleted));
    if (!anyCompleted) {
      haptics.rejected();
      void showAlert('Nothing logged', 'Complete at least one set before finishing.');
      return;
    }

    router.push('/workout/save');
  }, [workout, details]);

  const handleDiscard = useCallback(() => {
    if (!workout || closingRef.current) return;

    void (async () => {
      const confirmed = await showConfirm({
        title: 'Discard workout',
        message: 'This session will be deleted permanently.',
        confirmLabel: 'Discard',
      });
      if (!confirmed || closingRef.current) return;

      closingRef.current = true;
      setClosing(true);

      try {
        await discardWorkout(workout.id);
        useTimer.getState().stopRest();
        void cancelRestNotification();
        void clearSessionNotice();
        haptics.destructive();
        router.replace('/(tabs)/workout');
      } catch {
        closingRef.current = false;
        setClosing(false);
        haptics.rejected();
        void showAlert(
          'Could not discard',
          'The session is still open, and your sets are still here.',
        );
      }
    })();
  }, [workout]);

  if (!workout) {
    return (
      <Screen scrolled={scrollEdge.progress} edges={['top']}>
        <EmptyState
          icon="barbell-outline"
          title="No active workout"
          description="Start a session from the Workout tab."
          action={<Button title="Go to Workout" onPress={() => router.replace('/(tabs)/workout')} />}
        />
      </Screen>
    );
  }

  return (
    <Screen scrolled={scrollEdge.progress}>
      <Stack.Screen
        options={{
          title: workout.name,
          headerRight: () => (
            <View style={styles.headerActions}>
              {/*
                Two glyphs and a pill, in that order.

                Both glyphs open a drawer over this screen and neither is the
                thing the header exists for, so they read as a pair to the left
                of the one action that is. Naming either would make three words
                at the end of a header that already carries the session's name.

                The chart is the session drawer's discoverable entry: the stats
                band below opens the same drawer and is the easier target for a
                thumb, but a chevron at the end of a row is a hint rather than a
                control, and a reading nobody can find is a reading nobody has.
              */}
              <HeaderAction
                label="Session summary"
                icon="stats-chart-outline"
                iconSize={20}
                onPress={() => {
                  haptics.selection();
                  setInsightsOpen(true);
                }}
              />
              {/*
                The clock, which is the only way to reach the timer when no
                rest is running: the docked bar exists for the countdown after
                a set, and between exercises there is nothing to tap.
              */}
              <HeaderAction
                label="Rest timer"
                icon="stopwatch-outline"
                iconSize={22}
                onPress={() => {
                  haptics.selection();
                  setTimerSheetOpen(true);
                }}
              />
              <HeaderAction
                label="Finish workout"
                title="Finish"
                tone="success"
                variant="filled"
                disabled={closing}
                onPress={handleFinish}
              />
            </View>
          ),
        }}
      />

      <SessionStats
        startedAt={workout.startedAt}
        completedSets={completedSets}
        totalSets={totalSets}
        onOpenSummary={() => {
          haptics.selection();
          setInsightsOpen(true);
        }}
      />

      {lostWrites > 0 && (
        /*
         * The one place the screen admits it is not writing. A full disk is the
         * realistic cause, and SQLITE_FULL blocks writes without blocking
         * reads, so the useful thing to offer is not a retry but the export,
         * which can still get the session off the phone intact.
         */
        <Pressable
          onPress={() => router.push('/export')}
          accessibilityRole="button"
          accessibilityLabel={`Not saving. ${lostWrites} ${
            lostWrites === 1 ? 'change' : 'changes'
          } lost`}
          accessibilityHint="Opens export, which still works"
          style={({ pressed }) => [styles.writeFailure, pressed && styles.pressed]}
        >
          <Text variant="label" color="danger">
            {`Not saving: ${lostWrites} ${lostWrites === 1 ? 'change' : 'changes'} lost`}
          </Text>
          <Ionicons name="chevron-forward" size={14} color={colors.danger} />
        </Pressable>
      )}

      <ScrollView
        ref={scrollRef}
        {...scrollEdge.list}
        // The discard button is the last thing in the scroll, so the system
        // navigation inset is added to the content rather than the container.
        // The docked rest bar is added on top of it while one is running: it
        // floats over this list, and reserving its height only while it is
        // there costs a scroll that grows at the bottom. Where nothing is
        // being read: instead of a permanent strip of dead space.
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: spacing.huge + insets.bottom + (resting ? REST_BAR_HEIGHT : 0) },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        // UIScrollView already scrolls the first responder into `bounds` minus
        // `contentInset`, so this single prop both creates the trailing slack
        // and lifts the focused row. Nothing else on this screen may move the
        // scroll: a second actor would fight UIKit and the user's thumb at once.
        automaticallyAdjustKeyboardInsets
      >
        {details.length === 0 ? (
          <EmptyState
            icon="add-circle-outline"
            title="No exercises yet"
            description="Add your first exercise to start logging sets."
          />
        ) : (
          units.map((unit, index) => {
            const open = units.length === 1 || unit.id === openUnitId;
            const lead = unit.members[0]!.exercise;
            const tables = unit.members.map((detail) => (
              <ExerciseBlock
                key={detail.workoutExercise.id}
                detail={detail}
                previousSets={previousByExercise[detail.exercise.id]?.sets ?? []}
                previousNote={previousByExercise[detail.exercise.id]?.note ?? null}
                recordSetIds={recordSetIds}
                superset={placements.get(detail.workoutExercise.id)}
                onOpenDemo={() =>
                  setDemo({
                    name: detail.exercise.name,
                    thumbnailUrl: detail.exercise.thumbnailUrl,
                    videoUrl: detail.exercise.videoUrl,
                  })
                }
                onEditSuperset={
                  details.length > 1
                    ? () =>
                        showSupersetMenu(supersetRows, detail.workoutExercise.id, applySupersets)
                    : undefined
                }
                progression={progressionByExercise[detail.exercise.id]}
                onAddSet={(type?: SetType) => {
                  const last = detail.sets[detail.sets.length - 1];
                  haptics.added();
                  guard(
                    addSet(detail.workoutExercise.id, {
                      weightKg: last?.weightKg ?? null,
                      reps: last?.reps ?? null,
                      setType: type ?? 'normal',
                    }),
                  );
                }}
                onUpdateSet={handleUpdateSet}
                onToggleSet={(set) => handleToggleSet(set, detail)}
                onDeleteSet={(setId) => {
                  haptics.destructive();
                  guard(deleteSet(setId));
                }}
                onChangeSetType={(setId, setType: SetType) => {
                  haptics.selection();
                  guard(updateSet(setId, { setType }));
                }}
                onRemoveExercise={() => {
                  haptics.destructive();
                  guard(removeExerciseFromWorkout(detail.workoutExercise.id));
                }}
                onReplaceExercise={() => {
                  replacingLinkId.current = detail.workoutExercise.id;
                  openPicker(
                    PICKER_ADDRESS,
                    details.map((entry) => entry.exercise.id),
                  );
                  router.push('/exercise/picker');
                }}
                onEditNotes={(seed) => {
                  router.push({
                    pathname: '/workout/notes/[id]',
                    params: { id: detail.workoutExercise.id, ...(seed ? { seed } : {}) },
                  });
                }}
                onReorder={() => setReordering(true)}
                onEditRest={() => setRestEditorId(detail.workoutExercise.id)}
                onChangeUnits={(next) => {
                  guard(setExerciseUnits(detail.exercise.id, next));
                }}
                onOpenExercise={() => {
                  router.push({
                    pathname: '/exercise/[id]',
                    params: { id: detail.exercise.id },
                  });
                }}
              />
            ));

            return (
              <View
                key={unit.id}
                /*
                 * Every unit reports where it sits, and the one being advanced
                 * to acts on it.
                 *
                 * `layout.y` is measured against the content container, which
                 * is the coordinate `scrollTo` wants, and the event arrives
                 * *after* the re-layout that the expand caused: reading a
                 * position at the moment `setExpandedId` runs would give the
                 * one it held while the block above it was still open. One
                 * `lg` of headroom above it so the block does not sit flush
                 * against the session bar.
                 */
                onLayout={(event) => {
                  if (advanceTo.current !== unit.id) return;
                  advanceTo.current = null;
                  scrollRef.current?.scrollTo({
                    y: Math.max(0, event.nativeEvent.layout.y - spacing.lg),
                    animated: !reduceMotion,
                  });
                }}
              >
                {index > 0 && <Divider />}
                {open ? (
                  unit.label ? (
                    <SupersetGroup label={unit.label}>{tables}</SupersetGroup>
                  ) : (
                    tables
                  )
                ) : (
                  <CollapsedLift
                    unit={unit}
                    onExpand={() => setExpandedId(unit.id)}
                    onOpenDemo={() =>
                      setDemo({
                        name: lead.name,
                        thumbnailUrl: lead.thumbnailUrl,
                        videoUrl: lead.videoUrl,
                      })
                    }
                  />
                )}
              </View>
            );
          })
        )}

        <View style={styles.actions}>
          <Button
            title="Add exercise"
            icon="add"
            fullWidth
            onPress={() => {
              // Backing out of the picker leaves the replacement request behind,
              // and the next trip would silently swap an exercise instead of
              // adding one. Opening the picker plainly cancels it.
              replacingLinkId.current = null;
              // What is already on the list travels with the request, so the
              // picker can offer what usually goes with it, and leave out what
              // is already there.
              openPicker(
                PICKER_ADDRESS,
                details.map((entry) => entry.exercise.id),
              );
              router.push('/exercise/picker');
            }}
          />
        </View>

        {/* Discard sits below a rule and a wide gap: a thumb that overshoots Add
            exercise should land on nothing, not on the end of the session. */}
        <Divider style={styles.discardRule} />
        <View style={[styles.actions, styles.closing]}>
          {/*
            Settings leads, and takes only the width of its own label.

            It is here because the settings this screen runs on are the ones you
            find out are wrong mid-session: the rest is too short, the bell is
            coming out of the earbuds in your bag. Sending someone back to the
            tab bar and down two levels to fix that, while a set is on the clock,
            is how a rest timer gets turned off instead of tuned.

            Discard keeps the rest of the row rather than the whole of it, which
            is the trade for having anything beside it at all: the wide gap above
            still catches an overshoot from Add exercise, and what a stray thumb
            lands on down here is now a settings screen rather than a
            confirmation dialog.
          */}
          <Button
            title="Settings"
            icon="options-outline"
            variant="secondary"
            onPress={() => router.push('/settings/workout')}
          />
          <Button
            title="Discard workout"
            variant="danger"
            style={styles.closingPrimary}
            disabled={closing}
            onPress={handleDiscard}
          />
        </View>
      </ScrollView>

      {/* After the scroll, not before it: the bar is docked over the list now
          rather than sitting above it, so it has to paint last. */}
      <RestTimerBar onExpand={() => setTimerSheetOpen(true)} />

      {/*
       * Over the rest bar, and only while it is falling.
       *
       * Last in the tree so the fall passes in front of the docked bar rather
       * than behind it, which is where a record landing mid-rest actually
       * wants to be. It takes no touches (`Confetti` is `pointerEvents:
       * 'none'` throughout), so painting over the bar costs the controls under
       * it nothing.
       *
       * Shorter and lighter than the summary screen's burst: that one is the
       * point of the screen it is on, this one lands over a set that still has
       * to be logged and cannot be in the way of the next one.
       */}
      {recordBurst > 0 && (
        <Confetti
          runKey={recordBurst}
          count={44}
          durationMs={RECORD_BURST_MS}
          colors={recordColors}
        />
      )}

      <RestTimerSheet
        visible={timerSheetOpen}
        onClose={() => setTimerSheetOpen(false)}
        // Idle, the sheet still needs a number to offer, and the app default is
        // the honest one: with nothing resting there is no exercise whose rest
        // this would be.
        targetSeconds={
          restingDetail
            ? resolveRestSeconds(restingDetail, settings.defaultRestSeconds)
            : settings.defaultRestSeconds
        }
        onEditRest={
          restingDetail
            ? () => {
                // The duration editor is itself a `Modal`, and Android does not
                // stack two of those reliably: the same reason the measurement
                // screen drops its sheet before confirming a delete. So this one
                // goes down first and the editor comes up in its place.
                setTimerSheetOpen(false);
                setRestEditorId(restingDetail.workoutExercise.id);
              }
            : undefined
        }
      />

      {restEditorDetail && (
        <RestDurationSheet
          visible
          exerciseName={restEditorDetail.exercise.name}
          value={resolveRestSeconds(restEditorDetail, settings.defaultRestSeconds)}
          usingDefault={!hasRestOverride(restEditorDetail)}
          defaultSeconds={settings.defaultRestSeconds}
          onCancel={() => setRestEditorId(null)}
          onSave={handleSaveRest}
        />
      )}

      <SessionInsightsSheet
        visible={insightsOpen}
        onClose={() => setInsightsOpen(false)}
        workout={workout}
        details={details}
      />

      {demo && (
        <ExerciseDemoSheet
          visible
          name={demo.name}
          thumbnailUrl={demo.thumbnailUrl}
          videoUrl={demo.videoUrl}
          onClose={() => setDemo(null)}
        />
      )}

      <ReorderSheet
        visible={reordering}
        title="Reorder exercises"
        items={reorderItems}
        onClose={() => setReordering(false)}
        onCommit={handleReorder}
      />
    </Screen>
  );
}

/**
 * The session masthead: how far through it you are, how long it has taken, and
 * how many sets are down.
 *
 * This was a `StatBand` (the app's generic row of figures) and a band is the
 * right component for a screen that is *reporting* on a session. This screen is
 * the session. The one question a lifter actually asks mid-workout is "how much
 * is left", and nothing in the app answered it: the band said "Duration 42:18,
 * Sets 12", and 12 out of what was left to memory or to scrolling.
 *
 * So the fraction is stated and then drawn. The line is full-bleed, flush under
 * the header, and it is the only element on this screen that spans the whole
 * width, which is what lets a 3pt rule read as the session's own progress
 * rather than as a divider that happens to be lime.
 *
 * That is the second lime element this screen can show: the docked rest bar
 * draws its countdown in the accent too (`describeRest`), which puts the budget
 * in `theme/tokens.ts` at two while a rest is running. They are allowed to
 * coexist because they are never the same reading. This one is at the top edge
 * and only ever grows, that one is at the bottom edge and only ever drains, and
 * the rest bar is gone the moment the countdown ends.
 *
 * Volume used to sit alongside these figures and doesn't: the summary screen
 * states it thirty seconds later, and three figures forced the type down a step
 * for a number nobody acts on mid-set. It has not come back here. It is one tap
 * away instead, in `SessionInsightsSheet`, which this band opens: the figures a
 * lifter *acts* on stay on the screen, and the ones they are curious about live
 * in a drawer that costs nothing until it is asked for.
 */
function SessionStats({
  startedAt,
  completedSets,
  totalSets,
  onOpenSummary,
}: {
  startedAt: Date;
  completedSets: number;
  totalSets: number;
  onOpenSummary: () => void;
}) {
  const colors = useColors();

  return (
    <View>
      <SessionProgress completed={completedSets} total={totalSets} />

      {/*
        `accessible={false}`, and nothing accessible inside it.

        A Pressable is accessible by default, which would fold the clock and the
        set fraction into one element announced as a single button: the two
        figures this band exists to state would stop being readable to get one
        that opens a drawer. So the band is a shortcut for a thumb, which can
        aim at a 60pt strip and shouldn't have to aim at a glyph, and the header
        carries the button that names the same drawer for anyone navigating by
        element. One action, announced once, reachable two ways.
      */}
      <Pressable
        accessible={false}
        onPress={onOpenSummary}
        style={({ pressed }) => [
          styles.stats,
          pressed && { backgroundColor: colors.surfacePressed },
        ]}
      >
        <View style={styles.statColumn}>
          <Text variant="overline" color="textTertiary">
            Elapsed
          </Text>
          <Elapsed startedAt={startedAt} />
        </View>

        <View style={styles.statColumn}>
          <Text variant="overline" color="textTertiary">
            Sets
          </Text>
          {/* The total is set in the tertiary tier rather than at full strength:
              the figure that changes is the one being read, and "12 / 18" where
              both halves shout is two numbers to parse instead of one and its
              denominator. */}
          <Text
            variant="numericLarge"
            accessibilityLabel={`${completedSets} of ${totalSets} sets complete`}
          >
            {completedSets}
            <Text variant="numericLarge" color="textTertiary">{` / ${totalSets}`}</Text>
          </Text>
        </View>

        {/* A hint that the row opens something, not a control of its own: the
            tap it hints at belongs to the whole band, and the header states the
            same action in a word a screen reader can find. */}
        <View style={styles.summaryCue} importantForAccessibility="no-hide-descendants">
          <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
        </View>
      </Pressable>
    </View>
  );
}

/**
 * The only thing on this screen that ticks, and it is deliberately its own
 * component.
 *
 * `useTicker` used to sit at the screen root, so once a second the whole tree
 * re-rendered: every exercise block, every set row, every text field in them. A
 * set row is a controlled input, and competing with a full re-render every
 * second is what made typing a weight feel like it was fighting back. Moving
 * the ticker to the band fixed that; moving it down one more level, to here,
 * means the 1Hz update now re-renders a single `Text` rather than the masthead
 * and the progress line along with it.
 */
function Elapsed({ startedAt }: { startedAt: Date }) {
  const now = useTicker(1000);
  const elapsed = Math.max(0, Math.floor((now - startedAt.getTime()) / 1000));

  return (
    <Text
      variant="numericLarge"
      color="accent"
      // Position alone does not say what this number is once the label above it
      // is out of the reading order.
      accessibilityLabel={`Elapsed, ${formatDuration(elapsed)}`}
    >
      {formatDuration(elapsed)}
    </Text>
  );
}

/**
 * Sets completed, drawn as a line.
 *
 * Slid rather than scaled or widened, which is the same technique, and the
 * same reasoning: as the rest timer's track: `scaleX` grows from the centre
 * and needs a `transformOrigin` not every surface honours, and animating
 * `width` puts a layout pass on the UI thread's critical path once a set. A
 * full-width layer translated out to the left is the same picture with neither
 * problem, and the left edge stays put while the right edge does the moving.
 *
 * It moves twice a set at most, so unlike the rest bar there is no ticker here:
 * the value changes only when a check plate does.
 */
function SessionProgress({ completed, total }: { completed: number; total: number }) {
  const colors = useColors();
  const [trackWidth, setTrackWidth] = useState(0);

  const progress = total > 0 ? Math.min(1, completed / total) : 0;
  const filled = useSharedValue(progress);

  useEffect(() => {
    filled.value = withTiming(progress, timing.travel);
  }, [filled, progress]);

  const fillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -(1 - filled.value) * trackWidth }],
  }));

  return (
    <View
      style={[styles.progressTrack, { backgroundColor: colors.surfaceMuted }]}
      onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
      // The fraction directly below states this, and a screen reader announcing
      // the same progress twice in two forms is noise rather than access.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {trackWidth > 0 && (
        <Animated.View
          style={[styles.progressFill, fillStyle, { backgroundColor: colors.accent }]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  /*
   * Full-bleed, and 3pt rather than `stroke.rule`.
   *
   * Both for the same reason the rest timer's track is: this line is read at a
   * glance from wherever the phone is sitting, and a hairline of lime against
   * the canvas is not something anyone is going to notice moving. The width is
   * what makes it the session's line rather than a divider: every other
   * element on this screen sits inside the 16pt margin.
   */
  progressTrack: {
    height: 3,
    overflow: 'hidden',
  },
  progressFill: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  stats: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  // Equal columns, so the two figures sit on the same grid as the exercise
  // blocks below them rather than being spaced to their own content. The cue at
  // the end is outside that grid and takes only the width it needs, so adding
  // it moved the two columns in by 16pt each rather than making them three.
  statColumn: { flex: 1, gap: spacing.xs },
  // Centred against the figures rather than their labels: the band is two rows
  // tall and a glyph pinned to the top of it would read as belonging to the
  // overline rather than to the row.
  summaryCue: { width: 32, height: 32, alignItems: 'flex-end', justifyContent: 'center' },
  writeFailure: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  pressed: { opacity: 0.6 },
  // Two actions at the same end of the header, so they need a gap of their own:
  // each one's frame already reaches inwards for its touch target, and without
  // this the clock's frame and the Finish pill's would meet.
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  scroll: { paddingBottom: spacing.huge },
  actions: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  discardRule: { marginTop: spacing.xxxl },
  closing: { flexDirection: 'row', alignItems: 'center' },
  // Whatever Settings did not take. Flex rather than a width, so the label
  // survives a narrow phone and a large text size by shrinking the button it
  // sits in rather than truncating inside it.
  closingPrimary: { flex: 1 },
});
