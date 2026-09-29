/**
 * What the app knows about its own next version.
 *
 * `expo-updates` replaces the JavaScript bundle and the assets that go with it,
 * and nothing else. Anything native: a new Expo module, a permission, an SDK
 * bump, still needs a fresh APK, and the `runtimeVersion` fingerprint in
 * app.json is what enforces that. A build only ever sees updates published
 * against its own fingerprint, so the case this hook cannot reach is also the
 * case it can never get wrong.
 *
 * The default configuration checks on launch and downloads in the background,
 * and a downloaded update is picked up by the next cold start on its own.
 * `./update-agent` adds a check on every return to the foreground, a
 * notification once something has downloaded, and an optional restart into it.
 * This hook is the settings row's view of the same state: it says what the
 * background process is doing and offers to skip the wait. Nothing here is
 * load-bearing, which is why every failure below is reported and then dropped
 * rather than retried.
 */

import * as Updates from 'expo-updates';
import { useCallback } from 'react';
import { Platform } from 'react-native';

import { showConfirm } from '@/store/dialog';

/**
 * Whether this build can receive updates at all.
 *
 * Two separate reasons it might not, and they need different tests. On native,
 * `isEnabled` is false in a development build and in any build with no update
 * URL configured, which is the honest answer. On web it is hardcoded *true* by
 * the web shim (see `ExpoUpdates.web.js`) even though `checkForUpdateAsync`
 * there always answers "nothing available" and `reload` is a page refresh, so
 * `isEnabled` alone would put a permanently useless row on the web build's
 * settings screen. The platform check has to come first.
 */
export const UPDATES_SUPPORTED = Platform.OS !== 'web' && Updates.isEnabled;

export type UpdateStatus =
  /** No update mechanism in this build: development, or the web export. */
  | 'unsupported'
  /** Nothing known yet. No check has completed since launch. */
  | 'idle'
  | 'checking'
  /** The server has one, and it is not on the device yet. */
  | 'available'
  | 'downloading'
  /** On the device and waiting for a restart. */
  | 'ready'
  | 'restarting'
  /** A check completed and the server had nothing newer. */
  | 'upToDate'
  | 'failed';

export interface AppUpdate {
  status: UpdateStatus;
  /** 0 to 1 while downloading, `null` at every other moment. */
  progress: number | null;
  /** The most recent failure, in the library's own words. */
  error: string | null;
  /**
   * Which bundle is on screen right now, for a bug report.
   *
   * The update's UUID when running a downloaded one, and the word "built in"
   * when running the bundle that shipped inside the APK. The distinction is the
   * first thing worth knowing about a bug that only one person can reproduce.
   */
  running: string;
  /** Asks the server, and starts the download if there is something to download. */
  check: () => void;
  /** Restarts into the downloaded update, fetching it first if need be. */
  install: () => void;
}

/**
 * Asks the server, and downloads whatever it offers.
 *
 * Downloading immediately rather than stopping at "available": nobody wants a
 * version they cannot run yet, and the download is what makes the restart that
 * follows it instant. Shared by the settings row's button and by the agent's
 * checks on resume, so the two can never disagree about what a check does.
 *
 * Both calls reject as well as populating `checkError` / `downloadError` on
 * `useUpdates`, so the catch is not error handling: the state the UI reads is
 * already being set. It is here so an offline check does not surface as an
 * unhandled rejection, which on Android is a red box over the app.
 */
export async function checkAndFetch(): Promise<void> {
  try {
    const result = await Updates.checkForUpdateAsync();
    if (result.isAvailable) await Updates.fetchUpdateAsync();
  } catch {
    // Reported through `checkError` / `downloadError`.
  }
}

/**
 * Asks before restarting into a downloaded update.
 *
 * Asked rather than done, because a reload is a cold start: the screen goes
 * away and comes back. Everything logged is already in the database and the
 * rest period is restored on launch, so nothing is lost, but the moment is the
 * user's to pick. Mid-set is not it.
 */
export function confirmUpdateRestart(): Promise<boolean> {
  return showConfirm({
    title: 'Restart now?',
    message:
      'Lift closes and reopens on the new version. Your workouts, and any rest timer running, are kept.',
    confirmLabel: 'Restart',
    tone: 'confirm',
  });
}

export function useAppUpdate(): AppUpdate {
  const {
    currentlyRunning,
    availableUpdate,
    isUpdateAvailable,
    isUpdatePending,
    isChecking,
    isDownloading,
    isRestarting,
    downloadProgress,
    checkError,
    downloadError,
    lastCheckForUpdateTimeSinceRestart,
  } = Updates.useUpdates();

  const check = useCallback(() => {
    void checkAndFetch();
  }, []);

  const install = useCallback(() => {
    void (async () => {
      try {
        // `isUpdatePending` means the bytes are already on disk, so this is the
        // ordinary path from the launch-time background download and it skips
        // straight to the restart. Fetching first covers the case where the row
        // was reached from `available`, which only happens if a download failed
        // and is being retried.
        if (!isUpdatePending) await Updates.fetchUpdateAsync();
        await Updates.reloadAsync();
      } catch {
        // Same as above.
      }
    })();
  }, [isUpdatePending]);

  const error = downloadError?.message ?? checkError?.message ?? null;

  return {
    status: resolveStatus({
      isChecking,
      isDownloading,
      isRestarting,
      isUpdateAvailable,
      isUpdatePending,
      hasError: error !== null,
      hasChecked: lastCheckForUpdateTimeSinceRestart != null,
      // A rollback directive carries no `updateId` and is still something to
      // install, so availability is read from the presence of the update rather
      // than from its id.
      hasAvailable: availableUpdate != null,
    }),
    progress: isDownloading ? (downloadProgress ?? 0) : null,
    error,
    running: currentlyRunning.isEmbeddedLaunch
      ? 'Built in'
      : (currentlyRunning.updateId?.slice(0, 8) ?? 'Unknown'),
    check,
    install,
  };
}

/**
 * The one place the flags become a single word.
 *
 * Order is the whole content of this function: several of these are true at
 * once and the first match wins. Pending outranks downloading because a second
 * download can be running behind an update that is already on disk and ready,
 * and the ready one is the one the user can act on. Errors are checked after
 * the busy states so that retrying visibly clears the message, and before
 * `upToDate` so that a failed check is never reported as good news, which is
 * the reading that would send someone off to debug a bug that was already
 * fixed in a bundle they never received.
 */
function resolveStatus(flags: {
  isChecking: boolean;
  isDownloading: boolean;
  isRestarting: boolean;
  isUpdateAvailable: boolean;
  isUpdatePending: boolean;
  hasError: boolean;
  hasChecked: boolean;
  hasAvailable: boolean;
}): UpdateStatus {
  if (!UPDATES_SUPPORTED) return 'unsupported';
  if (flags.isRestarting) return 'restarting';
  if (flags.isUpdatePending) return 'ready';
  if (flags.isDownloading) return 'downloading';
  if (flags.isChecking) return 'checking';
  if (flags.hasError) return 'failed';
  if (flags.isUpdateAvailable || flags.hasAvailable) return 'available';
  if (flags.hasChecked) return 'upToDate';
  return 'idle';
}
