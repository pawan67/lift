/**
 * User preferences.
 *
 * Held in a Zustand store for synchronous reads (formatting code runs inside
 * render and can't await), and mirrored into the `settings` table so they
 * survive restarts. Writes update memory first and persist in the background.
 * A preference toggle should never feel like it waits on disk.
 */

import {
  defaultBarKg,
  DEFAULT_TRAINING_LEVEL,
  USES_BODYWEIGHT,
  type AiProvider,
  type DistanceUnit,
  type MeasurementUnit,
  type OneRepMaxFormula,
  type Sex,
  type ThemePreference,
  type TrackingType,
  type TrainingLevel,
  type WeightUnit,
} from '@lift/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { create } from 'zustand';

import { db } from '@/db/client';
import { bodyMeasurements, settings as settingsTable } from '@/db/schema';

/**
 * Which of the phone's volume sliders the rest bell rings on.
 *
 * A phone has three of them and they are three different promises. `media` is
 * the app playing a sound of its own: it rides the music volume, and with
 * earbuds paired it goes to the earbuds and nowhere else, which is silence for
 * anyone who has just taken them out to squat. The other two hand the bell to
 * the OS, which routes it the way it routes a text message or an alarm: through
 * the phone's own speaker as well as whatever is paired, at the ring or the
 * alarm slider rather than at whatever the music is set to.
 *
 * `alarm` is the loudest of the three and is the one that survives a phone left
 * across the room. `notification` is the same routing at a volume that will not
 * make the whole gym look up.
 *
 * See `features/notifications/rest.ts` for how each is delivered, and note that
 * the countdown beeps are `media` whichever of the three is chosen: they are
 * the app talking, seven times a set, and no phone has a volume slider for
 * that.
 */
export type RestSoundOutput = 'media' | 'notification' | 'alarm';

export interface Settings {
  weightUnit: WeightUnit;
  distanceUnit: DistanceUnit;
  measurementUnit: MeasurementUnit;
  themePreference: ThemePreference;

  /** The RPE (Reps in Reserve) value the effort dialog starts at. */
  defaultRpe: number;

  /** Fallback rest duration when an exercise defines none. */
  defaultRestSeconds: number;
  restTimerEnabled: boolean;
  /** Start the rest timer automatically when a set is checked off. */
  restTimerAutoStart: boolean;
  restTimerNotifications: boolean;
  /** Buzz on each of the last three seconds, so the cue starts before zero. */
  restTimerCountdownCues: boolean;
  soundEnabled: boolean;
  /** Which of the phone's volume sliders the rest bell rings on. */
  restTimerSoundOutput: RestSoundOutput;
  /**
   * Whether the last ten seconds are counted out loud.
   *
   * Separate from `soundEnabled`, which is the whole of the timer's voice. The
   * seven beeps and the bell are two different promises: the bell says rest is
   * over and is worth hearing across a gym, and the countdown is a running
   * commentary aimed at someone about to get back under a bar. Wanting the one
   * without the other is an ordinary preference, and before this the only way
   * to drop the commentary was to drop the alert with it.
   */
  restTimerCountdownBeeps: boolean;
  hapticsEnabled: boolean;
  /** Keep the screen on during an active workout. */
  keepAwakeDuringWorkout: boolean;

  oneRepMaxFormula: OneRepMaxFormula;
  /** Default barbell weight for the plate calculator, in kg. */
  barWeightKg: number;
  /**
   * 0 = Sunday, 1 = Monday. Which column the calendar's grid starts on.
   *
   * The weekly streak and the history buckets are Monday-based regardless:
   * see `weekKey` in `@lift/shared`, so this is deliberately described to the
   * user as a calendar setting and nothing more.
   */
  firstDayOfWeek: 0 | 1;

  /**
   * Used to value bodyweight exercises. Null means push-ups and pull-ups log
   * zero volume, so this is mirrored from every bodyweight entry in
   * Measurements rather than being a second number the user has to maintain.
   */
  bodyweightKg: number | null;

  /**
   * Height in centimetres, and the sex the body-fat regression is fitted for.
   *
   * Both exist for the derived figures on the measurements screen. BMI and
   * waist-to-height need the height, the US Navy body-fat estimate needs both,
   * and for nothing else. Null is a supported state throughout: leaving either
   * blank costs only the estimates that depend on it, so neither is ever asked
   * for as a condition of logging a measurement.
   */
  heightCm: number | null;
  sex: Sex | null;

  /** Prompts the routine to update when sets change mid-workout. */
  promptRoutineUpdate: boolean;

  /** Reminds the user to go to the gym at a specific time. */
  gymReminderEnabled: boolean;
  /** Format HH:mm, e.g. "17:30" */
  gymReminderTime: string;

  /**
   * Reminds the user to weigh in, and takes the reading from the notification.
   *
   * Kept apart from `gymReminderEnabled` rather than folded into it because the
   * two are asking for different things at different hours: a weigh-in is worth
   * something only when it is taken under the same conditions every day, which
   * for most people is first thing, and the gym is not. Sharing one time would
   * mean choosing which of the two to schedule badly.
   */
  weighInReminderEnabled: boolean;
  /** Format HH:mm, e.g. "08:00" */
  weighInReminderTime: string;

  /**
   * The AI coach, and why it is off until somebody turns it on.
   *
   * This app's whole claim is that nothing leaves the device unless it is asked
   * to. A model call is the first thing in it that contacts a third party, so
   * the default is off, the key is the user's own, and every screen that offers
   * an AI reading works without one. Turning it on is a deliberate act taken on
   * a screen that names the host it will contact.
   *
   * The key itself is not here. Settings are a JSON blob in an ordinary SQLite
   * row; a credential belongs in the keychain, which is `features/ai/key-storage`.
   */
  aiEnabled: boolean;
  aiProvider: AiProvider;
  /** Empty means "whatever `DEFAULT_AI_MODELS` says for this provider". */
  aiModel: string;
  /** Origin only. Empty means the provider's own address. Ignored for Anthropic. */
  aiBaseUrl: string;
  /**
   * Write the session summary without being asked.
   *
   * Off by default because it spends money on a request nobody requested, and
   * because the finish screen is the worst place in the app to introduce a wait.
   * On, the card fills itself in behind the totals that are already on screen.
   */
  aiAutoSummary: boolean;

  /**
   * Which column of the landmark table the volume advice is judged against.
   *
   * Every statistics screen hardcodes `intermediate` today, and that was fine
   * while the landmarks were a colour ramp. Advice is different: telling a
   * genuine beginner they are eight sets short of an MEV fitted for someone
   * three years in is how a useful feature becomes one people switch off.
   */
  trainingLevel: TrainingLevel;
}

export const DEFAULT_SETTINGS: Settings = {
  weightUnit: 'kg',
  distanceUnit: 'km',
  measurementUnit: 'cm',
  themePreference: 'system',
  defaultRpe: 8,
  defaultRestSeconds: 120,
  restTimerEnabled: true,
  restTimerAutoStart: true,
  restTimerNotifications: true,
  restTimerCountdownCues: true,
  soundEnabled: true,
  // Not `media`, which is what the app did before this setting existed: a bell
  // that only the earbuds you took off can hear is the bug this option is for,
  // and defaulting to the old behaviour would leave it in place for everyone
  // who never finds the row. `notification` rather than `alarm` because it is
  // the quieter of the two fixes.
  restTimerSoundOutput: 'notification',
  // On, which is what the app has always done. The row exists for the people
  // who want the bell alone, not to change the answer for everyone.
  restTimerCountdownBeeps: true,
  hapticsEnabled: true,
  keepAwakeDuringWorkout: true,

  oneRepMaxFormula: 'brzycki',
  // Read from the same place `update` reads it, so "still the default" is a
  // comparison against one constant rather than against a literal that has to
  // be kept in step with `packages/shared/src/plates.ts` by hand.
  barWeightKg: defaultBarKg('kg'),
  firstDayOfWeek: 1,

  bodyweightKg: null,
  heightCm: null,
  sex: null,

  promptRoutineUpdate: true,

  gymReminderEnabled: false,
  gymReminderTime: "17:00",

  weighInReminderEnabled: false,
  // First thing, before breakfast and before the day's water moves the figure
  // by more than the week's actual trend does. The one hour where a daily
  // weigh-in is comparable with the one before it.
  weighInReminderTime: '08:00',

  aiEnabled: false,
  aiProvider: 'anthropic',
  aiModel: '',
  aiBaseUrl: '',
  aiAutoSummary: false,
  trainingLevel: DEFAULT_TRAINING_LEVEL,
};

interface SettingsStore extends Settings {
  /** False until the persisted values have been read back from SQLite. */
  hydrated: boolean;
  hydrate: () => Promise<void>;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  reset: () => Promise<void>;
}

const SETTINGS_KEY = 'user_settings';

export const useSettings = create<SettingsStore>((set, get) => ({
  ...DEFAULT_SETTINGS,
  hydrated: false,

  hydrate: async () => {
    let stored: Partial<Settings> = {};

    try {
      const [row] = await db
        .select()
        .from(settingsTable)
        .where(eq(settingsTable.key, SETTINGS_KEY))
        .limit(1);

      if (row?.value) stored = JSON.parse(row.value) as Partial<Settings>;
    } catch {
      // A corrupt or unreadable row should not block app start. Fall through
      // to defaults, which will be rewritten on the next change.
    }

    // Spread defaults first so a settings key added in a later release gets a
    // sensible value instead of `undefined`.
    const next: Settings = { ...DEFAULT_SETTINGS, ...stored };

    // Backfill from the measurement log. Until this release nothing ever wrote
    // `bodyweightKg`, so every user who had logged a bodyweight in Measurements
    // was still valuing their push-ups at zero. The number is already on the
    // device; asking for it again would be asking the user to fix our bug.
    if (next.bodyweightKg == null) {
      const logged = await readLatestBodyweightKg();
      if (logged != null) {
        next.bodyweightKg = logged;
        void persist(next);
      }
    }

    set({ ...next, hydrated: true });
  },

  update: (key, value) => {
    const patch: Partial<Settings> = { [key]: value };

    /*
     * Switching weight units brings the bar with them, but only while it is
     * still whichever default it arrived as.
     *
     * A kg gym's bar is 20 kg and a lb gym's is 45 lb, and those are different
     * bars, not one bar described twice. Leaving the stored 20 kg alone when
     * someone switched to lb gave them a "44.09 lb" bar: an oddly precise
     * number that is wrong in every gym on that side of the Atlantic, sitting
     * under a plate calculator that then solved for the wrong remainder.
     *
     * Guarded on the old default rather than applied unconditionally, because
     * the alternative is silently overwriting a real preference. Someone who
     * set a 15 kg bar meant it, and a unit switch is not a request to forget
     * that. They get their 15 kg bar rendered as 33.07 lb, which is at least
     * the bar they own.
     */
    if (key === 'weightUnit') {
      const to = value as WeightUnit;
      const from: WeightUnit = to === 'kg' ? 'lb' : 'kg';
      if (get().barWeightKg === defaultBarKg(from)) patch.barWeightKg = defaultBarKg(to);
    }

    set(patch as Pick<Settings, typeof key>);
    void persist(get());
  },

  /**
   * Back to the defaults. Except the three figures that are not preferences.
   *
   * Bodyweight, height and sex are facts about a person, not choices about how
   * the app behaves, and nobody tapping "reset settings" is asking to be
   * forgotten. Clearing `bodyweightKg` in particular is not even a clean
   * deletion: the number is mirrored from the measurement log, so it would come
   * back on the next app start (`hydrate` backfills it) and in the meantime
   * every push-up and pull-up logged would count as zero volume. A reset that
   * quietly breaks the volume figures until the process is restarted.
   */
  reset: async () => {
    const { bodyweightKg, heightCm, sex } = get();
    set({ ...DEFAULT_SETTINGS, bodyweightKg, heightCm, sex, hydrated: true });
    await persist(get());
  },
}));

/**
 * Latest bodyweight from the measurement log, in kg.
 *
 * Read straight off the table rather than through
 * `features/measurements/repository`, which imports this store to mirror new
 * entries into it. Going the other way too would close the cycle.
 */
async function readLatestBodyweightKg(): Promise<number | null> {
  try {
    const [row] = await db
      .select({ value: bodyMeasurements.value })
      .from(bodyMeasurements)
      .where(and(eq(bodyMeasurements.kind, 'bodyweight'), isNull(bodyMeasurements.deletedAt)))
      .orderBy(desc(bodyMeasurements.measuredAt))
      .limit(1);

    return row?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether a set of tracking types needs a bodyweight the app does not have.
 *
 * Read imperatively because the only caller is an event handler (finishing a
 * workout), and because the answer has to be true *at that moment* rather than
 * at the last render. `USES_BODYWEIGHT`, not `TRACKING_FIELDS`: see the note
 * beside it in `@lift/shared`: a push-up renders no weight field yet its whole
 * volume is bodyweight.
 */
export function bodyweightMissingFor(trackingTypes: Iterable<TrackingType>): boolean {
  if (useSettings.getState().bodyweightKg != null) return false;
  for (const trackingType of trackingTypes) {
    if (USES_BODYWEIGHT.has(trackingType)) return true;
  }
  return false;
}

async function persist(state: Settings): Promise<void> {
  const payload: Settings = {
    weightUnit: state.weightUnit,
    distanceUnit: state.distanceUnit,
    measurementUnit: state.measurementUnit,
    themePreference: state.themePreference,
    defaultRpe: state.defaultRpe,
    defaultRestSeconds: state.defaultRestSeconds,
    restTimerEnabled: state.restTimerEnabled,
    restTimerAutoStart: state.restTimerAutoStart,
    restTimerNotifications: state.restTimerNotifications,
    restTimerCountdownCues: state.restTimerCountdownCues,
    soundEnabled: state.soundEnabled,
    restTimerSoundOutput: state.restTimerSoundOutput,
    restTimerCountdownBeeps: state.restTimerCountdownBeeps,
    hapticsEnabled: state.hapticsEnabled,
    keepAwakeDuringWorkout: state.keepAwakeDuringWorkout,
    oneRepMaxFormula: state.oneRepMaxFormula,
    barWeightKg: state.barWeightKg,
    firstDayOfWeek: state.firstDayOfWeek,
    bodyweightKg: state.bodyweightKg,
    heightCm: state.heightCm,
    sex: state.sex,
    promptRoutineUpdate: state.promptRoutineUpdate,
    gymReminderEnabled: state.gymReminderEnabled,
    gymReminderTime: state.gymReminderTime,
    weighInReminderEnabled: state.weighInReminderEnabled,
    weighInReminderTime: state.weighInReminderTime,
    aiEnabled: state.aiEnabled,
    aiProvider: state.aiProvider,
    aiModel: state.aiModel,
    aiBaseUrl: state.aiBaseUrl,
    aiAutoSummary: state.aiAutoSummary,
    trainingLevel: state.trainingLevel,
  };

  await db
    .insert(settingsTable)
    .values({ key: SETTINGS_KEY, value: JSON.stringify(payload), updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: settingsTable.key,
      set: { value: JSON.stringify(payload), updatedAt: Date.now() },
    });
}
