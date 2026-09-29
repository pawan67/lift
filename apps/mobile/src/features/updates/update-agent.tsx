/**
 * Looks for new versions while the app is open, says when one has arrived, and
 * optionally installs it.
 *
 * Mounted at the root beside `WorkoutNotice`, and like it renders nothing.
 * `expo-updates` on its own only checks at launch, and Android keeps an app in
 * memory for days between launches, so an update published this morning could
 * sit unseen until the phone next ran low on memory. This closes that gap in
 * three steps:
 *
 * 1. **Check on resume.** Every return to the foreground, and every half hour
 *    while the app stays in front, at most once per `CHECK_INTERVAL_MS`. A
 *    check that finds something downloads it straight away.
 * 2. **Notify once it is downloaded.** One notification per update, and not
 *    while a workout is open: it waits for the session to end rather than
 *    landing on top of a set.
 * 3. **Install on return.** With `autoInstallUpdates` on, a downloaded update is
 *    applied the next time the user comes back after `AWAY_BEFORE_INSTALL_MS`
 *    or more, with no workout open. A reload is a cold start, and coming back
 *    after a while is the one moment it looks like one anyway. A quick app
 *    switch never triggers it.
 *
 * All of it is JavaScript over modules the APK already carries, so none of it
 * moves the runtime fingerprint, and it reaches installed builds as an update
 * itself.
 */

import { and, isNull } from 'drizzle-orm';
import * as Updates from 'expo-updates';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { db } from '@/db/client';
import { workouts } from '@/db/schema';
import { useRows } from '@/db/use-rows';
import { getNotifications } from '@/features/notifications/module';
import { APP_UPDATE_TYPE } from '@/features/notifications/presentation';
import { clearUpdateReady, showUpdateReady } from '@/features/notifications/update';
import { useSettings } from '@/store/settings';

import { checkAndFetch, confirmUpdateRestart, UPDATES_SUPPORTED } from './use-app-update';

/** How long a completed check stands before the next one is worth making. */
const CHECK_INTERVAL_MS = 30 * 60_000;

/** How often the in-front timer looks at the clock. The check itself is throttled. */
const TICK_MS = 60_000;

/**
 * How long the app has to have been away before a return may restart it.
 *
 * Long enough that switching to a music app between sets, or glancing at a
 * message, never comes back to a splash screen. Short enough that "I closed it
 * after lunch" counts.
 */
const AWAY_BEFORE_INSTALL_MS = 5 * 60_000;

/**
 * When a check last ran. Starts at load, because the native side has just made
 * the launch check and a second one now would ask the same question twice.
 */
let lastCheckAt = Date.now();

/**
 * Updates already announced, by id.
 *
 * Module scope so a remount does not announce the same one twice. A rollback
 * directive has no id and is keyed by the word instead; there is at most one of
 * those pending at a time.
 */
const announced = new Set<string>();

export function UpdateAgent() {
  // A constant for the life of the process, so this is not a conditional hook:
  // the branch never changes sides between renders.
  return UPDATES_SUPPORTED ? <Agent /> : null;
}

function Agent() {
  const { isUpdatePending, isChecking, isDownloading, downloadedUpdate } = Updates.useUpdates();
  const notify = useSettings((state) => state.updateNotifications);
  const autoInstall = useSettings((state) => state.autoInstallUpdates);

  const { rows: openWorkouts, loaded } = useRows(
    db
      .select({ id: workouts.id })
      .from(workouts)
      .where(and(isNull(workouts.finishedAt), isNull(workouts.deletedAt)))
      .limit(1),
  );
  // Unknown counts as open. Everything this gates is a restart or an
  // interruption, and the safe guess for both is "someone is mid-set".
  const workoutOpen = !loaded || openWorkouts.length > 0;

  /*
   * The latest of everything, for the AppState listener and the timer.
   *
   * Both are installed once and outlive every render, so they read through this
   * rather than closing over values that would be stale by the time they fire.
   */
  const live = useRef({ pending: false, busy: false, workoutOpen: true, autoInstall });
  useEffect(() => {
    live.current = {
      pending: isUpdatePending,
      busy: isChecking || isDownloading,
      workoutOpen,
      autoInstall,
    };
  });

  // Whatever the shade still says about the last process is stale by now: a
  // downloaded update is exactly what a cold start or a reload launches.
  useEffect(() => {
    void clearUpdateReady();
  }, []);

  // Steps 1 and 3.
  useEffect(() => {
    let backgroundedAt: number | null = null;

    const check = () => {
      const state = live.current;
      // Pending means there is nothing newer worth fetching until this one is
      // applied, and busy means the launch check or the settings row got here
      // first.
      if (state.pending || state.busy) return;
      if (Date.now() - lastCheckAt < CHECK_INTERVAL_MS) return;
      lastCheckAt = Date.now();
      void checkAndFetch();
    };

    const subscription = AppState.addEventListener('change', (next) => {
      // `background` rather than anything not `active`: iOS passes through
      // `inactive` for a pulled-down control centre, which is not leaving.
      if (next === 'background') {
        backgroundedAt ??= Date.now();
        return;
      }
      if (next !== 'active') return;

      const away = backgroundedAt === null ? 0 : Date.now() - backgroundedAt;
      backgroundedAt = null;

      const state = live.current;
      if (state.pending && state.autoInstall && !state.workoutOpen && away >= AWAY_BEFORE_INSTALL_MS) {
        void Updates.reloadAsync().catch(() => {
          // Left pending; the next cold start applies it.
        });
        return;
      }

      check();
    });

    const timer = setInterval(() => {
      if (AppState.currentState === 'active') check();
    }, TICK_MS);

    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, []);

  // Step 2.
  const readyKey = isUpdatePending ? (downloadedUpdate?.updateId ?? 'rollback') : null;
  useEffect(() => {
    if (readyKey === null || !notify || workoutOpen || announced.has(readyKey)) return;
    announced.add(readyKey);
    void showUpdateReady(autoInstall);
  }, [readyKey, notify, workoutOpen, autoInstall]);

  /*
   * A tap on that notification.
   *
   * Only the listener, and no `getLastNotificationResponse`: a tap that
   * cold-starts the app has already been answered, because a cold start
   * launches the downloaded update. This is the case where the process was
   * still alive and the update is still waiting.
   */
  useEffect(() => {
    const Notifications = getNotifications();
    if (!Notifications) return;

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      if (response.notification.request.content.data?.type !== APP_UPDATE_TYPE) return;
      void restartFromTap(live.current);
    });

    return () => subscription.remove();
  }, []);

  return null;
}

/**
 * The notification said "tap to restart", so no workout means no question.
 * With one open it still asks: the tap may have been meant as "later", and a
 * reload mid-session is the user's call rather than ours.
 */
async function restartFromTap(state: { pending: boolean; workoutOpen: boolean }): Promise<void> {
  if (!state.pending) return;
  if (state.workoutOpen && !(await confirmUpdateRestart())) return;

  try {
    await Updates.reloadAsync();
  } catch {
    // Left pending; the settings row still offers it and a cold start applies it.
  }
}
