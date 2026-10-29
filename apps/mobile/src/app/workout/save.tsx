import {
  DATE_MEDIUM,
  formatDateTime,
  formatDuration,
  formatVolume,
  summarizeSets,
  type AnalyticsContext,
  type SetLike,
  type TrackingType,
  type WeightUnit,
} from '@lift/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Button,
  Card,
  Divider,
  EmptyState,
  HeaderAction,
  ListRow,
  PromptModal,
  Screen,
  StatBand,
  Text,
  TextField,
  splitMeasure,
  useScrollEdge,
} from '@/components/ui';
import { db } from '@/db/client';
import {
  exercises as exercisesTable,
  workoutExercises,
  workoutSets,
  workouts,
  type WorkoutSet,
} from '@/db/schema';
import { haptics } from '@/features/feedback/haptics';
import { cancelRestNotification } from '@/features/notifications/rest';
import { clearSessionNotice } from '@/features/notifications/live';
import {
  applySessionToRoutine,
  diffSessionAgainstRoutine,
  saveSessionAsRoutine,
  type RoutineDiff,
} from '@/features/routines/repository';
import { pickDateTime } from '@/features/workouts/pick-date-time';
import { discardWorkout, finishWorkout } from '@/features/workouts/repository';
import { StartTimeSheet } from '@/features/workouts/start-time-sheet';
import { WorkoutDurationSheet } from '@/features/workouts/workout-duration-sheet';
import { showAlert, showConfirm } from '@/store/dialog';
import { useSettings } from '@/store/settings';
import { useTimer } from '@/store/timer';
import { spacing } from '@/theme';

const START_EDITABLE = Platform.OS !== 'web';

/** One exercise of the session, reduced to what the totals need. */
interface SessionEntry {
  trackingType: TrackingType;
  sets: WorkoutSet[];
}

/**
 * The last look at a session before it is closed out.
 *
 * Finishing used to happen straight from the logging screen's header, behind a
 * confirmation dialog: one tap, a modal listing the sets about to be dropped,
 * and the workout was in the log. That put the two things people actually want
 * to change about a session. What it is called, and a line about how it went:
 * behind a rename on a screen they had to find afterwards, and it spent the
 * dialog on a number nobody could act on from inside a modal.
 *
 * So the dialog is gone and this screen has its job. It is the confirmation:
 * arriving here is the pause, Save is the affirmative act, and the back chevron
 * is the way out. It returns to a session that is still open and still
 * running, because nothing on this screen writes until Save does.
 */
export default function SaveWorkoutScreen() {
  const scrollEdge = useScrollEdge();

  const insets = useSafeAreaInsets();

  const bodyweightKg = useSettings((state) => state.bodyweightKg);
  const formula = useSettings((state) => state.oneRepMaxFormula);
  const weightUnit = useSettings((state) => state.weightUnit);
  const promptRoutineUpdate = useSettings((state) => state.promptRoutineUpdate);

  // The same query the logging screen runs, for the same reason: there is only
  // ever one open session, so this screen is a singleton and takes no id in its
  // route. Passing one would also let the two screens disagree: a session
  // finished in another tab would leave this one holding an id it could still
  // name but no longer save.
  const { data: activeRows = [], updatedAt } = useLiveQuery(
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
      .where(and(eq(workoutExercises.workoutId, workoutId), isNull(workoutExercises.deletedAt)))
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
      ),
    [linkKey],
  );

  // Only the tracking type is wanted from the exercise itself: it decides how a
  // set is valued, so this asks for the handful of rows the session uses rather
  // than the ~6,800-row catalog. See the note on the same query in `active.tsx`.
  const exerciseIds = links.map((link) => link.exerciseId);
  const exerciseIdsKey = exerciseIds.join(',');

  const { data: exerciseRows = [] } = useLiveQuery(
    db
      .select({ id: exercisesTable.id, trackingType: exercisesTable.trackingType })
      .from(exercisesTable)
      .where(inArray(exercisesTable.id, exerciseIds.length > 0 ? exerciseIds : ['__none__'])),
    [exerciseIdsKey],
  );

  const entries = useMemo<SessionEntry[]>(() => {
    const trackingById = new Map(exerciseRows.map((row) => [row.id, row.trackingType]));
    const setsByParent = new Map<string, WorkoutSet[]>();

    for (const set of sets) {
      const bucket = setsByParent.get(set.workoutExerciseId);
      if (bucket) bucket.push(set);
      else setsByParent.set(set.workoutExerciseId, [set]);
    }

    // A link whose exercise row has gone is skipped, matching `getWorkoutDetail`,
    // which is what `finishWorkout` reads through, so an orphan is absent from
    // the totals it stores too. The figures here have to be the ones about to be
    // written, not a second opinion on them.
    return links.flatMap((link) => {
      const trackingType = trackingById.get(link.exerciseId);
      if (!trackingType) return [];
      return [{ trackingType, sets: setsByParent.get(link.id) ?? [] }];
    });
  }, [links, sets, exerciseRows]);

  /**
   * The figures this screen reports, derived exactly as `finishWorkout` derives
   * the ones it stores: `summarizeSets` per exercise, under that exercise's
   * tracking type, with the bodyweight and one-rep-max formula from settings. A
   * screen that computed "volume" its own way would be a second definition of
   * the word, and the two would drift the first time either changed.
   *
   * `Sets` is therefore `workingSets`. Completed working sets, warm-ups
   * excluded, which is what lands in the row and what the summary screen shows
   * a tap later. The logging screen counts every checked box including warm-ups,
   * and that is the right number *while lifting*: it answers "how much have I
   * done", not "what is going into the log".
   *
   * `completed` is the whole count, warm-ups included, because it answers a
   * different question (whether anything was logged at all) and a session of
   * nothing but warm-ups is still a session with sets in it.
   */
  const totals = useMemo(() => {
    let volumeKg = 0;
    let workingSets = 0;
    let completed = 0;
    let unchecked = 0;

    for (const entry of entries) {
      for (const set of entry.sets) {
        if (set.isCompleted) completed += 1;
        else unchecked += 1;
      }

      const ctx: AnalyticsContext = {
        trackingType: entry.trackingType,
        bodyweightKg: bodyweightKg ?? undefined,
        formula,
      };

      const summary = summarizeSets(entry.sets as SetLike[], ctx);
      volumeKg += summary.volumeKg;
      workingSets += summary.workingSets;
    }

    return { volumeKg, workingSets, completed, unchecked };
  }, [entries, bodyweightKg, formula]);

  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');

  /*
   * The clock stops at Finish, which is the moment this screen opened. Time
   * spent naming the session is not training, and a figure that keeps climbing
   * while the user types cannot be corrected: it would move again the moment
   * they looked away.
   */
  const [finishedAt] = useState(() => Date.now());
  const [startOverride, setStartOverride] = useState<Date | null>(null);
  const [durationOverride, setDurationOverride] = useState<number | null>(null);
  const [editingDuration, setEditingDuration] = useState(false);
  const [editingStart, setEditingStart] = useState(false);

  /*
   * Time the session's own sets account for: a 90-minute match, a 20
   * minute run. Logged after the fact, the stopwatch saw a minute of tapping,
   * and the session should still say it lasted at least as long as what was in
   * it. Summed across exercises, so a run and a match are both counted.
   */
  const loggedSeconds = useMemo(
    () =>
      sets.reduce(
        (total, set) => total + (set.isCompleted && set.durationSeconds ? set.durationSeconds : 0),
        0,
      ),
    [sets],
  );

  const clockSeconds = workout
    ? Math.max(0, Math.round((finishedAt - workout.startedAt.getTime()) / 1000))
    : 0;
  const sessionStart = startOverride ?? workout?.startedAt;
  const sessionSeconds = durationOverride ?? Math.max(clockSeconds, loggedSeconds);

  // Android opens the system dialogs; iOS lays the picker out in a sheet.
  const editStart = () => {
    if (!sessionStart) return;
    if (Platform.OS === 'ios') {
      setEditingStart(true);
      return;
    }
    void pickDateTime(sessionStart, new Date()).then((picked) => {
      if (picked) setStartOverride(picked);
    });
  };

  /*
   * The fields are seeded once per session, not kept in step with the row.
   *
   * The live query re-emits on every write to `workouts`, and each emission is a
   * fresh object, so an effect that followed the row would put the stored name
   * back into the field between two keystrokes. Once seeded the text belongs to
   * the user until Save; the id guard is what makes "the same row again" and "a
   * different session" distinguishable.
   */
  const seededFor = useRef<string | null>(null);

  useEffect(() => {
    if (!workout || seededFor.current === workout.id) return;
    seededFor.current = workout.id;
    setName(workout.name);
    setNotes(workout.notes ?? '');
  }, [workout]);

  /*
   * Saving and discarding both leave the screen, so both are latched: the same
   * pair the logging screen uses. The ref closes the door, because a second tap
   * arrives before any state has re-rendered; the state exists so the header can
   * dim and say the session is on its way out rather than looking untouched.
   */
  const closingRef = useRef(false);
  const [closing, setClosing] = useState(false);

  const handleSave = useCallback(() => {
    if (!workout || closingRef.current) return;

    // The logging screen's rule, restated rather than inherited: this screen is
    // now the only route to a finished session, so the rule has to hold here or
    // it does not hold anywhere.
    if (totals.completed === 0) {
      haptics.rejected();
      void showAlert('Nothing logged', 'Complete at least one set before saving.');
      return;
    }

    // Latched in the same tick as the tap, unlike the confirmation this replaces:
    // there is no dialog in front of Save any more, so nothing can land between
    // the check and the write.
    closingRef.current = true;
    setClosing(true);

    void (async () => {
      try {
        // The name goes through untrimmed. `finishWorkout` decides what an empty
        // one means (it keeps the existing name) and stating that rule twice is
        // how the two copies of it start to disagree.
        const result = await finishWorkout(workout.id, {
          bodyweightKg: bodyweightKg ?? undefined,
          formula,
          name,
          notes: notes.trim() || null,
          startedAt: sessionStart,
          durationSeconds: sessionSeconds,
        });

        useTimer.getState().stopRest();
        void cancelRestNotification();
        void clearSessionNotice();
        haptics.finished();
        router.replace({
          pathname: '/workout/summary/[id]',
          params: { id: result.workout.id },
        });
      } catch {
        closingRef.current = false;
        setClosing(false);
        haptics.rejected();
        void showAlert(
          'Could not save',
          'The session stayed open. Your sets are still here: try again in a moment.',
        );
      }
    })();
  }, [workout, totals.completed, bodyweightKg, formula, name, notes, sessionStart, sessionSeconds]);

  const handleDiscard = useCallback(() => {
    if (!workout || closingRef.current) return;

    void (async () => {
      const confirmed = await showConfirm({
        title: 'Discard workout',
        message: 'This session will be deleted permanently.',
        confirmLabel: 'Discard',
      });
      // The latch is re-read rather than trusted: this spans an await, and a
      // notification tap can put the user back on the session inside that window.
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

  /*
   * The routine side of the session, and why it is asked here.
   *
   * This screen is the one moment the app holds the finished shape of a session
   * and the user's attention at once. The logging screen's header would be a
   * tidier home for "Save as routine", but the other half of the loop cannot be
   * asked there at all: mid-session, "has this drifted from its routine?" has an
   * answer that is still moving, and every checked box changes it.
   *
   * `routineNotice` is what happened, and it replaces whichever card asked. A
   * card that stays put after being answered invites the same tap twice, which
   * here means a second copy of the routine in the list.
   */
  const [routineDiff, setRoutineDiff] = useState<RoutineDiff | null>(null);
  const [routineNotice, setRoutineNotice] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [routineBusy, setRoutineBusy] = useState(false);

  /*
   * Asked once per visit, which is once per mount.
   *
   * The diff reads which exercises were performed and how many sets of each, and
   * nothing on this screen can change either: the only way back to the sets is
   * the back chevron, which pops this screen and mounts it again on the way in.
   * Following the live query instead would re-run the diff's queries on every
   * re-emission to be told the same answer.
   *
   * The empty `workoutId` is the guard rather than a separate loading flag: it
   * is '' until the first read lands, and there is nothing to diff against.
   */
  useEffect(() => {
    if (!workoutId || !promptRoutineUpdate) return;

    let live = true;

    void diffSessionAgainstRoutine(workoutId)
      .then((diff) => {
        if (live) setRoutineDiff(diff);
      })
      // An offer that cannot be computed is simply not made. Nothing on this
      // screen depends on it, and Save is unaffected either way.
      .catch(() => undefined);

    return () => {
      live = false;
    };
  }, [workoutId, promptRoutineUpdate]);

  /*
   * At most three sentences, then a count.
   *
   * A session that wandered a long way from its routine produces a change per
   * exercise, and eight of those is a paragraph on a screen whose job is to save
   * a workout. Three is enough to recognise what happened; the routine editor is
   * where the rest of the detail belongs.
   */
  const routineSummary = useMemo(() => {
    if (!routineDiff) return '';

    const sentences = routineDiff.changes.slice(0, 3).map((change) => change.summary);
    const rest = routineDiff.changes.length - sentences.length;
    if (rest > 0) sentences.push(`And ${rest} more ${rest === 1 ? 'change' : 'changes'}.`);

    return sentences.join(' ');
  }, [routineDiff]);

  /*
   * The routine is rewritten on the tap, not folded into Save.
   *
   * Deferring it would mean carrying an intent across a write that can fail and
   * then deciding whether to put the question back afterwards, and it would make
   * the same card mean two different things depending on how the save went. The
   * cost of writing now is the user who updates the routine and then discards
   * the session, and that trade is worth taking: a routine is an editable
   * template rather than a record, and the sets it was just given are the ones
   * that were performed whether or not the log of them is kept.
   */
  const handleUpdateRoutine = useCallback(() => {
    if (!workout || !routineDiff || routineBusy) return;

    setRoutineBusy(true);

    void (async () => {
      try {
        await applySessionToRoutine(workout.id);
        haptics.selection();
        setRoutineDiff(null);
        setRoutineNotice(`${routineDiff.routineName} now matches this session.`);
      } catch {
        haptics.rejected();
        void showAlert(
          'Could not update the routine',
          `${routineDiff.routineName} is unchanged. Your session is untouched either way.`,
        );
      } finally {
        setRoutineBusy(false);
      }
    })();
  }, [workout, routineDiff, routineBusy]);

  const handleSaveAsRoutine = useCallback(
    (value: string) => {
      setNaming(false);
      if (!workout || routineBusy) return;

      setRoutineBusy(true);

      void (async () => {
        try {
          const routine = await saveSessionAsRoutine(workout.id, value);
          haptics.selection();
          setRoutineNotice(`Saved as ${routine.name}. It is waiting on the Workout tab.`);
        } catch {
          haptics.rejected();
          void showAlert(
            'Could not save the routine',
            'Nothing was written, and this session is still here to save.',
          );
        } finally {
          setRoutineBusy(false);
        }
      })();
    },
    [workout, routineBusy],
  );

  // Declared once and rendered in both branches, like the summary screen: a
  // native-stack screen reads its options as the push animation starts, so
  // setting them only in the loaded branch slides a differently titled header in
  // and relabels it mid-transition.
  const header = (
    <Stack.Screen
      options={{
        title: 'Save workout',
        headerRight: workout
          ? () => (
              // Filled, which `HeaderActionVariant` reserves for the one action a
              // screen exists to complete. This is that screen. The label names
              // the object as well as the verb, because "Save" alone could be the
              // name, the note, or the session.
              <HeaderAction
                label="Save workout"
                title="Save"
                variant="filled"
                disabled={closing}
                onPress={handleSave}
              />
            )
          : undefined,
      }}
    />
  );

  if (!workout) {
    /*
     * Two ways to have no session, and only one of them is worth saying.
     *
     * `updatedAt` is undefined until the first read lands, so the mount frame
     * has no row yet. Announcing "no active workout" there would flash the
     * failure state over a session that is right behind this screen. And a save
     * or a discard drops the row from this query before the navigation runs, so
     * `closing` covers the frames between the write and the new screen.
     */
    const settled = updatedAt !== undefined && !closing;

    return (
      <Screen width="form" scrolled={scrollEdge.progress}>
        {header}
        {settled && (
          <EmptyState
            icon="barbell-outline"
            title="No active workout"
            description="Nothing to save. This session was finished or discarded somewhere else."
            action={
              <Button title="Go to Workout" onPress={() => router.replace('/(tabs)/workout')} />
            }
          />
        )}
      </Screen>
    );
  }

  const uncheckedNoun = totals.unchecked === 1 ? 'set' : 'sets';

  const startedAt = formatDateTime(sessionStart ?? workout.startedAt, DATE_MEDIUM);

  return (
    <Screen width="form" scrolled={scrollEdge.progress}>
      {header}

      <ScrollView
        {...scrollEdge.list}
        // Discard is the last thing in the scroll, so the system navigation
        // inset is added to the content rather than to the container.
        contentContainerStyle={[styles.content, { paddingBottom: spacing.huge + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
        // UIScrollView already scrolls the first responder into `bounds` minus
        // `contentInset`, so this one prop both creates the trailing slack and
        // lifts the focused field. Same arrangement as the logging screen.
        automaticallyAdjustKeyboardInsets
      >
        {totals.unchecked > 0 && (
          /* The one sentence the confirmation dialog contributed, kept because
             it is the only thing Save does that the user cannot see. It sits at
             the top of the body because Save is in the header, and this is the
             closest the scroll gets to it, and because it is read before the
             fields rather than after them, while there is still time to go back
             and check a box. `dropped`, not `discarded`: the repository's own
             word, and "discard" stays reserved for the whole session. */
          <Text variant="caption" color="warning">
            {`${totals.unchecked} unchecked ${uncheckedNoun} will be dropped.`}
          </Text>
        )}

        {/* The stored name as the placeholder, not as a fallback nobody sees:
            emptying the field shows what the session will still be called. */}
        <TextField
          label="Name"
          accessibilityLabel="Workout name"
          value={name}
          onChangeText={setName}
          placeholder={workout.name}
          maxLength={80}
          returnKeyType="done"
        />

        <SessionStats
          durationSeconds={sessionSeconds}
          volumeKg={totals.volumeKg}
          workingSets={totals.workingSets}
          weightUnit={weightUnit}
        />

        {/* Directly under the figures rather than down beside Discard, because
            it is the only thing on the screen with a deadline: Save is in the
            header, and once it is pressed this offer is gone. The name field and
            the description are edits, not questions. */}
        {routineDiff && (
          <Card style={styles.routine}>
            <Text variant="subheading" accessibilityRole="header">
              {`Update ${routineDiff.routineName}?`}
            </Text>
            <Text variant="label" color="textSecondary">
              {routineSummary}
            </Text>
            {/* `secondary`, which is the companion slot: this screen's primary
                action is Save, and Save is in the header. A `primary` here would
                be the second thing on one view claiming to be the first. */}
            <View style={styles.routineActions}>
              <Button
                title="Not now"
                accessibilityLabel={`Leave ${routineDiff.routineName} as it is`}
                variant="ghost"
                disabled={routineBusy}
                onPress={() => setRoutineDiff(null)}
                style={styles.routineAction}
              />
              <Button
                title="Update"
                accessibilityLabel={`Update ${routineDiff.routineName}`}
                variant="secondary"
                loading={routineBusy}
                onPress={handleUpdateRoutine}
                style={styles.routineAction}
              />
            </View>
          </Card>
        )}

        {/*
         * Offered only to a session that came from no routine.
         *
         * One that did already has one, and the answer to "I changed it" is the
         * card above rather than a second near-identical routine in a list the
         * user has to tell apart afterwards. Saving a variant off a routine
         * session is a real thing to want, and the place for it is the routine
         * editor, which can say which routine it is copying.
         */}
        {!workout.routineId && !routineNotice && (
          <Card padded={false}>
            <ListRow
              icon="list-outline"
              title="Save as routine"
              subtitle="Start from what you just did next time."
              onPress={() => setNaming(true)}
            />
          </Card>
        )}

        {routineNotice && (
          <Card style={styles.routine}>
            <Text variant="label" color="textSecondary">
              {routineNotice}
            </Text>
          </Card>
        )}

        <TextField
          label="Description"
          accessibilityLabel="Workout description"
          value={notes}
          onChangeText={setNotes}
          placeholder="How did it go?"
          multiline
          style={styles.description}
        />

        {/*
         * When and how long, both correctable. The session is often saved
         * after the fact (a match logged on the way home, Sunday's game
         * entered on Monday) and these are the two facts that are then wrong.
         * The end of the session is not a field: it is start plus duration.
         */}
        <Card padded={false}>
          <ListRow
            icon="calendar-outline"
            title={startedAt}
            subtitle="Started"
            // No picker exists in a browser, so the web build only reports it.
            showChevron={START_EDITABLE}
            onPress={START_EDITABLE ? editStart : undefined}
          />
          <Divider inset={60} />
          <ListRow
            icon="time-outline"
            title={formatDuration(sessionSeconds)}
            subtitle={
              durationOverride === null && loggedSeconds > clockSeconds
                ? 'Duration, from the activity you logged'
                : 'Duration'
            }
            onPress={() => setEditingDuration(true)}
          />
        </Card>

        {/* Set apart by a wide gap rather than tucked under the fields: it is
            the one irreversible thing on the screen, and a thumb travelling to
            the description should not be able to overshoot onto it. */}
        <Button
          title="Discard workout"
          variant="danger"
          fullWidth
          disabled={closing}
          onPress={handleDiscard}
          style={styles.discard}
        />
      </ScrollView>

      {/* Seeded from the field above rather than from the stored row: someone
          who has just renamed this session to "Push A" has already told the app
          what the routine should be called. */}
      <PromptModal
        visible={naming}
        title="Save as routine"
        message="The exercises you performed and the sets you completed, ready to start from."
        initialValue={name.trim() || workout.name}
        placeholder="Routine name"
        maxLength={60}
        onCancel={() => setNaming(false)}
        onConfirm={handleSaveAsRoutine}
      />
      <StartTimeSheet
        visible={editingStart}
        value={sessionStart ?? workout.startedAt}
        latest={new Date()}
        onCancel={() => setEditingStart(false)}
        onSave={(startedAt) => {
          setStartOverride(startedAt);
          setEditingStart(false);
        }}
      />

      <WorkoutDurationSheet
        visible={editingDuration}
        workoutName={name.trim() || workout.name}
        value={sessionSeconds}
        onCancel={() => setEditingDuration(false)}
        onSave={(seconds) => {
          setDurationOverride(seconds);
          setEditingDuration(false);
        }}
      />
    </Screen>
  );
}

/**
 * The session's three figures, as they will be saved.
 *
 * Duration leads: it is the one the user is most likely to correct here.
 */
function SessionStats({
  durationSeconds,
  volumeKg,
  workingSets,
  weightUnit,
}: {
  durationSeconds: number;
  volumeKg: number;
  workingSets: number;
  weightUnit: WeightUnit;
}) {
  // Split so the band can set the unit small and quiet beside the figure; the
  // formatters return the two joined, which is right for a sentence and wrong
  // for a column. See `splitMeasure`.
  const [volume, volumeUnit] = splitMeasure(formatVolume(volumeKg, weightUnit));

  return (
    <StatBand
      items={[
        { label: 'Duration', value: formatDuration(durationSeconds), lead: true },
        { label: 'Volume', value: volume, unit: volumeUnit },
        { label: 'Sets', value: String(workingSets) },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg },
  // Tall enough for a few lines, and top-aligned: a multiline `TextInput`
  // centres its text vertically on Android otherwise, so a one-line note floats
  // in the middle of the box. Matches the per-exercise note editor.
  description: { height: 120, paddingTop: spacing.md, textAlignVertical: 'top' },
  // `Card` pads but does not space its children, since most of them are list
  // rows that own their own edges. These are stacked text and buttons.
  routine: { gap: spacing.md },
  routineActions: { flexDirection: 'row', gap: spacing.sm },
  routineAction: { flex: 1 },
  discard: { marginTop: spacing.xxl },
});
