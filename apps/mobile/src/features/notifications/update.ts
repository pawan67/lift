/**
 * "A new version is ready", as a notification.
 *
 * Posted by `features/updates/update-agent` once an over-the-air update has
 * finished downloading, and never before: an update that is merely available
 * is a promise, and a notification that says so would be followed by a
 * download the user can do nothing to hurry. Once the bytes are on the phone,
 * a tap is all that stands between them and the new version, which is the one
 * moment worth interrupting anybody for.
 *
 * Local, not push. Nothing on a server knows which phones exist, and nothing
 * needs to: the phone asks EAS itself on launch and on every return to the
 * foreground, so "published" reaches it the next time the app is looked at.
 * That keeps this within what the installed APK already carries, so the
 * feature arrives by the same OTA path it announces.
 */

import { Platform } from 'react-native';

import { getNotifications } from './module';
import { APP_UPDATE_TYPE, configureNotificationHandler } from './presentation';
import type { ReminderPermission } from './reminder';

/**
 * DEFAULT importance: it sounds and sits in the shade, but does not drop a
 * heads-up banner over whatever is on screen. An update is news, not an alarm,
 * and its own channel means it can be muted in system settings without losing
 * the rest bell or the reminders.
 */
const ANDROID_CHANNEL_ID = 'app-updates';

/** Fixed, so a second update downloaded before the first was applied replaces it. */
const NOTIFICATION_ID = 'app-update-ready';

let channelReady = false;

async function ensureChannel(
  Notifications: NonNullable<ReturnType<typeof getNotifications>>,
): Promise<void> {
  if (Platform.OS !== 'android' || channelReady) return;
  channelReady = true;

  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'App updates',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: null,
    showBadge: false,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

/**
 * Requests permission and prepares the channel. For the settings switch only.
 *
 * Same answer shape as the reminders, so the switch can explain itself the
 * same way when it refuses to turn on.
 */
export async function prepareUpdateNotifications(): Promise<ReminderPermission> {
  configureNotificationHandler();

  const Notifications = getNotifications();
  if (!Notifications) return 'unsupported';

  await ensureChannel(Notifications);

  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return 'granted';
  if (!existing.canAskAgain) return 'denied';

  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted ? 'granted' : 'denied';
}

/**
 * Posts the notification, if the permission is already there.
 *
 * Never prompts. The agent calls this from the background of a launch or a
 * resume, which is the wrong moment to ask for anything, and a user who has
 * refused notifications has not asked to be told about updates either. The
 * settings row still says what state the update is in.
 *
 * @param autoInstall Whether the agent will apply it on its own, which changes
 *   what the body promises.
 */
export async function showUpdateReady(autoInstall: boolean): Promise<void> {
  configureNotificationHandler();

  const Notifications = getNotifications();
  if (!Notifications) return;

  try {
    const existing = await Notifications.getPermissionsAsync();
    if (!existing.granted) return;

    await ensureChannel(Notifications);

    await Notifications.scheduleNotificationAsync({
      identifier: NOTIFICATION_ID,
      content: {
        title: 'Lift update ready',
        body: autoInstall
          ? 'It installs the next time you come back to Lift. Tap to restart on it now.'
          : 'Tap to restart on the new version. Your workouts are kept.',
        data: { type: APP_UPDATE_TYPE },
      },
      // Immediate, on this channel rather than Android's default one, which is
      // HIGH and would turn a version bump into a heads-up banner.
      trigger: Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL_ID } : null,
    });
  } catch {
    // A channel the user switched off, or a permission revoked a moment ago.
    // The update is unaffected: it still applies on the next cold start.
  }
}

/** Removes the notification, once the update it describes is being applied. */
export async function clearUpdateReady(): Promise<void> {
  const Notifications = getNotifications();
  if (!Notifications) return;

  try {
    await Notifications.dismissNotificationAsync(NOTIFICATION_ID);
  } catch {
    // Already gone.
  }
}
