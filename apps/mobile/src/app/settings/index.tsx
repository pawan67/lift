import {
  AI_PROVIDER_LABELS,
  ONE_REP_MAX_FORMULA_LABELS,
  formatClockTime,
  formatDuration,
  formatMeasurement,
  formatWeight,
} from '@lift/shared';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Card, Divider, ListRow, Reveal, SectionHeader, Text } from '@/components/ui';
import { Footnote, SettingsPage, settingsStyles } from '@/features/settings/page';
import { SettingAction } from '@/features/settings/rows';
import { THEME_LABELS } from '@/features/settings/theme-picker';
import { UpdateFooter, UpdateRow } from '@/features/updates/update-row';
import { UPDATES_SUPPORTED } from '@/features/updates/use-app-update';
import { showConfirm } from '@/store/dialog';
import { DEFAULT_SETTINGS, useSettings } from '@/store/settings';
import { spacing } from '@/theme';

/** Read once: the manifest cannot change while the process is alive. */
const APP_VERSION = Constants.expoConfig?.version;

/**
 * Settings, as five rows.
 *
 * This screen used to be every preference in the app stacked end to end: seven
 * sections and several phone-heights of scroll, topped by a summary band that
 * repeated three of the rows below it. The band went because a screen this
 * short no longer has anything to summarise, and the sections went to pages of
 * their own, so arriving here is a list of five destinations rather than a wall
 * to be scrolled through looking for one switch.
 *
 * Each row carries what its page currently holds rather than a description of
 * it. "Weight, distance and measurements" is a sentence the title already says;
 * "KG · KM · CM" is the answer to the question that brought anyone here, given
 * without the tap.
 */
export default function SettingsScreen() {
  const settings = useSettings();
  const reset = useSettings((state) => state.reset);

  const weightUnit = settings.weightUnit;
  const measurementUnit = settings.measurementUnit;

  const units = [settings.weightUnit, settings.distanceUnit, settings.measurementUnit]
    .map((unit) => unit.toUpperCase())
    .join(' · ');

  const appearance = `${THEME_LABELS[settings.themePreference]} · Week starts ${
    settings.firstDayOfWeek === 1 ? 'Monday' : 'Sunday'
  }`;

  // The rest timer first, because it is the only thing on that page that runs
  // during a set. A reminder is appended only when one is set: an "off" for
  // something nobody turned on is noise on a row that has one line.
  const workout = [
    settings.restTimerEnabled
      ? `Rest ${formatDuration(settings.defaultRestSeconds)}`
      : 'Rest timer off',
    settings.gymReminderEnabled
      ? `Reminder ${formatClockTime(settings.gymReminderTime)}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  // Named rather than described: someone who has set this up wants to see
  // which provider is going to be billed, and someone who has not wants the
  // one word that says nothing is being sent anywhere.
  const ai = settings.aiEnabled ? AI_PROVIDER_LABELS[settings.aiProvider] : 'Off';

  // Sex is deliberately left out. It is the one figure here somebody may not
  // want printed on the screen they opened in front of other people, and the
  // two that drive the estimates are the two worth showing.
  const body =
    [
      settings.bodyweightKg == null
        ? null
        : formatWeight(settings.bodyweightKg, weightUnit, { decimals: 1 }),
      settings.heightCm == null ? null : formatMeasurement(settings.heightCm, measurementUnit),
      // Appended only when set, on the same rule the workout row states: an
      // "off" for something nobody turned on is noise.
      settings.weighInReminderEnabled
        ? `Weigh-in ${formatClockTime(settings.weighInReminderTime)}`
        : null,
    ]
      .filter(Boolean)
      .join(' · ') || 'Not set';

  const calculations = `${ONE_REP_MAX_FORMULA_LABELS[settings.oneRepMaxFormula]} · ${formatWeight(
    settings.barWeightKg,
    weightUnit,
    { decimals: 1 },
  )} bar`;

  const confirmReset = async () => {
    const confirmed = await showConfirm({
      title: 'Reset settings?',
      message:
        'Units, theme, rest timer and calculation preferences go back to their defaults. Your workouts, exercises, measurements and body figures are not touched.',
      confirmLabel: 'Reset',
    });

    if (confirmed) await reset();
  };

  return (
    <SettingsPage title="Settings">
      <Reveal>
        {/*
         * A hue per row, in ramp order down the card.
         *
         * These five are categories in the plainest sense: five unrelated
         * groups of preferences, none more important than another, which is
         * exactly the case a role colour cannot express and the case the
         * category tones exist for. Written per row rather than mapped over an
         * array because these are five hand-placed rows and not a list, and a
         * row inserted here should have to choose its own colour rather than
         * silently take the one below it. See `CATEGORY_TONES` in `surfaces`.
         */}
        <Card padded={false} style={settingsStyles.first}>
          <ListRow
            icon="swap-horizontal-outline"
            tone="category0"
            title="Units"
            subtitle={units}
            onPress={() => router.push('/settings/units')}
          />
          <Divider inset={spacing.lg} />
          <ListRow
            icon="color-palette-outline"
            tone="category1"
            title="Appearance"
            subtitle={appearance}
            onPress={() => router.push('/settings/appearance')}
          />
          <Divider inset={spacing.lg} />
          <ListRow
            icon="barbell-outline"
            tone="category2"
            title="Workout"
            subtitle={workout}
            onPress={() => router.push('/settings/workout')}
          />
          <Divider inset={spacing.lg} />
          <ListRow
            icon="body-outline"
            tone="category3"
            title="Body"
            subtitle={body}
            onPress={() => router.push('/settings/body')}
          />
          <Divider inset={spacing.lg} />
          <ListRow
            icon="analytics-outline"
            tone="category4"
            title="Calculations"
            subtitle={calculations}
            onPress={() => router.push('/settings/calculations')}
          />
          <Divider inset={spacing.lg} />
          {/*
           * Last, and its subtitle says "Off" where the others summarise.
           *
           * Every row above holds preferences that are already in effect. This
           * one is the only place in Settings that turns on a request to a
           * third party, so the state worth putting on the hub is whether it is
           * on at all, not which model is named on the page.
           */}
          <ListRow
            icon="sparkles-outline"
            tone="category5"
            title="AI coach"
            subtitle={ai}
            onPress={() => router.push('/settings/ai')}
          />
        </Card>
      </Reveal>

      {/*
       * Updates stays on the hub rather than taking a page of its own.
       *
       * It is the one thing here that is not a preference: nothing is
       * remembered, and the row reports a state rather than holding a value.
       * A page containing a single row that answers itself the moment it opens
       * is a tap charged for nothing.
       *
       * The whole section is gated, header and footnote included: a development
       * build and the web export have no update mechanism at all, and a heading
       * over an empty card is worse than either a working row or no section.
       */}
      {UPDATES_SUPPORTED && (
        <Reveal index={1}>
          <SectionHeader title="Updates" />
          <Card padded={false} style={settingsStyles.section}>
            <UpdateRow />
          </Card>
          <Footnote>
            Updates carry the app itself, not your training log, and arrive without going through
            the APK again. Anything that changes the parts of Lift the phone has to install, a new
            permission or a new Android feature, still needs a new APK, and this row will not offer
            one.
          </Footnote>
        </Reveal>
      )}

      {/*
       * Reset, last and on its own, for the same reason it always was: every
       * other row on this screen is undone by tapping it again, and this one is
       * not. The subtitle quotes `DEFAULT_SETTINGS` rather than naming the
       * values again, so it cannot drift from what the button does.
       */}
      <Reveal index={2}>
        <SectionHeader title="Reset" />
        <Card padded={false} style={settingsStyles.section}>
          <SettingAction
            icon="refresh-outline"
            label="Reset all settings"
            description={`Back to ${DEFAULT_SETTINGS.weightUnit.toUpperCase()}, ${formatDuration(
              DEFAULT_SETTINGS.defaultRestSeconds,
            )} rest and the system theme`}
            onPress={confirmReset}
          />
        </Card>

        {/* The build number, which is what people quote in a bug report, and
            the same footer the profile screen ends on. The bundle id sits under
            it because with updates on, the version alone no longer identifies
            what is running. */}
        <View style={styles.footer}>
          <Text variant="caption" color="textTertiary" align="center">
            {APP_VERSION ? `Lift ${APP_VERSION}` : 'Lift'}
          </Text>
          <UpdateFooter />
        </View>
      </Reveal>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  footer: { marginTop: spacing.xxl, gap: 2 },
});
