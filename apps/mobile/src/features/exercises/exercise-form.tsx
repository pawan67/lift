/**
 * The form a custom exercise is created with, and later edited with.
 *
 * One screen for both, because an edit form that drifts from the create form is
 * an exercise that cannot be put back the way it was made. What differs is
 * small: where the starting values come from, which row the name may collide
 * with, whether the tracking type can still change, and that an existing
 * exercise can be deleted from here.
 *
 * Custom exercises only. A built-in is the shared catalog: every device seeds
 * the same row from `@lift/shared`, and the next release that ships a changed
 * catalog would overwrite an edit anyway.
 */

import {
  EQUIPMENT,
  EQUIPMENT_LABELS,
  MUSCLE_GROUPS,
  MUSCLE_GROUP_LABELS,
  TRACKING_TYPES,
  type Equipment,
  type MuscleGroup,
  type TrackingType,
} from '@lift/shared';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { router, Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, type TextInput } from 'react-native';

import {
  Button,
  Chip,
  HeaderAction,
  Screen,
  SectionHeader,
  Text,
  TextField,
  useScrollEdge,
} from '@/components/ui';
import { db } from '@/db/client';
import { exercises, workoutExercises } from '@/db/schema';
import { showAlert, showConfirm } from '@/store/dialog';
import { spacing } from '@/theme';

import { createCustomExercise, deleteExercise, getExercise, updateExercise } from './repository';

const TRACKING_LABELS: Record<TrackingType, string> = {
  weight_reps: 'Weight & reps',
  bodyweight_reps: 'Bodyweight reps',
  weighted_bodyweight: 'Weighted bodyweight',
  assisted_bodyweight: 'Assisted bodyweight',
  duration: 'Duration',
  distance_duration: 'Distance & duration',
  weight_distance: 'Weight & distance',
  reps_only: 'Reps only',
};

/**
 * Why the name is checked before the write rather than after it.
 *
 * The library is ~6,800 rows deep, so "Incline Press" already exists and the
 * user cannot know that from a text field. The check runs on blur and again
 * before saving, and the reason is printed under the field it is about, which
 * is where the fix has to happen anyway. An exercise being edited does not
 * collide with itself.
 */
async function findConflict(
  name: string,
  exceptId: string | undefined,
): Promise<{ name: string; isArchived: boolean } | null> {
  const [row] = await db
    .select({ name: exercises.name, isArchived: exercises.isArchived })
    .from(exercises)
    .where(
      and(
        isNull(exercises.deletedAt),
        sql`lower(${exercises.name}) = ${name.toLowerCase()}`,
        exceptId ? ne(exercises.id, exceptId) : undefined,
      ),
    )
    .limit(1);

  return row ?? null;
}

/** Whether any session, finished or not, has logged this exercise. */
async function hasHistory(exerciseId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: workoutExercises.id })
    .from(workoutExercises)
    .where(and(eq(workoutExercises.exerciseId, exerciseId), isNull(workoutExercises.deletedAt)))
    .limit(1);

  return row !== undefined;
}

export interface ExerciseFormProps {
  /** The custom exercise to edit. Absent, the form creates a new one. */
  exerciseId?: string;
}

export function ExerciseForm({ exerciseId }: ExerciseFormProps) {
  const scrollEdge = useScrollEdge();
  const editing = exerciseId !== undefined;

  const [loaded, setLoaded] = useState(!editing);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [equipment, setEquipment] = useState<Equipment>('barbell');
  const [primaryMuscle, setPrimaryMuscle] = useState<MuscleGroup>('chest');
  const [trackingType, setTrackingType] = useState<TrackingType>('weight_reps');
  /**
   * Locked once sets have been logged against it. The tracking type decides
   * which columns of a set are read: switch weight and reps to duration and
   * every set already logged shows an empty time, drops out of the trend and
   * stops counting towards records, while the numbers it was logged with sit
   * unread in columns nothing looks at any more.
   */
  const [trackingLocked, setTrackingLocked] = useState(false);
  const [saving, setSaving] = useState(false);

  const nameField = useRef<TextInput>(null);

  useEffect(() => {
    if (!exerciseId) return;
    let cancelled = false;

    void (async () => {
      const [row, used] = await Promise.all([getExercise(exerciseId), hasHistory(exerciseId)]);
      if (cancelled) return;

      // Built-ins are not editable: they are the shared catalog, and the next
      // release that ships a new one would overwrite the change anyway.
      if (!row || !row.isCustom || row.deletedAt !== null) {
        router.back();
        return;
      }

      setName(row.name);
      setEquipment(row.equipment);
      setPrimaryMuscle(row.primaryMuscle);
      setTrackingType(row.trackingType);
      setTrackingLocked(used);
      setLoaded(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [exerciseId]);

  /** Returns the reason the name is unusable, or null. */
  const checkName = async (): Promise<string | null> => {
    const trimmed = name.trim();
    if (!trimmed) return 'Give the exercise a name.';

    const conflict = await findConflict(trimmed, exerciseId);
    if (!conflict) return null;

    return conflict.isArchived
      ? `${conflict.name} already exists, archived. Unarchive it instead.`
      : `${conflict.name} already exists.`;
  };

  const validateName = async () => {
    // Nothing to say about a field the user has not filled in yet; the empty
    // case is worth raising only once they try to save. Nor about a blur caused
    // by the save itself, which is already running the same check.
    if (saving || !name.trim()) return;
    setNameError(await checkName());
  };

  const save = async () => {
    if (saving || !loaded) return;
    setSaving(true);

    const reason = await checkName();
    if (reason) {
      setNameError(reason);
      setSaving(false);
      nameField.current?.focus();
      return;
    }

    try {
      const fields = { name: name.trim(), equipment, primaryMuscle, trackingType };

      if (exerciseId) await updateExercise(exerciseId, fields);
      else await createCustomExercise(fields);

      router.back();
    } catch (error) {
      // Only a write that actually failed reaches here: a full disk, a locked
      // database. There is no field to hang that on, so it stays a dialog.
      void showAlert('Could not save', (error as Error).message);
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!exerciseId) return;

    const confirmed = await showConfirm({
      title: 'Delete exercise',
      message: 'This removes the exercise. Past workouts keep their history.',
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;

    await deleteExercise(exerciseId);
    // Back past the exercise's own page as well: it is showing a row that no
    // longer exists.
    router.dismiss(2);
  };

  return (
    <Screen width="form" scrolled={scrollEdge.progress}>
      <Stack.Screen
        options={{
          title: editing ? 'Edit exercise' : 'New exercise',
          // Filled: this screen exists to produce one exercise, and Save is the
          // only way to leave it having done that. Everything else on it is a
          // field or a chip. It is also the only action in this header, so the
          // pill has nothing to shout over.
          headerRight: () => (
            <HeaderAction
              label="Save exercise"
              title="Save"
              variant="filled"
              disabled={saving || !loaded}
              onPress={() => void save()}
            />
          ),
        }}
      />

      {loaded && (
        <ScrollView
          {...scrollEdge.list}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <TextField
            ref={nameField}
            label="Name"
            value={name}
            onChangeText={(text) => {
              setName(text);
              setNameError(null);
            }}
            onBlur={() => void validateName()}
            error={nameError ?? undefined}
            placeholder="e.g. Cable Y-raise"
            // Only on a blank form. Editing usually means changing a muscle or the
            // equipment, and a keyboard over the chips is in the way of both.
            autoFocus={!editing}
            maxLength={80}
          />

          <SectionHeader title="Tracking" />
          <Text variant="caption" color="textTertiary" style={styles.hint}>
            {trackingLocked
              ? 'Locked: this exercise already has logged sets, and they were recorded this way.'
              : 'Determines which fields you log for this exercise.'}
          </Text>
          <View style={styles.chips}>
            {TRACKING_TYPES.map((type) => {
              const locked = trackingLocked && trackingType !== type;
              return (
                <View key={type} style={locked ? styles.lockedChip : undefined}>
                  <Chip
                    label={TRACKING_LABELS[type]}
                    selected={trackingType === type}
                    disabled={locked}
                    onPress={() => setTrackingType(type)}
                  />
                </View>
              );
            })}
          </View>

          <SectionHeader title="Equipment" />
          <View style={styles.chips}>
            {EQUIPMENT.map((item) => (
              <Chip
                key={item}
                label={EQUIPMENT_LABELS[item]}
                selected={equipment === item}
                onPress={() => setEquipment(item)}
              />
            ))}
          </View>

          <SectionHeader title="Primary muscle" />
          <View style={styles.chips}>
            {MUSCLE_GROUPS.map((item) => (
              <Chip
                key={item}
                label={MUSCLE_GROUP_LABELS[item]}
                selected={primaryMuscle === item}
                onPress={() => setPrimaryMuscle(item)}
              />
            ))}
          </View>

          {/* Not disabled on an empty name: a dead button states no reason, and
              the reason is the whole point. Pressing it names what is missing at
              the field and puts the cursor back in it. */}
          <Button
            title={editing ? 'Save changes' : 'Create exercise'}
            fullWidth
            size="lg"
            disabled={saving}
            loading={saving}
            onPress={() => void save()}
            style={styles.submit}
          />

          {editing && (
            <Button
              title="Delete exercise"
              variant="danger"
              fullWidth
              size="lg"
              icon="trash-outline"
              disabled={saving}
              onPress={() => void remove()}
              style={styles.delete}
            />
          )}
        </ScrollView>
      )}

    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.huge },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  hint: { marginBottom: spacing.sm },
  lockedChip: { opacity: 0.4 },
  submit: { marginTop: spacing.xxl },
  delete: { marginTop: spacing.md },
});
