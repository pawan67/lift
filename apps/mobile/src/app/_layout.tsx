import 'react-native-gesture-handler';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { useFonts } from 'expo-font';
import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import * as Sharing from 'expo-sharing';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import migrations from '../../drizzle/migrations';

import { Button, DialogHost, SideRail, stackHeaderOptions, Text } from '@/components/ui';
import { databaseReady, db, isDatabaseOpen } from '@/db/client';
import { seedExerciseLibrary } from '@/db/seed';
import { writeBackupFile } from '@/features/backup';
import { HomeWidgets } from '@/features/home-widgets/publisher';
import { WeighInResponder } from '@/features/notifications/weigh-in-responder';
import { Onboarding } from '@/features/onboarding';
import { useSyncTriggers } from '@/features/sync/use-sync-triggers';
import { RestCues } from '@/features/workouts/rest-cues';
import { WorkoutNotice } from '@/features/workouts/workout-notice';
import { showAlert } from '@/store/dialog';
import { useSettings } from '@/store/settings';
import { loadPersistedRest } from '@/store/timer-persistence';
import { AppThemeProvider, spacing, useColors, useLayout, useTheme } from '@/theme';

// Held until migrations, seeding, settings hydration and the stored rest period
// all finish, so the first frame the user sees is real content rather than an
// empty shell.
void SplashScreen.preventAutoHideAsync();

/**
 * Gives every route pushed from outside the app: a rest notification tap, a
 * `lift://` link into `/workout/active`: a real back stack. Without an anchor
 * the deep-linked screen is the only entry on the stack, so its back button is
 * missing and the user is stranded on a detail screen with no way into the app.
 */
export const unstable_settings = { anchor: '(tabs)' };

export default function RootLayout() {
  // Remounting `Bootstrap` is what makes retry work: `useMigrations` runs its
  // effect once with an empty dependency list, so nothing short of a fresh
  // mount will re-attempt a failed migration.
  const [attempt, setAttempt] = useState(0);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <AppThemeProvider>
          {/*
            Wraps everything below rather than just the screens that happen to
            open a `BottomSheetModal` today: `isWide` (see `sheet-layout.tsx`) can
            flip at runtime as a web window is resized, so there is no static
            point in the tree that is "phone-only" to gate this on instead.
          */}
          <BottomSheetModalProvider>
            <Bootstrap key={attempt} onRetry={() => setAttempt((n) => n + 1)} />
            {/*
              Outside `Bootstrap`, not inside `AppNavigator`, and not keyed on
              `attempt`. `StartupError` is rendered *instead of* the navigator and
              still raises dialogs: its export button reports where the file went,
              so a host mounted under the navigator would not exist on the one
              screen with no other way to say anything. Sitting here it also
              survives the remount a retry performs, which is what stops a dialog
              raised by the failing attempt from being torn down mid-read.
            */}
            <DialogHost />
          </BottomSheetModalProvider>
        </AppThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Waits for the database to exist, before anything is allowed to read it.
 *
 * On native this is already true on the first render and this component is a
 * pass-through. The handle is opened during `db/client`'s own evaluation.
 *
 * On web it is not. There the database is a worker that has to instantiate
 * WebAssembly before it can answer, so `db` is assigned a moment after import
 * (see the note in `db/client` for why it cannot be opened synchronously
 * there). `useMigrations` reads `db` in a mount effect with no dependencies, so
 * it must not be mounted a frame early: it would run once, against nothing, and
 * never try again.
 *
 * Which is why this is a separate component rather than another flag inside
 * `Startup`. A hook cannot be conditional, and the whole point is to not call
 * that one yet.
 */
function Bootstrap({ onRetry }: { onRetry: () => void }) {
  const [open, setOpen] = useState(isDatabaseOpen);
  const [openError, setOpenError] = useState<Error | null>(null);

  useEffect(() => {
    if (open) return;

    let cancelled = false;
    databaseReady.then(
      () => {
        if (!cancelled) setOpen(true);
      },
      (error: unknown) => {
        if (!cancelled) setOpenError(error as Error);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [open]);

  // `Startup` hides the splash when it settles, and it is never mounted on this
  // path, so without this the error screen renders underneath a splash that
  // stays up forever, which reads as a hang rather than as the failure it is.
  useEffect(() => {
    if (openError) void SplashScreen.hideAsync();
  }, [openError]);

  // A database that will not open is a startup failure of exactly the kind
  // `StartupError` exists for, and the retry it offers is a remount, which
  // re-reads `isDatabaseOpen` rather than re-opening, because the promise is
  // the module's and settles once.
  if (openError) return <StartupError error={openError} onRetry={onRetry} />;
  if (!open) return <StartupSpinner />;

  return <Startup onRetry={onRetry} />;
}

/**
 * Runs the startup sequence in order: schema migrations, then the exercise
 * library seed (which needs the tables), then preferences and the rest period
 * left behind by the last process.
 *
 * Fonts load alongside all of that rather than after it: they're bundled
 * assets, not a network fetch, and gating the splash on them too means the
 * first frame is already the bundled face instead of flashing a system one
 * and reflowing.
 */
function Startup({ onRetry }: { onRetry: () => void }) {
  const { success: migrated, error: migrationError } = useMigrations(db, migrations);
  const hydrate = useSettings((state) => state.hydrate);
  const hydrated = useSettings((state) => state.hydrated);

  // The keys here are the names `fontFamily` in the tokens refers to: expo-font
  // registers each face under the key it is given, on both platforms, so these
  // two lists have to agree and nothing else in the app names a font. Three
  // upright cuts, which is every face the family ships; five theme roles share
  // them, see `fontFamily` for which role gets which and why no italic loads.
  //
  // Required relatively rather than through the `@/assets` alias, matching the
  // app's other bundled assets (`notifications/sounds.ts`): the alias is
  // configured for module imports, and an asset `require` is not worth finding
  // out about at runtime.
  const [fontsLoaded, fontError] = useFonts({
    'JetBrainsSans-Regular': require('../../assets/fonts/JetBrainsSans-Regular.ttf'),
    'JetBrainsSans-SemiBold': require('../../assets/fonts/JetBrainsSans-SemiBold.ttf'),
    'JetBrainsSans-Bold': require('../../assets/fonts/JetBrainsSans-Bold.ttf'),
  });

  const [seedError, setSeedError] = useState<Error | null>(null);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (!migrated) return;

    let cancelled = false;

    void (async () => {
      try {
        await seedExerciseLibrary();
        await hydrate();
        // Rehydrating the rest period behind the splash is what keeps the bar
        // in the first painted frame instead of dropping in ~90pt later. It
        // never throws, so it needs no handling of its own here.
        await loadPersistedRest();
        if (!cancelled) setSeeded(true);
      } catch (error) {
        if (!cancelled) setSeedError(error as Error);
        // Nothing below may run on a failed hydrate: the store is still holding
        // defaults, and reading `gymReminderEnabled: false` off it would cancel
        // a reminder the user has switched on.
        return;
      }

      // Deliberately after the splash is released rather than inside the try
      // above: a reminder that fails to re-arm is not a startup failure, and
      // nothing on the first frame depends on it. See `syncGymReminder` for
      // which cases this repairs and why it never prompts.
      try {
        const {
          gymReminderEnabled,
          gymReminderTime,
          weighInReminderEnabled,
          weighInReminderTime,
        } = useSettings.getState();

        const { syncGymReminder } = await import('@/features/notifications/reminder');
        await syncGymReminder(gymReminderEnabled, gymReminderTime);

        // The weigh-in reminder needs this for a reason the gym one does not:
        // its body quotes the last reading, so a launch is also the moment to
        // stop it quoting a figure that has since been replaced.
        const { syncWeighInReminder } = await import('@/features/notifications/weigh-in');
        await syncWeighInReminder(weighInReminderEnabled, weighInReminderTime);
      } catch {
        // No notification module, or the OS refused. The preference is intact
        // and the switch on the settings screen still reschedules by hand.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [migrated, hydrate]);

  // A missing font is not worth blocking launch over. React Native falls back
  // to the system face, so `fontError` counts as "done loading", not as a
  // startup failure the way a failed migration does.
  const ready = migrated && seeded && hydrated && (fontsLoaded || Boolean(fontError));
  const error = migrationError ?? seedError;

  // But it is worth *saying*, because the fallback is silent and total: one
  // unreadable face fails the whole `useFonts` call, every weight in the theme
  // resolves to the system font, and the app looks exactly like a build where
  // the type tokens were never applied. That is indistinguishable by eye from a
  // stale Metro cache, and the two have completely different fixes, so the one
  // the app actually knows about says so rather than leaving it to be guessed.
  useEffect(() => {
    if (__DEV__ && fontError) {
      console.warn(
        `[fonts] Falling back to the system face. The bundled family did not load. ${fontError.message}`,
      );
    }
  }, [fontError]);

  useEffect(() => {
    if (ready || error) void SplashScreen.hideAsync();
  }, [ready, error]);

  if (error) return <StartupError error={error} onRetry={onRetry} />;
  if (!ready) return <StartupSpinner />;

  return <AppNavigator />;
}

function AppNavigator() {
  const { isDark } = useTheme();
  const colors = useColors();
  const { isWide } = useLayout();

  /*
   * Whether the first-run flow is still owed.
   *
   * Read here rather than in `Startup` because the flow renders *over* this
   * navigator rather than instead of it: its last page offers to open the
   * import screen, and that is a route, so the router has to already be
   * mounted when it is pressed. See the note on `Onboarding`.
   *
   * `hydrate` has already run by the time anything below mounts, so this is the
   * stored answer on the first frame and never flips from false to true. It
   * flips the other way exactly once, when the flow finishes.
   */
  const onboarding = useSettings((state) => state.onboardingCompletedAt == null);

  // Syncs on launch and whenever the app returns to the foreground.
  useSyncTriggers();

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {/* Rest keeps running while the user browses exercises or history, so the
          bell is owned here rather than by the workout screen. Renders nothing. */}
      <RestCues />
      {/* Same reasoning: the workout notification has to outlive the workout
          screen, so it is driven from the root. Renders nothing. */}
      <WorkoutNotice />
      {/* A weight typed into the morning reminder can land while any screen is
          up, or while none is: see the file for the cold-start half. Renders
          nothing. */}
      <WeighInResponder />
      {/* The Android home-screen widgets, which describe the routine list, the
          newest weigh-in and the open session — all of which change from
          screens all over the app. Renders nothing, and subscribes to nothing
          off Android. */}
      <HomeWidgets />
      {/*
        The desktop shell: rail beside the stack, rather than inside it.

        This is the whole reason the rail is not a side-mounted tab bar. The tab
        navigator is one screen within this stack, so a rail it owned would be
        covered by every screen pushed on top of it, which is most of the app.
        Here it is a sibling of the navigator, so it survives every push, and
        the stack's headers land in the pane beside it.

        The row is rendered on a phone too, with no rail in it. A flex row
        holding a single `flex: 1` child lays out identically to that child on
        its own, and keeping the tree the same shape across the breakpoint means
        crossing 840 while dragging a window edge does not remount the
        navigator, which would drop the entire back stack.
      */}
      <View
        style={styles.shell}
        // Android's half of making the flow modal to a screen reader. iOS has
        // `accessibilityViewIsModal` on the layer itself; Android has no
        // equivalent, so the thing underneath is hidden from its own side.
        importantForAccessibility={onboarding ? 'no-hide-descendants' : 'auto'}
      >
        {isWide && <SideRail />}
        <View style={styles.pane}>
          <Stack
            screenOptions={{
              // The shared set, spread rather than restated. This stack and the tab
              // navigator each used to declare their own and drifted apart: see
              // `headerOptions` for what that cost and what it now fixes.
              //
              // The stack's variant, because every screen in it is one you
              // arrived at from somewhere else: the title is centred over the
              // back chevron the option below leaves in place.
              ...stackHeaderOptions(colors),
              /*
               * The stack half of the same decision, and it can only live here: a
               * back button exists on pushed screens and nowhere else, so this is
               * not an option the tab navigator can take.
               *
               * `minimal` keeps the chevron and drops the word beside it. iOS
               * otherwise labels the control with the previous screen's title,
               * which on a stack whose titles are sentences. "Personal records",
               * "Set count per muscle". Puts a back button wider than the title it
               * sits next to, and pushes the title along to make room for itself.
               * `headerBackTitleVisible` is the older spelling of this and still
               * typechecks, but react-native-screens now drives the native
               * `UINavigationItemBackButtonDisplayMode` directly, so the newer name
               * is the one that maps onto what the platform actually does.
               */
              headerBackButtonDisplayMode: 'minimal',
              contentStyle: { backgroundColor: colors.background },
              /**
               * The platform's own push, with no override.
               *
               * This used to carry a warning that any explicit animation hitched,
               * because these screens mount straight into a database query and the
               * two landed on top of each other. That was true, and it was never
               * about the animation: a native stack push runs on the OS side and
               * cannot be slowed down by JS. What hitched was the *incoming mount*:
               * the query resolving mid-push and re-rendering a screenful of charts.
               * `useDeferredFocusEffect` moves that work behind the transition, and
               * with it gone there is nothing left here to compensate for.
               *
               * It stays on the platform default anyway, on its own merits: iOS and
               * Android disagree about what a push looks like, users of each expect
               * their own, and the OS knows the current gesture-navigation setting
               * where a constant in this file would not.
               */

              /*
               * No `freezeOnBlur` here, unlike the tab navigator.
               *
               * It would be a real saving: a covered screen's live queries re-run
               * on every write the user cannot see, but the stack is the one place
               * a blurred screen gets *looked at* before it is focused again: an
               * iOS back-swipe reveals the screen underneath progressively, under
               * the user's thumb, for as long as the gesture lasts. Unfreezing is
               * driven from the transition, so what is revealed at the start of that
               * drag is a subtree React has not resumed yet.
               *
               * That is the same class of artefact this pass exists to remove, and
               * trading it for query traffic the tab bar's own `freezeOnBlur`
               * already covers most of is not a trade worth making.
               */
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          </Stack>
        </View>
      </View>

      {/*
        Last, so it is over everything: the navigator, the rail, and the three
        headless listeners above. It is opaque and fills the screen, so nothing
        behind it is ever seen, and it unmounts for good the moment the flow is
        finished or skipped.
      */}
      {onboarding && <Onboarding />}
    </>
  );
}

function StartupSpinner() {
  const colors = useColors();
  return (
    <View style={[styles.centered, { backgroundColor: colors.background }]}>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

/**
 * The last screen before a dead app, so it has to offer more than the message.
 *
 * Retry remounts `Bootstrap` and re-runs the whole sequence: worth a tap,
 * because a locked database or a busy file system recovers on its own. Export
 * is the escape hatch that matters: the training log only exists on this phone,
 * and a failed migration is exactly when someone reaches for a reinstall.
 *
 * Export runs inline rather than pushing `/export`. When this renders there is
 * no navigator mounted (`Bootstrap` returned this instead of the `Stack`) so
 * a route push here would go nowhere. Writing the file needs reads only, which
 * a database that opened can still serve even when migrating it failed.
 */
/**
 * What renders when a screen throws, rather than the app closing.
 *
 * expo-router wraps a route in its `Try` boundary *only* when that route's
 * module exports `ErrorBoundary`, and `ExpoRoot` installs no default. Without
 * this export a render throw after boot went to the native fatal handler, which
 * in a release build closes the app mid-session: the user is holding a session
 * they have been logging for forty minutes and the app is simply gone. The
 * careful `StartupError` below only ever covered the database failing to open.
 *
 * It offers the same backup escape hatch for the same reason: the crash may be
 * repeatable, and the training log on this device may be the only copy.
 *
 * `useColors` is safe here despite this rendering outside `AppThemeProvider`.
 * `ThemeContext` carries a real default palette, so the boundary cannot itself
 * throw on a missing provider, which is the one thing a crash screen must not
 * do.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <>
      <StartupError error={error} onRetry={() => void retry()} title="Lift hit an error" />
      {/*
        Its own `DialogHost`, because the one in `RootLayout` is not mounted
        here. expo-router's boundary replaces the tree it was wrapping, so the
        export button's only way of reporting where the file went, or that the
        export failed, would otherwise be a dialog with nowhere to render: the
        button would appear to do nothing on the one screen where doing nothing
        is least acceptable. `DialogHost` needs `useColors`, which has a default
        palette, and a plain RN `Modal`, so it works outside every provider.
      */}
      <DialogHost />
    </>
  );
}

function StartupError({
  error,
  onRetry,
  title = "Couldn't start Lift",
}: {
  error: Error;
  onRetry: () => void;
  title?: string;
}) {
  const colors = useColors();
  const [exporting, setExporting] = useState(false);

  const exportBackup = async () => {
    setExporting(true);
    try {
      const file = await writeBackupFile();

      if (!(await Sharing.isAvailableAsync())) {
        void showAlert('Sharing unavailable', `File written to:\n${file.uri}`);
        return;
      }

      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/json',
        dialogTitle: 'Export Lift backup',
      });
    } catch (exportError) {
      void showAlert('Export failed', (exportError as Error).message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <View style={[styles.centered, { backgroundColor: colors.background }]}>
      <Text variant="subheading" align="center">
        {title}
      </Text>
      <Text variant="body" color="textSecondary" align="center" style={styles.errorDetail}>
        {error.message}
      </Text>
      <Text variant="caption" color="textTertiary" align="center" style={styles.errorDetail}>
        Your workouts are still on this device. Export a copy before reinstalling.
      </Text>
      <View style={styles.errorActions}>
        <Button title="Try again" onPress={onRetry} disabled={exporting} fullWidth />
        <Button
          title="Export a backup"
          variant="secondary"
          icon="download-outline"
          loading={exporting}
          disabled={exporting}
          onPress={() => void exportBackup()}
          fullWidth
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  shell: { flex: 1, flexDirection: 'row' },
  // `minWidth: 0` because a flex row's children default to their content size as
  // a floor, and the navigator's content includes list rows that would rather be
  // wider than the pane. Without it a long exercise name pushes the pane out and
  // the rail off the left edge of the window instead of ellipsising.
  pane: { flex: 1, minWidth: 0 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
    gap: spacing.md,
  },
  errorDetail: { maxWidth: 320 },
  errorActions: {
    width: '100%',
    maxWidth: 320,
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
});
