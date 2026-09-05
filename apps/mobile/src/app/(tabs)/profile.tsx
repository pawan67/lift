import { formatVolume } from '@lift/shared';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import {
  Card,
  Divider,
  ListRow,
  Screen,
  SectionHeader,
  StatBand,
  Text,
  splitMeasure,
  useScrollEdge,
} from '@/components/ui';
import { getDashboardStats, type DashboardStats } from '@/features/analytics/repository';
import { SyncCard } from '@/features/sync/sync-card';
import { useDeferredFocusEffect } from '@/hooks/use-deferred-focus-effect';
import { useSettings } from '@/store/settings';
import { spacing } from '@/theme';

/** Read once: the manifest cannot change while the process is alive. */
const APP_VERSION = Constants.expoConfig?.version;

/**
 * Stands in for a figure whose query has not answered yet. A dash says the
 * number is not known; a zero says the number is nothing, which is a different
 * claim and one this screen is in no position to make on its first frame.
 */
const UNKNOWN = '—';

export default function ProfileScreen() {
  const scrollEdge = useScrollEdge();

  const weightUnit = useSettings((state) => state.weightUnit);

  const [stats, setStats] = useState<DashboardStats | null>(null);

  useDeferredFocusEffect(
    useCallback(() => {
      let cancelled = false;

      void (async () => {
        // One query. This screen used to follow `getDashboardStats` with its
        // own scan of every finished workout purely to sum the volume column
        // the first query had already read; that total now comes back as
        // `lifetimeVolumeKg`.
        //
        // A rejection leaves the figures unknown rather than the tab broken:
        // everything below the band is navigation and has to keep working.
        const next = await getDashboardStats().catch(() => null);

        if (cancelled) return;
        setStats(next);
      })();

      return () => {
        cancelled = true;
      };
    }, []),
  );

  // The figures wait; the screen does not. Holding the whole tab the way Home
  // does would put the settings menu behind an analytics scan, and behind a
  // failed one for good, since the loader above has no retry, so only what is
  // genuinely unknown is held back. The unit is held with it: "— kg" would
  // attach a unit to a number nobody has yet.
  const [volume, volumeUnit] = stats
    ? splitMeasure(formatVolume(stats.lifetimeVolumeKg, weightUnit))
    : ([UNKNOWN, undefined] as [string, string | undefined]);

  return (
    <Screen scrolled={scrollEdge.progress}>
      <ScrollView {...scrollEdge.list} contentContainerStyle={styles.content}>
        {/*
         * A masthead rather than a dashboard.
         *
         * Everything under it is navigation: settings, exports, measurements,
         * so the top of this screen is the only place it says anything, and
         * what it has to say is one number: everything this person has ever
         * lifted. Keeping it a step above the ruled band beneath states the
         * hierarchy that three identical tiles flattened.
         *
         * That step is 28px against the band's 17. It has been 40 (too loud:
         * it made a number you look up once look like the point of the app)
         * and 22 (too quiet: at one step off the band it read as a fourth
         * column rather than the thing the band breaks down). 28 is `title`,
         * the size the app already uses for a screen's own name, which is what
         * this figure is doing here. `adjustsFontSizeToFit` is what makes it
         * safe: a seven-figure volume in pounds on a phone set to a large
         * system text size shrinks rather than truncating or wrapping.
         *
         * The kicker used to carry the accent while the figure stayed plain,
         * and the reason was worth recording: in the light palette the accent
         * is a dark olive chosen to be legible as text, so accenting the number
         * made the loudest thing on the screen quieter than the label above it.
         * Both are ink now (see `toneColors` in `components/ui/surfaces.tsx`),
         * which retires the problem rather than solving it: 28px over 11px is
         * the hierarchy, and it does not depend on the palette at all.
         */}
        <View style={styles.masthead}>
          <Text variant="overline" color="textSecondary">
            Lifetime volume
          </Text>
          <Text variant="title" color="text" numberOfLines={1} adjustsFontSizeToFit>
            {volume}
            {volumeUnit ? (
              <Text variant="subheading" color="textTertiary">
                {` ${volumeUnit}`}
              </Text>
            ) : null}
          </Text>
        </View>

        <StatBand
          style={styles.band}
          items={[
            { label: 'Sessions', value: stats ? String(stats.totalWorkouts) : UNKNOWN },
            { label: 'Week streak', value: stats ? String(stats.weekStreak) : UNKNOWN },
            { label: 'Active days', value: stats ? String(stats.activeDays) : UNKNOWN },
          ]}
        />

        {/*
         * Everything that looks backwards, directly under the band and above
         * everything else on this screen.
         *
         * The masthead states one number (everything ever lifted) and these
         * are the three rows that take it apart: as a list, as a grid of days,
         * and as a set of charts. Anywhere further down and they read as
         * settings, which is what the rest of this screen is.
         *
         * History is first because it used to be a tab, and the person who
         * goes looking for it after the bar drops to three will look at the top
         * of this list. It is also the one of the three that answers "what did
         * I actually do", which is the question asked most often.
         */}
        {/*
         * Every row on this screen carries a hue, and the hue restarts at the
         * top of each section.
         *
         * A section header is a hard visual break, so two rows in different
         * cards sharing a colour are never read as a pair; running one sequence
         * down all eleven rows would instead have exhausted the ramp twice and
         * made the two halves of it look like a repeat with no meaning. Within
         * a card the colours differ, which is the only place it matters.
         *
         * Two rows keep a *role* colour instead, and both are cases where the
         * colour already means something everywhere else in the app: History is
         * the accent because it is where the figure on Home comes from, and
         * Personal records is `record` because a PR is gold on every screen
         * that has one. Overwriting either with a category would be the ramp
         * taking a colour that was already saying something.
         */}
        <SectionHeader title="Insights" />
        <Card padded={false} style={styles.section}>
          <ListRow
            icon="time-outline"
            tone="accent"
            title="History"
            subtitle="Every session, with trends and volume"
            onPress={() => router.push('/history')}
          />
          <Divider inset={spacing.lg} />
          <ListRow
            icon="calendar-outline"
            tone="category1"
            title="Calendar"
            subtitle="Which days you trained, month by month"
            onPress={() => router.push('/calendar')}
          />
          <Divider inset={spacing.lg} />
          <ListRow
            icon="stats-chart-outline"
            tone="category2"
            title="Statistics"
            subtitle="Muscle distribution, main lifts, monthly reports"
            onPress={() => router.push('/stats')}
          />
        </Card>

        <SectionHeader title="Account" />
        <View style={styles.section}>
          <SyncCard />
        </View>

        {/*
         * The exercise library, which used to be the fifth tab.
         *
         * A section of its own rather than a row buried under Tracking, where
         * it would read as a setting: it is the largest thing this screen leads
         * to, and the one an existing user comes looking for once the tab is
         * gone.
         */}
        <SectionHeader title="Library" />
        <Card padded={false} style={styles.section}>
          <ListRow
            icon="barbell-outline"
            tone="category1"
            title="Exercises"
            onPress={() => router.push('/exercises')}
          />
        </Card>

        <SectionHeader title="Tracking" />
        <Card padded={false} style={styles.section}>
          <ListRow
            icon="body-outline"
            tone="category1"
            title="Body measurements"
            onPress={() => router.push('/measurements')}
          />
          <Divider inset={spacing.lg} />
          <ListRow
            icon="trophy-outline"
            tone="record"
            title="Personal records"
            onPress={() => router.push('/records')}
          />
          <Divider inset={spacing.lg} />
          <ListRow
            icon="calculator-outline"
            tone="category3"
            title="Plate calculator"
            onPress={() => router.push('/plate-calculator')}
          />
        </Card>

        <SectionHeader title="App" />
        <Card padded={false} style={styles.section}>
          <ListRow
            icon="settings-outline"
            tone="category1"
            title="Settings"
            onPress={() => router.push('/settings')}
          />
          <Divider inset={spacing.lg} />
          <ListRow
            icon="cloud-upload-outline"
            tone="category2"
            title="Backup & export"
            onPress={() => router.push('/export')}
          />
          <Divider inset={spacing.lg} />
          {/*
           * Its own row for the same reason Import has one: nobody looking for
           * it is looking for the word "export". It is an export. The same
           * read, written for a different reader, but what someone wants is
           * an opinion on their training, and that is what the row has to say.
           */}
          <ListRow
            icon="chatbubble-ellipses-outline"
            tone="category3"
            title="Coach review"
            subtitle="Have an AI criticise your training"
            onPress={() => router.push('/coach')}
          />
          <Divider inset={spacing.lg} />
          {/*
           * Its own row rather than a button inside Backup & export. Someone
           * arriving from Hevy is looking for the word "import" on the first
           * screen they open, and burying it one level down behind a word about
           * getting data *out* is how a migration ends before it starts.
           */}
          <ListRow
            icon="download-outline"
            tone="category4"
            title="Import from another app"
            subtitle="Hevy, Lyfta, Strong or a Lift backup"
            onPress={() => router.push('/import')}
          />
        </Card>

        {/*
         * Name and version, nothing else.
         *
         * This line used to read "Lift · all data stored on this device",
         * which sat a few hundred pixels below a card offering to sync that
         * data to a server. Whichever half a reader believed, the screen was
         * lying to them. The build number is the one thing a footer is
         * genuinely for, and it is what people quote in a bug report.
         */}
        <Text variant="caption" color="textTertiary" align="center" style={styles.footer}>
          {APP_VERSION ? `Lift ${APP_VERSION}` : 'Lift'}
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.huge },
  masthead: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.xs,
  },
  band: { marginHorizontal: spacing.lg },
  section: { marginHorizontal: spacing.lg },
  footer: { marginTop: spacing.xxl },
});
