import { Ionicons } from '@expo/vector-icons';
import { EQUIPMENT_LABELS, formatWeight, type WeightUnit } from '@lift/shared';
import {
  IMPORT_RANGES,
  identifyRoutines,
  importCutoff,
  type IdentifiedRoutine,
  type ImportMatchCandidate,
  type ImportRange,
  type ImportedWorkout,
} from '@lift/shared/import';
import { File } from 'expo-file-system';
import { Stack, router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  Divider,
  ListPicker,
  ListRow,
  PromptModal,
  Screen,
  SectionHeader,
  SegmentedControl,
  Text,
  useScrollEdge,
} from '@/components/ui';
import { getExercisesByIds } from '@/features/exercises/repository';
import { restoreBackup } from '@/features/backup';
import { SettingChoice, SettingToggle } from '@/features/settings/rows';
import { importSharedRoutine, type SharedRoutineResult } from '@/features/share';
import {
  EXPORT_GUIDES,
  IMPORT_APP_ORDER,
  importIdentifiedRoutines,
  importWorkouts,
  loadExistingRoutineKeys,
  newExercisesIn,
  readImportFile,
  relinkImportedHistory,
  selectRange,
  unresolvedExercisesIn,
  type ImportApp,
  type ImportPreview,
  type ImportRoutinesSummary,
  type ImportSummary,
  type RangeSelection,
  type UnresolvedImportName,
  type WorkoutsPreview,
} from '@/features/import';
import { showAlert } from '@/store/dialog';
import { useExercisePicker, usePickedExercises } from '@/store/exercise-picker';
import { useSettings } from '@/store/settings';
import { MIN_TOUCH_SIZE, spacing, useColors } from '@/theme';

/** Sentinel for "invent a custom row". Exercise ids are uuidv7, so this cannot collide. */
const KEEP_CUSTOM = 'custom';
/** Opens the catalog picker; never stored as a pick. */
const SEARCH_LIBRARY = 'search';
const MATCH_PICKER = 'import-match';

function picksFromLinks(links: Record<string, string>): Map<string, string> {
  const picks = new Map<string, string>();
  for (const [name, id] of Object.entries(links)) {
    if (id !== KEEP_CUSTOM) picks.set(name, id);
  }
  return picks;
}

/**
 * Bringing training history in from another app.
 *
 * The screen is one scroll with four states, in the order the task actually
 * happens: pick the app you're leaving, get the file out of it, see what the
 * file holds, then decide how much of it to keep. After a CSV import, named
 * sessions can be saved as routines in a fifth step that is opt-in. The order matters. The
 * export instructions sit above the file picker because that is where someone
 * is stuck, and the counts sit above the import button because agreeing to
 * "import 240 workouts" is the one moment they can still change their mind.
 *
 * Nothing is written until the last tap. Everything above it. The parse, the
 * duplicate check, the list of exercises that would be created. Is a read.
 */
export default function ImportScreen() {
  const scrollEdge = useScrollEdge();

  const weightUnit = useSettings((state) => state.weightUnit);

  const [app, setApp] = useState<ImportApp | null>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [unit, setUnit] = useState<WeightUnit>(weightUnit);
  const [range, setRange] = useState<ImportRange>('all');

  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [restored, setRestored] = useState<number | null>(null);
  const [addedRoutine, setAddedRoutine] = useState<SharedRoutineResult | null>(null);
  /**
   * The in-range sessions from the file that was just imported.
   *
   * Held so routines can be inferred after the fact: the confirm step does
   * not ask, and reconstructing titles from the log would lose CSV spelling
   * and mix in sessions that were already here.
   */
  const [importedWorkouts, setImportedWorkouts] = useState<ImportedWorkout[] | null>(null);
  const [pickingRoutines, setPickingRoutines] = useState(false);
  const [routinesSummary, setRoutinesSummary] = useState<ImportRoutinesSummary | null>(null);
  /**
   * Library ids chosen for names the matcher would not take on its own.
   *
   * Keyed by the lower-cased spelling in the file. Absent or `KEEP_CUSTOM`
   * means invent a custom exercise, the same outcome as skipping the picker.
   * Held past the workout write so "save as routines" can reuse the same
   * answers instead of planning those names a second time and creating twins.
   */
  const [links, setLinks] = useState<Record<string, string>>({});
  /**
   * Names of library rows chosen from search, keyed by id.
   *
   * Suggestions already carry a name. A search pick does not, and the choice
   * row has to say what was chosen, so this is filled when the picker returns.
   */
  const [pickedExtras, setPickedExtras] = useState<Record<string, ImportMatchCandidate>>({});
  const searchingFor = useRef<string | null>(null);
  const pendingPicks = usePickedExercises(MATCH_PICKER);
  const openPicker = useExercisePicker((state) => state.open);
  const clearPendingPicks = useExercisePicker((state) => state.clear);

  /**
   * Discards the answer to a read that has since been superseded.
   *
   * Two reads can be in flight at once. Pick a file, then change the unit
   * before the first parse returns, and they finish in whatever order they
   * finish in. Without this the slower one wins and the screen shows a preview
   * of the unit the user just moved away from.
   */
  const readToken = useRef(0);

  /**
   * Reads a file into a preview.
   *
   * Driven from the taps that cause it rather than from an effect on `unit`:
   * the unit is an *input to the parse*, not a display setting. Weights are
   * stored in kilograms, so choosing pounds has to go back through the file,
   * and an effect would make that a synchronisation of state with itself.
   */
  const loadPreview = useCallback(async (text: string, assumedUnit: WeightUnit) => {
    const token = ++readToken.current;

    setReading(true);
    setError(null);

    try {
      const next = await readImportFile(text, { weightUnit: assumedUnit });
      if (token !== readToken.current) return;
      setPreview(next);
    } catch (cause) {
      if (token !== readToken.current) return;
      setPreview(null);
      setError(describe(cause));
    } finally {
      if (token === readToken.current) setReading(false);
    }
  }, []);

  const pickFile = useCallback(async () => {
    if (!app) return;

    try {
      const picked = await File.pickFileAsync({ mimeTypes: EXPORT_GUIDES[app].mimeTypes });
      if (picked.canceled) return;

      const text = await picked.result.text();

      setSummary(null);
      setRestored(null);
      setAddedRoutine(null);
      setLinks({});
      setPickedExtras({});
      setFile({ name: picked.result.name, text });
      await loadPreview(text, unit);
    } catch (cause) {
      void showAlert('Could not open that file', describe(cause));
    }
  }, [app, loadPreview, unit]);

  const changeUnit = useCallback(
    (next: WeightUnit) => {
      setUnit(next);
      if (file) void loadPreview(file.text, next);
    },
    [file, loadPreview],
  );

  const selection = useMemo(() => {
    if (preview?.kind !== 'workouts') return null;
    return selectRange(preview.parsed, importCutoff(range));
  }, [preview, range]);

  const unresolved = useMemo(() => {
    if (preview?.kind === 'share') return preview.unresolved;
    if (preview?.kind !== 'workouts') return [];
    const workouts = importedWorkouts ?? selection?.workouts;
    if (!workouts?.length) return [];
    return unresolvedExercisesIn(preview, workouts);
  }, [preview, selection, importedWorkouts]);

  const newExercises = useMemo(() => {
    if (preview?.kind !== 'workouts' || !selection) return [];
    return newExercisesIn(preview, selection.workouts);
  }, [preview, selection]);

  const picks = useMemo(() => picksFromLinks(links), [links]);

  const linkName = useCallback((name: string, id: string) => {
    setLinks((current) => ({ ...current, [name.toLowerCase()]: id }));
  }, []);

  const searchLibrary = useCallback(
    (name: string) => {
      searchingFor.current = name;
      openPicker(MATCH_PICKER);
      router.push('/exercise/picker');
    },
    [openPicker],
  );

  useEffect(() => {
    if (pendingPicks.length === 0) return;

    const name = searchingFor.current;
    const id = pendingPicks[pendingPicks.length - 1];
    searchingFor.current = null;
    clearPendingPicks(MATCH_PICKER);
    if (!name || !id) return;

    linkName(name, id);
    void getExercisesByIds([id]).then((rows) => {
      const row = rows.get(id);
      if (!row) return;
      setPickedExtras((current) => ({
        ...current,
        [id]: { id: row.id, name: row.name, equipment: row.equipment },
      }));
    });
  }, [pendingPicks, clearPendingPicks, linkName]);

  const runImport = async () => {
    if (!selection || selection.workouts.length === 0) return;

    setBusy(true);
    setProgress({ done: 0, total: selection.workouts.length });

    try {
      const result = await importWorkouts(selection.workouts, {
        picks,
        // Throttled: a per-workout render on a thousand-session import spends
        // more time laying out a number than writing rows.
        onProgress: (next) => {
          if (next.done % 5 === 0 || next.done === next.total) setProgress(next);
        },
      });
      setImportedWorkouts(selection.workouts);
      setSummary(result);
    } catch (cause) {
      void showAlert('Import stopped', describe(cause));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const runRestore = async () => {
    if (preview?.kind !== 'backup') return;

    setBusy(true);
    try {
      const result = await restoreBackup(preview.json);
      setRestored(Object.values(result.imported).reduce((total, count) => total + count, 0));
    } catch (cause) {
      void showAlert('Nothing was restored', describe(cause));
    } finally {
      setBusy(false);
    }
  };

  /*
   * A share commits down one of two paths, decided by the file rather than by
   * the user.
   *
   * A routine is written here. A session is handed to `importWorkouts`, the
   * same call a CSV goes through, so a friend's session earns records and skips
   * duplicates by exactly the rules a session imported from Strong does. There
   * is no third staging path for shared sessions, and that is the point of the
   * file carrying `ImportedWorkout` in the first place.
   */
  const runShare = async () => {
    if (preview?.kind !== 'share') return;

    setBusy(true);
    try {
      if (preview.file.kind === 'routine') {
        setAddedRoutine(await importSharedRoutine(preview.file.routine, picks));
      } else {
        setSummary(await importWorkouts([preview.file.session], { picks }));
      }
    } catch (cause) {
      void showAlert('Nothing was added', describe(cause));
    } finally {
      setBusy(false);
    }
  };

  const startOver = () => {
    // Bumped so a read still in flight cannot repopulate the screen the user
    // just cleared.
    readToken.current += 1;

    setFile(null);
    setPreview(null);
    setSummary(null);
    setRestored(null);
    setAddedRoutine(null);
    setImportedWorkouts(null);
    setPickingRoutines(false);
    setRoutinesSummary(null);
    setError(null);
    setReading(false);
    setRange('all');
    setLinks({});
    setPickedExtras({});
  };

  const identified = useMemo(
    () => (importedWorkouts ? identifyRoutines(importedWorkouts) : []),
    [importedWorkouts],
  );

  const screenTitle = pickingRoutines
    ? 'Save as routines'
    : routinesSummary
      ? 'Routines added'
      : 'Import';

  return (
    <Screen width="form" scrolled={scrollEdge.progress}>
      <Stack.Screen options={{ title: screenTitle }} />

      <ScrollView
        {...scrollEdge.list}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {routinesSummary !== null ? (
          <RoutinesCreatedResult summary={routinesSummary} onImportMore={startOver} />
        ) : pickingRoutines ? (
          <SaveRoutinesStep
            identified={identified}
            unresolved={unresolved}
            links={links}
            onLink={linkName}
            extras={pickedExtras}
            onSearch={searchLibrary}
            busy={busy}
            onBack={() => setPickingRoutines(false)}
            onCreate={async (selected, relinkHistory) => {
              setBusy(true);
              try {
                const result = await importIdentifiedRoutines(selected, picks);
                if (relinkHistory && importedWorkouts) {
                  await relinkImportedHistory(importedWorkouts, picks);
                }
                setRoutinesSummary(result);
                setPickingRoutines(false);
              } catch (cause) {
                void showAlert('Routines were not created', describe(cause));
              } finally {
                setBusy(false);
              }
            }}
          />
        ) : summary !== null ? (
          <ImportResult
            summary={summary}
            identified={identified}
            onCreateRoutines={() => setPickingRoutines(true)}
            onImportMore={startOver}
          />
        ) : restored !== null ? (
          <RestoreResult rows={restored} onImportMore={startOver} />
        ) : addedRoutine !== null ? (
          <RoutineResult result={addedRoutine} onImportMore={startOver} />
        ) : (
          <>
            <SourceStep app={app} onPick={setApp} onReset={startOver} />

            {app && !file && <ExportGuideCard app={app} onPickFile={() => void pickFile()} />}

            {file && (
              <FileStep
                name={file.name}
                reading={reading}
                error={error}
                onReplace={() => void pickFile()}
              />
            )}

            {preview?.kind === 'backup' && (
              <BackupStep
                preview={preview}
                busy={busy}
                onRestore={() => void runRestore()}
              />
            )}

            {preview?.kind === 'share' && (
              <ShareStep
                preview={preview}
                links={links}
                onLink={linkName}
                extras={pickedExtras}
                onSearch={searchLibrary}
                busy={busy}
                onImport={() => void runShare()}
              />
            )}

            {preview?.kind === 'workouts' && selection && (
              <WorkoutsStep
                preview={preview}
                selection={selection}
                newExercises={newExercises}
                range={range}
                onRangeChange={setRange}
                unit={unit}
                onUnitChange={changeUnit}
                busy={busy}
                progress={progress}
                onImport={() => void runImport()}
              />
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

function SourceStep({
  app,
  onPick,
  onReset,
}: {
  app: ImportApp | null;
  onPick: (app: ImportApp | null) => void;
  onReset: () => void;
}) {
  if (app) {
    const guide = EXPORT_GUIDES[app];
    return (
      <>
        <SectionHeader title="Importing from" />
        <Card padded={false} style={styles.section}>
          <ListRow
            icon={guide.icon}
            image={guide.image}
            title={guide.name}
            subtitle={guide.summary}
            showChevron={false}
            accessory={
              <Text variant="label" color="accent">
                Change
              </Text>
            }
            onPress={() => {
              onReset();
              onPick(null);
            }}
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <Text variant="body" color="textSecondary" style={styles.intro}>
        Bring your training history across. Nothing is written until you say so, and importing the
        same file twice adds nothing the second time.
      </Text>

      <SectionHeader title="Where is it coming from?" />
      <Card padded={false} style={styles.section}>
        {IMPORT_APP_ORDER.map((key, index) => {
          const guide = EXPORT_GUIDES[key];
          return (
            <View key={key}>
              {index > 0 && <Divider inset={spacing.lg} />}
              <ListRow
                icon={guide.icon}
                image={guide.image}
                title={guide.name}
                subtitle={guide.summary}
                onPress={() => onPick(key)}
              />
            </View>
          );
        })}
      </Card>
    </>
  );
}

function ExportGuideCard({ app, onPickFile }: { app: ImportApp; onPickFile: () => void }) {
  const colors = useColors();
  const guide = EXPORT_GUIDES[app];

  return (
    <>
      <SectionHeader title={`Getting the file out of ${guide.name}`} />
      <Card style={styles.card}>
        {guide.steps.map((step, index) => (
          <View key={step} style={styles.step}>
            <Text variant="numeric" color="textTertiary" style={styles.stepNumber}>
              {index + 1}
            </Text>
            <Text variant="body" color="textSecondary" style={styles.stepBody}>
              {step}
            </Text>
          </View>
        ))}
      </Card>

      {guide.warnings.map((warning) => (
        <View key={warning} style={styles.warning}>
          <Ionicons name="alert-circle-outline" size={16} color={colors.textTertiary} />
          <Text variant="caption" color="textTertiary" style={styles.warningBody}>
            {warning}
          </Text>
        </View>
      ))}

      <Button
        title="Choose file"
        icon="folder-open-outline"
        size="lg"
        fullWidth
        style={styles.action}
        onPress={onPickFile}
      />
    </>
  );
}

function FileStep({
  name,
  reading,
  error,
  onReplace,
}: {
  name: string;
  reading: boolean;
  error: string | null;
  onReplace: () => void;
}) {
  return (
    <>
      <SectionHeader title="File" />
      <Card padded={false} style={styles.section}>
        <ListRow
          icon="document-text-outline"
          title={name}
          subtitle={reading ? 'Reading…' : undefined}
          showChevron={false}
          accessory={
            reading ? (
              <ActivityIndicator />
            ) : (
              <Text variant="label" color="accent">
                Replace
              </Text>
            )
          }
          onPress={reading ? undefined : onReplace}
        />
      </Card>

      {error && (
        <Text variant="body" color="danger" style={styles.hint}>
          {error}
        </Text>
      )}
    </>
  );
}

function BackupStep({
  preview,
  busy,
  onRestore,
}: {
  preview: Extract<ImportPreview, { kind: 'backup' }>;
  busy: boolean;
  onRestore: () => void;
}) {
  const { counts, exportedAt } = preview.file;
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);

  return (
    <>
      <SectionHeader title="This is a Lift backup" />
      <Card style={styles.card}>
        <Figure label="Workouts" value={counts.workouts ?? 0} />
        <Figure label="Sets" value={counts.workout_sets ?? 0} />
        <Figure label="Routines" value={counts.routines ?? 0} />
        <Figure label="Custom exercises" value={counts.exercises ?? 0} />
        <Figure label="Records" value={counts.personal_records ?? 0} />
        <Figure label="Measurements" value={counts.body_measurements ?? 0} />
      </Card>

      <Text variant="caption" color="textTertiary" style={styles.hint}>
        {exportedAt ? `Exported ${formatDate(new Date(exportedAt))}. ` : ''}
        A backup carries routines, records and measurements as well as workouts, so it restores
        whole rather than by date. It merges into what is here and overwrites nothing.
      </Text>

      <Button
        title={`Restore ${total.toLocaleString()} rows`}
        icon="cloud-upload-outline"
        size="lg"
        fullWidth
        loading={busy}
        disabled={busy}
        style={styles.action}
        onPress={onRestore}
      />
    </>
  );
}

function ShareStep({
  preview,
  links,
  onLink,
  extras,
  onSearch,
  busy,
  onImport,
}: {
  preview: Extract<ImportPreview, { kind: 'share' }>;
  links: Record<string, string>;
  onLink: (name: string, id: string) => void;
  extras: Record<string, ImportMatchCandidate>;
  onSearch: (name: string) => void;
  busy: boolean;
  onImport: () => void;
}) {
  const { file, newExercises, unresolved } = preview;
  const asked = new Set(unresolved.map((entry) => entry.name.toLowerCase()));
  const trueMisses = newExercises.filter((name) => !asked.has(name.toLowerCase()));
  const stillCustom = newExercises.filter(
    (name) => (links[name.toLowerCase()] ?? KEEP_CUSTOM) === KEEP_CUSTOM,
  );

  const isRoutine = file.kind === 'routine';
  const name = isRoutine ? file.routine.name : file.session.name;
  const exercises = isRoutine ? file.routine.exercises : file.session.exercises;
  const sets = exercises.reduce((total, entry) => total + entry.sets.length, 0);

  return (
    <>
      <SectionHeader title={isRoutine ? 'A routine from a friend' : 'A session from a friend'} />
      <Card style={styles.card}>
        <Row label="Name" value={name} />
        <Figure label="Exercises" value={exercises.length} />
        <Figure label="Sets" value={sets} />
        {stillCustom.length > 0 && (
          <Figure label="New to your library" value={stillCustom.length} />
        )}
      </Card>

      {/*
       * What lands where, stated before the button rather than after it. The
       * two kinds go to two different places and neither is guessable from a
       * file name, which is the one thing someone could reasonably be annoyed
       * about discovering afterwards.
       */}
      <Text variant="caption" color="textTertiary" style={styles.hint}>
        {isRoutine
          ? 'This is added as a new routine of your own. Your existing routines are left alone, including one of the same name.'
          : 'This is added to your log as a completed workout, with any personal records it earns. Importing it twice adds nothing the second time.'}
        {trueMisses.length > 0
          ? ` ${trueMisses.length === 1 ? 'One exercise is' : `${trueMisses.length} exercises are`} not in your library yet and will be added: ${trueMisses.join(', ')}.`
          : ''}
      </Text>

      {unresolved.length > 0 && (
        <Card padded={false} style={styles.section}>
          {unresolved.map((entry, index) => (
            <View key={entry.name}>
              {index > 0 && <Divider inset={spacing.lg} />}
              <MatchChoice
                entry={entry}
                value={links[entry.name.toLowerCase()] ?? KEEP_CUSTOM}
                extra={pickedExtra(links[entry.name.toLowerCase()] ?? KEEP_CUSTOM, extras)}
                onChange={(id) => onLink(entry.name, id)}
                onSearch={() => onSearch(entry.name)}
              />
            </View>
          ))}
        </Card>
      )}

      <Button
        title={isRoutine ? 'Add to my routines' : 'Add to my log'}
        icon="download-outline"
        size="lg"
        fullWidth
        loading={busy}
        disabled={busy}
        style={styles.action}
        onPress={onImport}
      />
    </>
  );
}

function RoutineResult({
  result,
  onImportMore,
}: {
  result: SharedRoutineResult;
  onImportMore: () => void;
}) {
  return (
    <>
      <SectionHeader title="Routine added" />
      <Card style={styles.card}>
        <Row label="Name" value={result.name} />
        <Figure label="Exercises" value={result.exercises} />
        <Figure label="Sets" value={result.sets} />
        {result.added.length > 0 && (
          <Figure label="Exercises added to library" value={result.added.length} />
        )}
      </Card>

      <Button
        title="Open routines"
        size="lg"
        fullWidth
        style={styles.action}
        onPress={() => router.replace('/(tabs)/workout')}
      />
      <Button
        title="Import something else"
        variant="secondary"
        size="lg"
        fullWidth
        style={styles.action}
        onPress={onImportMore}
      />
    </>
  );
}

function WorkoutsStep({
  preview,
  selection,
  newExercises,
  range,
  onRangeChange,
  unit,
  onUnitChange,
  busy,
  progress,
  onImport,
}: {
  preview: WorkoutsPreview;
  selection: RangeSelection;
  newExercises: string[];
  range: ImportRange;
  onRangeChange: (range: ImportRange) => void;
  unit: WeightUnit;
  onUnitChange: (unit: WeightUnit) => void;
  busy: boolean;
  progress: { done: number; total: number } | null;
  onImport: () => void;
}) {
  const parsed = preview.parsed;
  const diagnostics = parsed.diagnostics;

  // Walks every set in the file, so it is kept off the range picker's path.
  const heaviestKg = useMemo(() => heaviest(preview), [preview]);

  const chosenCount = selection.workouts.length;
  const alreadyHere = preview.alreadyPresent;

  return (
    <>
      <SectionHeader title={`Read as a ${preview.sourceLabel} export`} />
      <Card style={styles.card}>
        <Figure label="Workouts in the file" value={parsed.workouts.length} />
        <Figure label="Sets" value={parsed.setCount} />
        {preview.span && (
          <Row
            label="Covering"
            value={`${formatDate(preview.span.from)} – ${formatDate(preview.span.to)}`}
          />
        )}
        {alreadyHere > 0 && (
          <Row
            label="Already in your log"
            value={`${alreadyHere.toLocaleString()}, skipped`}
          />
        )}
      </Card>

      <SectionHeader title="How far back" />
      <ListPicker
        label="Import from"
        options={IMPORT_RANGES}
        value={range}
        onChange={onRangeChange}
      />
      <Text variant="caption" color="textTertiary" style={styles.hint}>
        {chosenCount === 0
          ? 'Nothing in the file falls in that window.'
          : `${chosenCount.toLocaleString()} ${chosenCount === 1 ? 'workout' : 'workouts'} and ${selection.sets.toLocaleString()} sets are in range. Any already in your log are skipped.`}
      </Text>

      {diagnostics.weightUnitSource === 'chosen' && (
        <>
          <SectionHeader title="Weights" />
          <Text variant="body" color="textSecondary" style={styles.hint}>
            The file does not say what unit its weights are in. Read them as:
          </Text>
          <SegmentedControl
            options={[
              { value: 'kg', label: 'Kilograms' },
              { value: 'lb', label: 'Pounds' },
            ]}
            value={unit}
            onChange={onUnitChange}
            style={styles.unit}
          />
          <Text variant="caption" color="textTertiary" style={styles.hint}>
            Getting this wrong is not subtle. The heaviest set in the file would come in as{' '}
            {formatWeight(heaviestKg, unit)}.
          </Text>
        </>
      )}

      {newExercises.length > 0 && (
        <>
          <SectionHeader title={`${newExercises.length} new exercises`} />
          <Text variant="caption" color="textTertiary" style={styles.hint}>
            These are not in your library and will be added to it: {list(newExercises)}. They come
            in with no muscle set, so the body map will not count them until you fill that in.
          </Text>
        </>
      )}

      <Skipped diagnostics={diagnostics} />

      {progress && (
        <Text variant="caption" color="textTertiary" align="center" style={styles.hint}>
          {progress.done.toLocaleString()} of {progress.total.toLocaleString()} workouts
        </Text>
      )}

      <Button
        title={
          chosenCount === 0
            ? 'Nothing to import'
            : `Import ${chosenCount.toLocaleString()} ${chosenCount === 1 ? 'workout' : 'workouts'}`
        }
        icon="download-outline"
        size="lg"
        fullWidth
        loading={busy}
        disabled={busy || chosenCount === 0}
        style={styles.action}
        onPress={onImport}
      />
    </>
  );
}

/**
 * What the parser could not use.
 *
 * Rendered even though every line here is a small number, because these are the
 * rows that will be missing afterwards. Finding out that a hundred sets were
 * dropped by noticing a gap in a chart six weeks later is the outcome this
 * paragraph exists to prevent.
 */
function Skipped({ diagnostics }: { diagnostics: WorkoutsPreview['parsed']['diagnostics'] }) {
  const lines: string[] = [];

  if (diagnostics.undatedRows > 0) {
    lines.push(
      `${diagnostics.undatedRows.toLocaleString()} rows had no readable date and were left out. If the source app writes dates in a language Lift does not read yet, its month names will not be recognised.`,
    );
  }
  if (diagnostics.blankRows > 0) {
    lines.push(
      `${diagnostics.blankRows.toLocaleString()} rows recorded no weight, reps, duration or distance, so nothing was performed on them.`,
    );
  }

  const coerced = Object.entries(diagnostics.coercedSetTypes);
  if (coerced.length > 0) {
    const total = coerced.reduce((sum, [, count]) => sum + count, 0);
    lines.push(
      `${total.toLocaleString()} sets were labelled ${list(coerced.map(([label]) => label))}, which Lift has no equivalent for. They come in as normal sets and still count toward your volume.`,
    );
  }

  if (diagnostics.unnamedRows > 0) {
    lines.push(
      `${diagnostics.unnamedRows.toLocaleString()} rows named no exercise and were left out.`,
    );
  }

  if (lines.length === 0) return null;

  return (
    <>
      <SectionHeader title="Left out" />
      {lines.map((line) => (
        <Text key={line} variant="caption" color="textTertiary" style={styles.hint}>
          {line}
        </Text>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

function routineDescription(routine: IdentifiedRoutine): string {
  const exercises = routine.latest.exercises.length;
  const exerciseLabel = `${exercises} ${exercises === 1 ? 'exercise' : 'exercises'}`;

  if (routine.sessionCount === 1) return `Once · ${exerciseLabel}`;

  return `Last of ${routine.sessionCount} · ${exerciseLabel} · ${formatDate(new Date(routine.latest.startedAt))}`;
}

function SaveRoutinesStep({
  identified,
  unresolved,
  links,
  onLink,
  extras,
  onSearch,
  busy,
  onBack,
  onCreate,
}: {
  identified: IdentifiedRoutine[];
  unresolved: UnresolvedImportName[];
  links: Record<string, string>;
  onLink: (name: string, id: string) => void;
  extras: Record<string, ImportMatchCandidate>;
  onSearch: (name: string) => void;
  busy: boolean;
  onBack: () => void;
  onCreate: (
    selected: { name: string; workout: ImportedWorkout }[],
    relinkHistory: boolean,
  ) => void | Promise<void>;
}) {
  const [existingKeys, setExistingKeys] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(identified.map((routine) => [routine.key, routine.name])),
  );
  const [expanded, setExpanded] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<IdentifiedRoutine | null>(null);
  const [relinkHistory, setRelinkHistory] = useState(false);

  const unresolvedByName = useMemo(() => {
    const map = new Map<string, UnresolvedImportName>();
    for (const entry of unresolved) map.set(entry.name.toLowerCase(), entry);
    return map;
  }, [unresolved]);

  useEffect(() => {
    let cancelled = false;

    void loadExistingRoutineKeys().then((keys) => {
      if (cancelled) return;
      setExistingKeys(keys);
      setSelected(
        new Set(identified.filter((routine) => !keys.has(routine.key)).map((routine) => routine.key)),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [identified]);

  const chosen = identified.filter(
    (routine) => selected?.has(routine.key) && !existingKeys.has(routine.key),
  );

  const replacements = unresolved.filter((entry) => {
    const picked = links[entry.name.toLowerCase()];
    return picked !== undefined && picked !== KEEP_CUSTOM;
  });

  const anyQuestions = identified.some(
    (routine) =>
      !existingKeys.has(routine.key) && questionsIn(routine, unresolvedByName).length > 0,
  );

  return (
    <>
      <Text variant="body" color="textSecondary" style={styles.intro}>
        Named sessions in this file are grouped into routines.
      </Text>
      {anyQuestions && (
        <Text variant="caption" color="textTertiary" style={styles.hint}>
          A name in red did not match the catalog. Keep it as custom (limited
          features) or pick a catalog exercise.
        </Text>
      )}

      <Card padded={false} style={styles.section}>
        {identified.map((routine, index) => {
          const taken = existingKeys.has(routine.key);
          const on = selected?.has(routine.key) ?? false;
          const label = names[routine.key] ?? routine.name;
          const open = expanded === routine.key;
          const questions = taken ? [] : questionsIn(routine, unresolvedByName);

          return (
            <View key={routine.key}>
              {index > 0 && <Divider inset={spacing.lg} />}
              <SettingToggle
                icon="albums-outline"
                label={label}
                description={
                  taken
                    ? undefined
                    : questions.length > 0
                      ? `${routineDescription(routine)} · ${questions.length} unmatched`
                      : routineDescription(routine)
                }
                value={taken ? false : on}
                disabled={taken || selected === null}
                disabledReason={taken ? 'Already in your routines' : undefined}
                onChange={(next) => {
                  setSelected((current) => {
                    const copy = new Set(current ?? []);
                    if (next) copy.add(routine.key);
                    else copy.delete(routine.key);
                    return copy;
                  });
                }}
              />
              {!taken && (
                <View style={styles.candidateActions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Rename ${label}`}
                    onPress={() => setRenaming(routine)}
                    style={styles.candidateAction}
                  >
                    <Text variant="label" color="accent">
                      Rename
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      open ? `Hide exercises in ${label}` : `Show exercises in ${label}`
                    }
                    onPress={() => setExpanded(open ? null : routine.key)}
                    style={styles.candidateAction}
                  >
                    <Text variant="label" color="accent">
                      {open ? 'Hide exercises' : 'Show exercises'}
                    </Text>
                  </Pressable>
                </View>
              )}
              {!taken && !open &&
                questions.map((entry) => (
                  <MatchChoice
                    key={entry.name}
                    entry={entry}
                    value={links[entry.name.toLowerCase()] ?? KEEP_CUSTOM}
                    extra={pickedExtra(links[entry.name.toLowerCase()] ?? KEEP_CUSTOM, extras)}
                    onChange={(id) => onLink(entry.name, id)}
                    onSearch={() => onSearch(entry.name)}
                  />
                ))}
              {open &&
                routine.latest.exercises.map((exercise, exerciseIndex) => {
                  const entry = unresolvedByName.get(exercise.name.toLowerCase());
                  if (entry) {
                    return (
                      <MatchChoice
                        key={`${exercise.name}:${exerciseIndex}`}
                        entry={entry}
                        value={links[entry.name.toLowerCase()] ?? KEEP_CUSTOM}
                        extra={pickedExtra(links[entry.name.toLowerCase()] ?? KEEP_CUSTOM, extras)}
                        onChange={(id) => onLink(entry.name, id)}
                        onSearch={() => onSearch(entry.name)}
                      />
                    );
                  }

                  return (
                    <ListRow
                      key={`${exercise.name}:${exerciseIndex}`}
                      icon="barbell-outline"
                      title={exercise.name}
                      showChevron={false}
                      accessory={
                        <Text variant="caption" color="textTertiary">
                          {exercise.sets.length} {exercise.sets.length === 1 ? 'set' : 'sets'}
                        </Text>
                      }
                    />
                  );
                })}
            </View>
          );
        })}
      </Card>

      {replacements.length > 0 && (
        <>
          <SectionHeader title="Imported history" />
          <Text variant="caption" color="textTertiary" style={styles.hint}>
            These names were saved as custom exercises when you imported. Turn this on to move the
            sets from this file onto the catalog exercises you picked, so the log and the routines
            match. Sessions you logged yourself are not changed.
          </Text>
          <Card padded={false} style={styles.section}>
            <SettingToggle
              icon="swap-horizontal-outline"
              label="Move this import onto the catalog"
              description={list(replacements.map((entry) => entry.name))}
              value={relinkHistory}
              onChange={setRelinkHistory}
            />
          </Card>
        </>
      )}

      <Button
        title={
          chosen.length === 0
            ? 'Nothing selected'
            : `Create ${chosen.length.toLocaleString()} ${chosen.length === 1 ? 'routine' : 'routines'}`
        }
        icon="albums-outline"
        size="lg"
        fullWidth
        loading={busy}
        disabled={busy || chosen.length === 0 || selected === null}
        style={styles.action}
        onPress={() =>
          void onCreate(
            chosen.map((routine) => ({
              name: (names[routine.key] ?? routine.name).trim() || routine.name,
              workout: routine.latest,
            })),
            relinkHistory && replacements.length > 0,
          )
        }
      />
      <Button
        title="Not now"
        variant="secondary"
        size="lg"
        fullWidth
        disabled={busy}
        style={styles.action}
        onPress={onBack}
      />

      <PromptModal
        visible={renaming !== null}
        title="Rename routine"
        initialValue={renaming ? (names[renaming.key] ?? renaming.name) : ''}
        placeholder="Routine name"
        confirmLabel="Save"
        maxLength={60}
        onCancel={() => setRenaming(null)}
        onConfirm={(value) => {
          if (renaming) {
            const next = value.trim();
            if (next.length > 0) {
              setNames((current) => ({ ...current, [renaming.key]: next }));
            }
          }
          setRenaming(null);
        }}
      />
    </>
  );
}

function RoutinesCreatedResult({
  summary,
  onImportMore,
}: {
  summary: ImportRoutinesSummary;
  onImportMore: () => void;
}) {
  const created = summary.created.length;

  return (
    <>
      <SectionHeader title={created > 0 ? 'Routines added' : 'Nothing new'} />
      <Card style={styles.card}>
        <Figure label="Routines added" value={created} />
        {summary.created.map((routine) => (
          <Row
            key={routine.name}
            label={routine.name}
            value={`${routine.exercises} ${routine.exercises === 1 ? 'exercise' : 'exercises'}`}
          />
        ))}
        {summary.skipped.length > 0 && (
          <Figure label="Already here" value={summary.skipped.length} />
        )}
      </Card>

      {created === 0 && (
        <Text variant="body" color="textSecondary" style={styles.hint}>
          Every selected name was already in your routines, so nothing changed.
        </Text>
      )}

      <View style={styles.actions}>
        <Button
          title="Open routines"
          icon="albums-outline"
          size="lg"
          fullWidth
          onPress={() => router.replace('/(tabs)/workout')}
        />
        <Button title="Import another file" variant="secondary" fullWidth onPress={onImportMore} />
      </View>
    </>
  );
}

function ImportResult({
  summary,
  identified,
  onCreateRoutines,
  onImportMore,
}: {
  summary: ImportSummary;
  identified: IdentifiedRoutine[];
  onCreateRoutines: () => void;
  onImportMore: () => void;
}) {
  const nothing = summary.workouts === 0;
  const [existingKeys, setExistingKeys] = useState<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadExistingRoutineKeys().then((keys) => {
      if (!cancelled) setExistingKeys(keys);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const creatable =
    existingKeys === null
      ? 0
      : identified.filter((routine) => !existingKeys.has(routine.key)).length;

  return (
    <>
      <SectionHeader title={nothing ? 'Nothing new' : 'Imported'} />
      <Card style={styles.card}>
        <Figure label="Workouts added" value={summary.workouts} />
        <Figure label="Sets" value={summary.sets} />
        {summary.personalRecords > 0 && (
          <Figure label="Records found" value={summary.personalRecords} />
        )}
        {summary.exercisesCreated.length > 0 && (
          <Figure label="Exercises added" value={summary.exercisesCreated.length} />
        )}
        {summary.duplicates > 0 && <Figure label="Already here" value={summary.duplicates} />}
      </Card>

      {nothing && summary.duplicates > 0 && (
        <Text variant="body" color="textSecondary" style={styles.hint}>
          Every workout in that range was already in your log, so nothing changed.
        </Text>
      )}

      {summary.failed > 0 && (
        <Text variant="body" color="danger" style={styles.hint}>
          {summary.failed.toLocaleString()}{' '}
          {summary.failed === 1 ? 'session' : 'sessions'} could not be written and were rolled
          back. Everything else landed. Importing the same file again will pick up only what is
          missing. If the phone is out of storage, freeing some space first is the fix.
        </Text>
      )}

      {summary.queued > 0 && (
        <Text variant="caption" color="textTertiary" style={styles.hint}>
          {summary.queued.toLocaleString()} rows are queued for your account and will sync.
        </Text>
      )}

      {summary.personalRecords > 0 && (
        <Text variant="caption" color="textTertiary" style={styles.hint}>
          Records were awarded oldest first and dated to the day they were set, so your progress
          charts read the way they did in the app you left.
        </Text>
      )}

      {creatable > 0 && (
        <Text variant="caption" color="textTertiary" style={styles.hint}>
          {creatable === 1
            ? 'One named workout in this import can be saved as a routine.'
            : `${creatable.toLocaleString()} named workouts in this import can be saved as routines.`}
        </Text>
      )}

      <View style={styles.actions}>
        {creatable > 0 && (
          <Button
            title="Create routines from import"
            icon="albums-outline"
            size="lg"
            fullWidth
            onPress={onCreateRoutines}
          />
        )}
        <Button
          title="View history"
          icon="time-outline"
          size="lg"
          fullWidth
          variant={creatable > 0 ? 'secondary' : undefined}
          onPress={() => router.replace('/history')}
        />
        <Button title="Import another file" variant="secondary" fullWidth onPress={onImportMore} />
      </View>
    </>
  );
}

function RestoreResult({ rows, onImportMore }: { rows: number; onImportMore: () => void }) {
  return (
    <>
      <SectionHeader title={rows > 0 ? 'Restored' : 'Nothing new'} />
      <Text variant="body" color="textSecondary" style={styles.hint}>
        {rows > 0
          ? `${rows.toLocaleString()} rows added.`
          : 'This device already held every row in that backup.'}
      </Text>

      <View style={styles.actions}>
        <Button
          title="View history"
          icon="time-outline"
          size="lg"
          fullWidth
          onPress={() => router.replace('/history')}
        />
        <Button title="Import another file" variant="secondary" fullWidth onPress={onImportMore} />
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// Bits
// ---------------------------------------------------------------------------

function Figure({ label, value }: { label: string; value: number }) {
  return <Row label={label} value={value.toLocaleString()} />;
}

function questionsIn(
  routine: IdentifiedRoutine,
  unresolvedByName: ReadonlyMap<string, UnresolvedImportName>,
): UnresolvedImportName[] {
  const seen = new Set<string>();
  const questions: UnresolvedImportName[] = [];
  for (const exercise of routine.latest.exercises) {
    const key = exercise.name.toLowerCase();
    if (seen.has(key)) continue;
    const entry = unresolvedByName.get(key);
    if (!entry) continue;
    seen.add(key);
    questions.push(entry);
  }
  return questions;
}

function matchOptions(
  entry: UnresolvedImportName,
  extra: ImportMatchCandidate | undefined,
) {
  const suggestions = [...entry.suggestions];
  if (extra && !suggestions.some((row) => row.id === extra.id)) {
    suggestions.unshift(extra);
  }

  return [
    {
      value: KEEP_CUSTOM,
      label: 'Keep as custom',
      description: 'Limited features until you edit it',
    },
    ...suggestions.map((row) => ({
      value: row.id,
      label: row.name,
      description: EQUIPMENT_LABELS[row.equipment],
    })),
    {
      value: SEARCH_LIBRARY,
      label: 'Search catalog',
      description: 'Browse every exercise',
    },
  ];
}

function pickedExtra(
  value: string,
  extras: Record<string, ImportMatchCandidate>,
): ImportMatchCandidate | undefined {
  if (value === KEEP_CUSTOM) return undefined;
  return extras[value];
}

function MatchChoice({
  entry,
  value,
  extra,
  onChange,
  onSearch,
}: {
  entry: UnresolvedImportName;
  value: string;
  extra?: ImportMatchCandidate;
  onChange: (id: string) => void;
  onSearch: () => void;
}) {
  const unmatched = value === KEEP_CUSTOM;

  return (
    <SettingChoice
      icon={unmatched ? 'alert-circle-outline' : 'barbell-outline'}
      label={entry.name}
      options={matchOptions(entry, extra)}
      value={value}
      onChange={(next) => {
        if (next === SEARCH_LIBRARY) {
          onSearch();
          return;
        }
        onChange(next);
      }}
      valueBelow
      tone={unmatched ? 'danger' : 'neutral'}
    />
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text variant="body" color="textSecondary" style={styles.rowLabel}>
        {label}
      </Text>
      <Text variant="numeric" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/** The heaviest set in the file, which is what makes a unit mix-up obvious. */
function heaviest(preview: WorkoutsPreview): number {
  let best = 0;
  for (const workout of preview.parsed.workouts) {
    for (const exercise of workout.exercises) {
      for (const set of exercise.sets) best = Math.max(best, set.weightKg ?? 0);
    }
  }
  return best;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "a, b and c", capped so a hundred new exercises don't fill the screen. */
function list(items: readonly string[], limit = 6): string {
  const shown = items.slice(0, limit);
  const rest = items.length - shown.length;

  const joined =
    shown.length <= 1
      ? (shown[0] ?? '')
      : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;

  return rest > 0 ? `${shown.join(', ')} and ${rest} more` : joined;
}

/**
 * The one line of a failure worth putting in front of someone.
 *
 * `ImportFormatError` arrives already written for the user. It names the
 * column that is missing, and the file-system and SQLite errors behind
 * everything else carry a real sentence of their own ("ENOSPC: no space left on
 * device"), which is the only thing separating a full disk from a permission
 * problem. Anything with no message says so rather than rendering
 * `[object Object]`.
 */
function describe(cause: unknown): string {
  const text = cause instanceof Error ? cause.message.trim() : '';
  return text.length > 0 ? text : 'The reason was not reported.';
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.sm },
  intro: { paddingBottom: spacing.sm },
  section: { marginTop: spacing.xs },
  card: { gap: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  rowLabel: { flexShrink: 1 },
  step: { flexDirection: 'row', gap: spacing.md },
  stepNumber: { width: 18, textAlign: 'right' },
  stepBody: { flex: 1 },
  warning: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.xs, paddingTop: spacing.xs },
  warningBody: { flex: 1 },
  hint: { paddingTop: spacing.xs, paddingHorizontal: spacing.xs },
  unit: { marginTop: spacing.xs },
  action: { marginTop: spacing.lg },
  actions: { marginTop: spacing.xl, gap: spacing.sm },
  candidateActions: {
    flexDirection: 'row',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  candidateAction: { minHeight: MIN_TOUCH_SIZE, justifyContent: 'center' },
});
