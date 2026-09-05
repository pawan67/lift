import { Ionicons } from '@expo/vector-icons';
import { DATE_SHORT, formatDateTime, formatDurationShort } from '@lift/shared';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { BarChart, type BarDatum } from '@/components/charts/bar-chart';
import { ColumnChart, type ColumnDatum } from '@/components/charts/column-chart';
import {
  Divider,
  Reveal,
  Screen,
  SegmentedControl,
  Text,
  splitMeasure,
  useScrollEdge,
} from '@/components/ui';
import { getWorkoutCalendar, type WorkoutCalendar } from '@/features/analytics/calendar';
import { METRIC, TREND_METRICS, type TrendMetric } from '@/features/analytics/metrics';
import { bodyPartColor } from '@/features/analytics/tones';
import { bucketLabel } from '@/features/analytics/windows';
import {
  getDashboardStats,
  getMuscleDistribution,
  getWeeklyTotals,
  type DashboardStats,
  type MuscleDistributionEntry,
  type WeeklyPoint,
} from '@/features/analytics/repository';
import { BodyweightSquareWidget } from '@/features/measurements/bodyweight-square-widget';
import { CalendarWidget } from '@/components/widgets/calendar-widget';
import { SquareWidget, WideWidget, widgetFigure } from '@/components/ui/widget';
import { listCompletedWorkouts } from '@/features/workouts/repository';
import type { Workout } from '@/db/schema';
import { useDeferredFocusEffect } from '@/hooks/use-deferred-focus-effect';
import { useReduceMotion } from '@/hooks/use-reduce-motion';
import { useSlowLoad } from '@/hooks/use-slow-load';
import { useSettings } from '@/store/settings';
import {
  controlHeight,
  duration,
  easing,
  mix,
  radius,
  spacing,
  useColors,
  useContentWidth,
} from '@/theme';

const BODY_PART_LABELS: Record<string, string> = {
  chest: 'Chest',
  back: 'Back',
  shoulders: 'Shoulders',
  arms: 'Arms',
  core: 'Core',
  legs: 'Legs',
  other: 'Other',
};

export default function HomeScreen() {
  const scrollEdge = useScrollEdge();
  const colors = useColors();

  // `ColumnChart` is laid out from a width rather than measuring itself, so the
  // strip's own margins come off the board this screen is drawn in. `board`,
  // not the window: on a desktop the pane beside the rail is capped at 1040 and
  // the chart has to be told the same number the `Screen` used.
  const chartWidth = useContentWidth('board') - spacing.lg * 2;

  const weightUnit = useSettings((state) => state.weightUnit);

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [weekly, setWeekly] = useState<WeeklyPoint[]>([]);
  const [distribution, setDistribution] = useState<MuscleDistributionEntry[]>([]);
  /*
   * The last finished session, and the whole log keyed by day.
   *
   * One workout rather than the three the recent-workouts list used to take:
   * the grid shows one tile, and asking for three rows to render the first was
   * two rows of every joined column fetched and dropped on every focus.
   *
   * `calendarStamp` is stamped alongside the calendar rather than read at
   * render. The strip is drawn relative to today, and a `new Date()` in the
   * render path would put "today" on a different square after midnight without
   * the data under it having moved.
   */
  const [lastWorkout, setLastWorkout] = useState<Workout | null>(null);
  const [calendar, setCalendar] = useState<WorkoutCalendar | null>(null);
  const [calendarStamp, setCalendarStamp] = useState(() => new Date());

  /*
   * Which of the three the masthead is answering in.
   *
   * State rather than a setting, so it resets to volume on every launch. It is
   * a question you ask of the screen rather than a preference: "how much did I
   * move" is the one this app is built around, and the other two are checks
   * against it rather than replacements for it.
   *
   * Nothing here refetches when it changes. `getWeeklyTotals` returns all three
   * per week in one pass, so a tap is a re-render.
   */
  const [metric, setMetric] = useState<TrendMetric>('volume');

  // See the note above `if (!stats)`.
  const slowLoad = useSlowLoad(stats === null);

  /*
   * Which week the masthead is reporting on, as that week's Monday.
   *
   * Null is this week, and it is not the same value as the current week's own
   * timestamp: holding the key would pin the masthead to a week that stops
   * being the current one at the next Monday. Null means "whichever week it is
   * now" and survives the rollover.
   *
   * Held as a key rather than as the point itself so it stays valid across a
   * refetch. `weekly` is replaced wholesale on every focus, and a key is looked
   * up again against the new array; a captured object would be a stale copy of
   * a week whose totals had since changed. A key that no longer appears, which
   * is what a week falling out of the twelve looks like, resolves to null and
   * the masthead returns to this week on its own.
   */
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);

  const selectedIndex = weekly.findIndex((point) => point.weekStart === selectedWeek);
  const shownIndex = selectedIndex >= 0 ? selectedIndex : weekly.length - 1;
  const shown = weekly[shownIndex] ?? null;
  const config = METRIC[metric];
  const targetValue = shown ? config.pick(shown) : 0;

  /*
   * The colour this screen is answering in, which changes with the tab.
   *
   * The masthead used to be the accent whichever metric was showing, so the three
   * tabs read as three views of one number rather than as three different
   * questions. They are not: volume, duration and reps are measured in
   * different units and move independently, and a week that is up on one is
   * routinely down on another. Colouring the answer is the cheapest way to say
   * so, and it is the idiom the app being quoted uses on its own summary, where
   * the step count is purple and the distance under it is blue.
   *
   * `data[0]` is the accent, so volume, which is what the screen opens on and
   * what it is mostly read for, looks exactly as it did.
   */
  const tone = colors.data[config.tone];

  // Aggregates are recomputed on focus rather than live: they only change when
  // a workout is finished, and re-running them on every set write would be
  // wasteful.
  useDeferredFocusEffect(
    useCallback(() => {
      let cancelled = false;

      void (async () => {
        const [nextStats, nextWeekly, nextDistribution, nextRecent, nextCalendar] =
          await Promise.all([
            getDashboardStats(),
            getWeeklyTotals(12),
            getMuscleDistribution(30),
            listCompletedWorkouts(1),
            getWorkoutCalendar(),
          ]);

        if (cancelled) return;
        setStats(nextStats);
        setWeekly(nextWeekly);
        setDistribution(nextDistribution);
        setLastWorkout(nextRecent[0] ?? null);
        setCalendar(nextCalendar);
        setCalendarStamp(new Date());
      })();

      return () => {
        cancelled = true;
      };
    }, []),
  );

  /*
   * Hold the frame until the first aggregate lands, and then show the
   * dashboard whatever it says.
   *
   * Blank for the first 120ms and a skeleton after that, rather than one or
   * the other for the whole wait. See `use-slow-load.ts` for why the two
   * halves are different states: on a phone that answers in 40ms a skeleton is
   * a second layout flashed and withdrawn before it can be read, and on one
   * that takes half a second a blank screen is a screen that looks broken.
   * `Reveal` still handles the arrival either way.
   *
   * This screen used to paint twice before it was right: `stats` starts null,
   * so the first frame was a 40px "0 kg" masthead over a zeroed streak, and
   * then, if the query came back with no workouts, the whole thing was replaced
   * by a full-page "Let's get started". Wrong figures, then a dead end where
   * the dashboard belongs.
   *
   * Holding on `!stats` removes the first; deleting the empty branch removes
   * the second. A zeroed dashboard is the honest first-run state. The charts
   * already say "Not enough data yet" in their own words, and the layout the
   * user is about to inhabit is legible from launch rather than hidden behind a
   * poster. Nothing below the rule hides on an empty log either, now that the
   * blocks are tiles: a tile with no data still prints its own name and says
   * what would fill it, which is a layout rather than the hole an empty
   * headed section leaves behind.
   */
  if (!stats) {
    return (
      <Screen width="board" scrolled={scrollEdge.progress}>
        {slowLoad ? <DashboardSkeleton chartWidth={chartWidth} /> : null}
      </Screen>
    );
  }

  const isThisWeek = shownIndex === weekly.length - 1;
  const before = shownIndex > 0 ? weekly[shownIndex - 1]! : null;
  /*
   * This week reads against the same number of days into last week, not last
   * week's full total. Without this a Monday-morning visit always shows a
   * double-digit decline: the current week has had one day to accumulate
   * anything and the baseline has had seven, no matter how the week goes on to
   * turn out. That is a fact about the calendar rather than about the
   * training, and reading it as a decline is exactly backwards on the one day
   * a streak most needs the app to be encouraging rather than not. A completed
   * past week has no such asymmetry: both sides of that comparison are full
   * weeks, so it keeps reading its own full total.
   */
  const beforeValue = before ? config.pick(isThisWeek ? toDateTotals(before) : before) : 0;


  /*
   * The twelve columns, and only one of them is coloured.
   *
   * Every bar on this screen used to be the accent: twelve here, six in the
   * chart below, plus the kicker and the History link. `tokens.ts` budgets
   * roughly one accent element per view; at twenty it stops reading as emphasis
   * and becomes the screen's background texture, which is the actual reason
   * this screen felt busy rather than the amount of content on it. The budget
   * survived the accent changing colour, and the ramp does not spend it twice:
   * the one column that is coloured takes the *metric's* hue, so the run and
   * the figure above it are still one statement in one colour.
   *
   * Spending it on one week turns the run from decoration into a sentence: here
   * is where the week you are reading sits among the last twelve. It follows
   * the selection rather than staying on the current week, so the accent always
   * marks the bar the figure above belongs to, and a tap moves it. The rest
   * fade from `borderStrong` to `textSecondary` with recency, so the run reads
   * as time passing without needing an axis to say so. Both ends of that mix
   * are defined in every palette and move together: on the light ones the fade
   * runs light-to-dark, which is the same "older is fainter" in reverse.
   */
  const trendData: ColumnDatum[] = weekly.map((point, index) => {
    // Stops at 0.7 rather than 1 so the most recent *past* week still sits
    // clearly below the accent instead of arriving alongside it.
    const recency = weekly.length > 1 ? (index / (weekly.length - 1)) * 0.7 : 0;

    return {
      key: point.weekStart,
      // Every column carries its own date and `ColumnChart` thins them to five
      // or so: twelve of these across a phone would collide, and which weeks
      // get printed is a layout decision the chart is better placed to make.
      // `bucketLabel` rather than a local format, so a week is written the same
      // way here as in the chart on History.
      label: bucketLabel(new Date(point.weekStart), 'week'),
      value: config.pick(point),
      color:
        index === shownIndex
          ? tone
          : mix(colors.borderStrong, colors.textSecondary, recency),
    };
  });

  /*
   * How that week compares with the one before it.
   *
   * A figure on its own is inert. 52.6k is neither good nor bad without
   * something to read it against, and the screen was asking the user to supply
   * that from memory. Both numbers are the selected metric out of two adjacent
   * buckets, so the comparison holds whichever tab is showing and whichever
   * week is being read: a percentage is one of the few things that means the
   * same in kilograms, minutes and reps.
   *
   * Null when there is nothing honest to say: no week before this one in the
   * window, or a previous week of zero, where the change is not "infinitely
   * better" but "this is the first week".
   */
  const deltaPercent =
    beforeValue > 0 ? Math.round(((targetValue - beforeValue) / beforeValue) * 100) : null;

  /*
   * The two supporting figures, as a sentence rather than a band.
   *
   * These were a `StatBand`: two uppercase labels over two 17px figures, in
   * columns, occupying its own block under the masthead. That is the right
   * component for a table of figures being compared, and these two are not
   * that: they are context for the headline above them. Set as one quiet line
   * they belong to the figure, which turns two blocks into one and takes a
   * whole horizontal rule of structure off the screen.
   *
   * Neither of them changes with the metric, which is the point of leaving them
   * out of the tabs: the sessions behind the headline are the same sessions
   * whichever way it is being counted.
   *
   * The streak is dropped on a past week, and that is not tidiness. A streak is
   * a fact about now, counted back from this week; printed under August it
   * would read as the streak as it stood in August, which is a different number
   * this screen does not have. The session count is a property of the week
   * itself and follows the selection.
   */
  const sessions = shown?.workouts ?? 0;
  const meta = [
    `${sessions} ${sessions === 1 ? 'session' : 'sessions'}`,
    isThisWeek && stats.weekStreak > 0 ? `${stats.weekStreak}-week streak` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  /*
   * What the kicker calls the week, and what the delta compares it to.
   *
   * "this week" only when it is: on any other week the kicker names the Monday
   * it starts on, because a 40px figure with no date on it is read as the
   * current one. "vs last week" moves with it for the same reason. Read under a
   * selected August week it would mean the week before today rather than the
   * week before that one, which is the sort of caption that is worse than none.
   */
  const kicker =
    isThisWeek || !shown
      ? `${config.label} this week`
      : `${config.label} · week of ${bucketLabel(new Date(shown.weekStart), 'week')}`;
  const deltaCaption = isThisWeek ? 'vs last week' : 'vs week before';

  /*
   * One ink at three weights, and the heaviest goes to the muscle on top.
   *
   * These bars have now been three things. They were six bars of flat accent,
   * then a shade per rank from `borderStrong` up to `textSecondary`, then a
   * fixed hue per body part. The first two solved the wrong problem with
   * brightness: the bar's own *length* already says which is biggest, so the
   * shade said it a second time. The hues solved the right one, which is that
   * nothing said which muscle a bar belonged to, and paid for it in the only
   * currency this screen is short of. Six of them here, six more on the
   * workout summary, six on each of four stats screens.
   *
   * The label beside each bar was answering that question the whole time. So
   * the colour is spent on the one thing the labels cannot say at a glance,
   * which is where the sort peaks: `distribution` arrives sorted by sets, so
   * the leading bar takes `text` and the rest sit a step back in
   * `textSecondary`. See `tones.ts`, and `toneColors` in `ui/surfaces.tsx` for
   * the rule this follows.
   *
   * This was never the loudest block on the screen under the hues, because six
   * at equal weight have no peak and the eye reads them as one textured band.
   * It is quieter still now, and it has a top.
   */
  const distributionData: BarDatum[] = distribution.map((entry, index) => ({
    label: BODY_PART_LABELS[entry.bodyPart] ?? entry.bodyPart,
    value: entry.sets,
    color: bodyPartColor(entry.bodyPart, colors, index === 0),
  }));

  return (
    <Screen width="board" scrolled={scrollEdge.progress}>
      <ScrollView {...scrollEdge.list} contentContainerStyle={styles.content}>
        {/*
         * Four blocks, revealed in the order they are read.
         *
         * Everything below this point is gated on `stats`, so none of it exists
         * until the aggregates land, and they now land deliberately late, held
         * behind the tab transition by `useDeferredFocusEffect`. Without the
         * `Reveal`s that arrival is a pop: an empty canvas one frame, a full
         * dashboard the next. With them it is the screen resolving, which is
         * the same delay described honestly.
         *
         * The stagger is per *block*, not per element. The masthead and the run
         * of twelve are one thought (this week, in a word and then in figures)
         * so they arrive together; the pair of tiles is the next, and each of
         * the two rows below it is its own.
         *
         * Bodyweight is the exception to the gate: it renders inside a `Reveal`
         * like the rest, but its own query is not `stats`, so it holds its own
         * frame (see the note at the top of `BodyweightSquareWidget`) rather
         * than borrowing this one. The two arrive independently, which is
         * honest about the fact that they are two different reads of two
         * different tables.
         */}
        <Reveal index={0}>
          {/*
           * The headline, and the twelve weeks it sits in, as one block.
           *
           * This screen used to open with a row of three tiles: streak,
           * workouts, active days, and then, immediately below, a card headed
           * "This week" carrying workouts and volume. Two stat blocks stacked,
           * with "workouts" appearing in both at two different scopes and no
           * indication of which was which. Home now answers exactly one
           * question (how is this week going) and the lifetime totals live on
           * Profile, where "lifetime" is the whole point.
           *
           * The volume chart used to be a titled section of its own, below a
           * `StatBand` that was a third block. All three said the same thing at
           * different resolutions, so they are now one: the figure, what it
           * changed by, what it took, and where it falls in the run. Five blocks
           * became three, and the screen stopped being a list of sections that
           * happen to share a subject.
           *
           * The figure is plain text and the kicker above it carries the
           * colour, which is the opposite of the obvious pairing. The light
           * palette's answer to every role is a deepened text colour, so
           * colouring the number made the loudest thing on the screen quieter
           * than the label under it. Colouring the small word instead holds in
           * both schemes with no branching on the colour scheme. Do not swap
           * these back.
           *
           * The colour is the metric's rather than the accent's, so the word
           * "Volume" and the coloured bar in the run below it agree, and a tap
           * on Duration recolours both. See `tone` above.
           *
           * `display` at 40px, which is the largest type in the app and the only
           * place it is used. The figure spent a release at `heading` (24) on
           * the grounds that a number filling the width of a phone reads as a
           * scoreboard, and at 24 it read as a caption instead: it is the answer
           * to the only question this screen asks, and every other line in the
           * block is a footnote to it. `adjustsFontSizeToFit` is what makes 40
           * safe rather than optimistic: the figure is one line by contract, and
           * between a seven-figure volume in pounds and a phone set to a large
           * system text size it will not always fit at full size. It shrinks
           * rather than truncating or wrapping, so the worst case is a smaller
           * number and never half of one.
           */}
          <View style={styles.masthead}>
            <Text variant="overline" style={{ color: tone }} numberOfLines={1}>
              {kicker}
            </Text>
            {/* `series` is the question, not the answer. See `CountUp`: a tap
                on a metric or a week is a question being re-asked and the
                figure snaps, a refetch landing a new total is the screen
                resolving and it climbs. */}
            <CountUp
              value={targetValue}
              series={`${metric}:${selectedWeek ?? 'now'}`}
              format={(v) => config.format(v, weightUnit)}
            />

            {deltaPercent !== null ? (
              <View style={styles.delta}>
                {/*
                 * A caret rather than a word, and a role colour rather than a
                 * second sentence. Zero is drawn as a rise so the glyph never
                 * contradicts a "0%" beside it. A flat week is not a decline.
                 */}
                <Ionicons
                  name={deltaPercent >= 0 ? 'caret-up' : 'caret-down'}
                  size={13}
                  color={deltaPercent >= 0 ? colors.success : colors.danger}
                />
                {/* A size up from the words beside it, and the only figure in
                    the block other than the headline. At 11 under a 40px number
                    it read as a footnote to a footnote. */}
                <Text variant="label" color={deltaPercent >= 0 ? 'success' : 'danger'}>
                  {`${Math.abs(deltaPercent)}%`}
                </Text>
                <Text variant="caption" color="textTertiary">
                  {deltaCaption}
                </Text>
              </View>
            ) : null}

            <Text variant="label" color="textSecondary" style={styles.meta} numberOfLines={1}>
              {meta}
            </Text>
          </View>

          {/*
           * The run of twelve, on both axes, tappable, and with no heading.
           *
           * `ColumnChart` rather than the `BarChart` this was: History's chart
           * already had the value axis, the rounded ceiling, the thinned date
           * labels and a full-height touch target per bucket, and the alternative
           * was teaching a second component the same four things. What Home adds
           * to it is a colour per column, because the accent has to be able to
           * mark the week being read: see `trendData`.
           *
           * The heading stays off: this strip is not a section that has to
           * introduce itself, it is the tail of the sentence the figure above
           * starts, and a title would re-open it as one.
           *
           * Both axes are drawn, where before there were bars and a baseline.
           * The value axis costs a 44pt gutter, so the plot starts inboard of
           * the margin every other element on this screen sits on, and it buys
           * the thing a bare run cannot do: read a week that is not this one.
           * Without it the only labelled quantity was the headline, so the
           * eleven columns before the last were a shape and nothing more.
           *
           * A tap on any column is the rest of that: it moves the accent, the
           * kicker, the figure, the delta and the session count onto that week.
           * Tapping it again clears the selection and the block returns to this
           * week, which is also what the twelfth column does, since selecting
           * the current week and selecting nothing show the same figures.
           *
           * 150 tall against the 100 it was. The two rules divide the plot in
           * thirds, and 25pt bands with an 11pt figure beside them read as a
           * label sitting on a line rather than against it. The extra height is
           * also what makes a rest week tappable: the target is the full column
           * slot, not the bar.
           */}
          <View style={styles.strip}>
            <ColumnChart
              data={trendData}
              width={chartWidth}
              height={150}
              selectedKey={selectedWeek}
              onSelect={(datum) => setSelectedWeek(datum?.key ?? null)}
              formatValue={(value) => config.axis(value, weightUnit)}
              describeValue={(value) => config.format(value, weightUnit)}
              emptyLabel="No data yet"
            />
          </View>

          {/*
           * The three metrics, at the foot of the run they redraw.
           *
           * Under the chart rather than over it, and not at the top of the
           * masthead either, which is where a control governing a whole block
           * usually goes. Two reasons it ends up last. The room above the kicker
           * is what the 40px figure is set into, and a track of tabs anywhere in
           * that stack takes it back; and the block reads as one sentence
           * downwards, figure then change then shape, which a control cutting
           * across it interrupts. Sitting under the bars it reads as the axis
           * the run is drawn against, which is what it is.
           *
           * The cost, and it is a real one: the tabs are below the figure they
           * retitle, so the first tap is the one that teaches you they move it.
           * The kicker naming the metric in full ("Duration this week") is what
           * makes that tap legible after the fact.
           *
           * `sm` because it is inside a block rather than heading a screen: the
           * one on History that picks a time range for the page is `md`.
           */}
          <SegmentedControl
            options={TREND_METRICS}
            value={metric}
            onChange={setMetric}
            size="sm"
            label="Metric"
            style={styles.tabs}
          />

          {/*
           * The one rule on the screen, and it is doing structural work: above
           * it is this week, below it is everything else. It replaces the two
           * section headings that used to separate these blocks, which is a
           * hairline in place of two lines of type.
           */}
          <Divider style={styles.rule} />
        </Reveal>

        {/*
         * The grid below the rule: what the week was made of.
         *
         * Above the rule the screen answers one question in one figure. Below
         * it, four tiles answer the four that follow it, in the order they are
         * asked: what was the last session, what do I weigh, how often have I
         * been training, and where has the work gone.
         *
         * Tiles rather than the titled sections this was. A section announces
         * itself with a heading and then spends a block saying one thing; a
         * tile says the thing and names itself underneath in the same line of
         * type the heading used, which is one line of chrome per block instead
         * of two plus a rule. What that buys is what the pair below uses it
         * for: two blocks side by side on a phone, where two headed sections
         * could only stack.
         *
         * What it costs is density, and the recent-workouts list is where it
         * was paid: three tappable rows carrying date, duration and volume
         * became one tile carrying the last session. History is one tap from
         * the tile and one from the tab bar, and the second and third rows of
         * that list were never the reason anyone opened this screen.
         */}
        <Reveal index={1}>
          <View style={styles.pair}>
            {/*
             * The last session, counted in sets.
             *
             * Sets rather than volume, and not because volume would not fit: it
             * is already the figure the masthead is set in, and a tile printing
             * a second volume forty points below the first is two numbers of
             * the same kind at two scopes with nothing on either saying which
             * is which. That exact collision is what this tile replaced. Sets
             * are the unit the app is built around, they appear nowhere else on
             * this screen, and per session they are a figure someone can
             * actually hold: forty is a long day, twelve is a short one.
             */}
            <SquareWidget
              style={styles.tile}
              icon="barbell-outline"
              // The orange. Each tile in the grid carries a hue of its own on
              // its icon, in the ramp's order down the screen, which is what
              // makes the grid read as four things rather than as four copies
              // of one card. The masthead above it holds `data[0]`, which is
              // the accent, so the tiles start at index 1.
              tone={colors.data[1]}
              title={lastWorkout?.name ?? 'No workouts yet'}
              subtitle={
                lastWorkout
                  ? `${formatDateTime(lastWorkout.startedAt, DATE_SHORT)} · ${formatDurationShort(
                      lastWorkout.durationSeconds ?? 0,
                    )}`
                  : 'Start one from Workout'
              }
              onPress={
                lastWorkout
                  ? () =>
                      router.push({ pathname: '/workout/[id]', params: { id: lastWorkout.id } })
                  : undefined
              }
              action={
                lastWorkout
                  ? { icon: 'time-outline', label: 'Open history', onPress: () => router.push('/history') }
                  : undefined
              }
            >
              {/* `widgetFigure` over the variant, so this and the bodyweight
                  tile beside it print at one size. The unit stays at body size
                  and in the secondary tier: it repeats what the tile's own
                  title already says, and matching it to the number would make
                  a two-word figure out of a one-word one. */}
              <Text
                variant="numericLarge"
                color="text"
                style={widgetFigure}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {lastWorkout?.totalSets ?? 0}
                <Text variant="body" color="textSecondary">
                  {` ${lastWorkout?.totalSets === 1 ? 'set' : 'sets'}`}
                </Text>
              </Text>
            </SquareWidget>

            <BodyweightSquareWidget style={styles.tile} tone={colors.data[2]} />
          </View>
        </Reveal>

        <Reveal index={2}>
          <View style={styles.tileRow}>
            <CalendarWidget
              calendar={calendar}
              today={calendarStamp}
              width={chartWidth}
              tone={colors.data[3]}
              onPress={() => router.push('/calendar')}
            />
          </View>
        </Reveal>

        {/*
         * Sets by body part, back inside the grid.
         *
         * This block was a titled section with an "All" button beside the
         * heading, and for one release it was nothing at all: the query behind
         * it kept running on every focus while no element on the screen drew
         * it. It is the same `BarChart` and the same 30-day scope, in the tile
         * the rest of the grid is built from, and the tile itself is the link
         * the heading's button used to be.
         *
         * A hue per body part rather than a shade per rank: see
         * `distributionData`. This tile takes no `tone` of its own for that
         * reason, and it is the one exception to the grid's pattern. Its
         * content is already six colours; a seventh on the icon beside them
         * would be the only mark on the tile that did not stand for a muscle.
         */}
        <Reveal index={3}>
          <View style={styles.tileRow}>
            <WideWidget
              icon="bar-chart-outline"
              title="Sets by body part"
              subtitle="Last 30 days"
              onPress={() => router.push('/stats/body-distribution')}
            >
              <BarChart data={distributionData} formatValue={(value) => `${Math.round(value)}`} />
            </WideWidget>
          </View>
        </Reveal>
      </ScrollView>
    </Screen>
  );
}

/**
 * The masthead figure, counting up to itself, and the only thing on this screen
 * that re-renders per frame.
 *
 * It is its own component for the reason `Elapsed` on the logging screen and
 * `SessionStats` on the save screen are: a per-frame `setState` at the screen
 * root re-renders the screen. This one used to sit in `HomeScreen`, so all
 * ~48 frames of it redrew the masthead, the twelve-column chart, the four tiles
 * and every square of the training-days strip. Confined here, a frame costs one
 * `Text`.
 *
 * ## Why it still runs on JS rather than on the UI thread
 *
 * Reanimated would take the interpolation off the JS thread entirely, and it
 * cannot be used: the value has to pass through `config.format`, which is
 * `toLocaleString` and a unit lookup, and a worklet cannot call it. Driving one
 * `Text` from JS is the honest version of this animation. Driving the screen
 * from JS was not.
 *
 * ## The two things that make a frame cheap
 *
 * `tabular-nums`, which `display` does not carry, because it is a headline face
 * rather than a figure face. Without it every digit change re-flows the line, and
 * under `adjustsFontSizeToFit` a re-flow is a re-measure: the one place on this
 * screen where a per-frame render turns into a per-frame layout pass. With it
 * the box is a fixed width for the whole climb and nothing below it moves.
 *
 * And the unit is a sibling rather than a nested `Text`. Nesting it inside the
 * animated one put it through the same re-measure sixty times a second to print
 * a word that never changes.
 *
 * ## Why `series` exists
 *
 * The climb is worth 800ms exactly once: when the screen resolves and the
 * figure arrives. It is worth nothing at all on the taps that follow, and this
 * block has two of them. The metric tabs and the twelve columns both change
 * `value`, so both used to restart the count from zero, which put four fifths
 * of a second between "how long did I train" and an answer legible enough to
 * read. That is a question being answered late, and a question asked by thumb
 * is asked repeatedly: the tabs are three, the columns twelve, and a reader
 * comparing two weeks pays the delay on every comparison.
 *
 * `series` names which question is being asked. When it changes the figure
 * snaps, because the user is waiting on it; when only `value` changes, which is
 * a refetch landing a new total under an unchanged question, it climbs. Same
 * animation, kept to the one moment it is feedback rather than a wait.
 */
function CountUp({
  value,
  series,
  format,
}: {
  value: number;
  /** Identifies the question the figure answers. A change snaps; see above. */
  series: string;
  format: (value: number) => string;
}) {
  const reduceMotion = useReduceMotion();

  /*
   * Seeded at zero, which is where the climb starts.
   *
   * Seeding it at `value` reads as the safer default and paints the bug: the
   * first frame is rendered before the effect runs, so the figure would land on
   * its final total, blink to zero, and count back up to where it already was.
   * A reduce-motion reader never sees this state at all, because `display`
   * below takes `value` directly rather than this.
   */
  const [shown, setShown] = useState(0);

  const frame = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);

  /*
   * The question the last climb was run for.
   *
   * Seeded with the current one rather than left empty, so the first run reads
   * as "unchanged" and the figure arrives counting. Every run after that
   * compares against what it was actually asked last time.
   */
  const asked = useRef(series);

  useEffect(() => {
    // Reduce motion never starts a climb; the figure is read straight off
    // `value` during render instead. See `display` below.
    if (reduceMotion) return;

    /*
     * A new question is answered on the frame it is asked.
     *
     * `setShown` rather than a climb from zero: the user has just tapped a tab
     * or a column and is waiting on the figure, and there is nothing to
     * animate between anyway, since the two totals are of different weeks or
     * different quantities. See the note on `series` above.
     */
    if (asked.current !== series) {
      asked.current = series;
      setShown(value);
      return;
    }

    /*
     * From zero, not from the figure before it.
     *
     * What reaches this line is one week's total for one metric being replaced
     * by a newer reading of the same thing, so a transition between the two
     * looks defensible and is still wrong: the motion would be a difference
     * being applied rather than a total being counted, and the difference is
     * the one thing the delta line under the figure already states in full.
     * Zero is where you count a total from.
     */
    const from = 0;
    const startedAt = Date.now();

    const tick = () => {
      const elapsed = Date.now() - startedAt;
      const t = Math.min(elapsed / duration.count, 1);
      setShown(t >= 1 ? value : from + (value - from) * easing.count(t));

      frame.current = t < 1 ? requestAnimationFrame(tick) : null;
    };

    frame.current = requestAnimationFrame(tick);

    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [value, series, reduceMotion]);

  /*
   * Reduce motion drops the climb and keeps the figure, which is the rule
   * `motion.ts` states for every animation built from `timing`. This one is
   * hand-driven, so it honours it by hand, and it does so by *deriving* rather
   * than by writing `value` into state from the effect: a `setShown` in an
   * effect body is the cascading render the hooks rule is about, and
   * `use-ticker.ts` documents spending a whole frame to dodge the same edge.
   * There is nothing to synchronise here. The answer is already in `value`.
   */
  const display = reduceMotion ? value : shown;
  const [figure, unit] = splitMeasure(format(display));

  return (
    <View style={styles.figure}>
      <Text
        variant="display"
        color="text"
        numberOfLines={1}
        adjustsFontSizeToFit
        style={styles.figureDigits}
      >
        {figure}
      </Text>
      {unit ? (
        <Text variant="subheading" color="textTertiary">
          {` ${unit}`}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The dashboard's shape, drawn before the dashboard is.
 *
 * Only reached once the load has run past `SLOW_LOAD_MS`, so this is not the
 * screen's usual first frame: it is what a slow phone gets instead of a void.
 *
 * ## It is laid out by the real screen's styles
 *
 * `masthead`, `strip`, `tabs`, `rule`, `pair`, `tile` and `tileRow` are the
 * same objects the dashboard is built from, not copies with matching numbers.
 * That is the whole point of a skeleton over a spinner: the blocks arrive into
 * positions that are already correct, so the content lands rather than pushing
 * the page around as it comes. Copied numbers drift the first time one of the
 * originals is adjusted, and the drift is invisible until someone happens to
 * be loading on a slow device.
 *
 * Only the bones themselves are new, and they are only heights: everything
 * horizontal comes from the layout they sit in.
 *
 * ## Why it does not pulse
 *
 * A shimmer is the convention and it is the wrong convention here. This app
 * spends motion on things that happened (a set logged, a record beaten) and
 * stays still otherwise, and a placeholder animating on its own would be the
 * loudest thing on a screen with nothing on it yet. The `Reveal` on the real
 * content is already the movement that says the wait ended.
 *
 * The two wide bones are approximations of the widgets they stand in for
 * rather than exact heights: both are below the fold on a phone, so the cost
 * of being twenty points out is a scrollbar that settles, not a jump anyone
 * watches.
 */
function DashboardSkeleton({ chartWidth }: { chartWidth: number }) {
  const colors = useColors();
  const bone = { backgroundColor: colors.surfaceMuted };

  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.masthead}>
        <View style={[styles.bone, styles.boneKicker, bone]} />
        <View style={[styles.bone, styles.boneFigure, bone]} />
        <View style={[styles.bone, styles.boneMeta, bone]} />
      </View>

      {/* The plot's own box, not twelve columns. A run of bars at invented
          heights is a placeholder pretending to be a reading, and the one
          thing a screen with no data yet must not do is show a shape someone
          could mistake for their week. */}
      <View style={styles.strip}>
        <View style={[styles.bone, styles.boneChart, { width: chartWidth }, bone]} />
      </View>

      <View style={[styles.bone, styles.boneTabs, styles.tabs, bone]} />

      <Divider style={styles.rule} />

      <View style={styles.pair}>
        <View style={[styles.bone, styles.boneSquare, styles.tile, bone]} />
        <View style={[styles.bone, styles.boneSquare, styles.tile, bone]} />
      </View>

      <View style={styles.tileRow}>
        <View style={[styles.bone, styles.boneWide, bone]} />
      </View>

      <View style={styles.tileRow}>
        <View style={[styles.bone, styles.boneWide, bone]} />
      </View>
    </View>
  );
}

/** A week's totals truncated to its `*ToDate` fields, for `config.pick`. */
function toDateTotals(point: WeeklyPoint) {
  return {
    volumeKg: point.volumeKgToDate,
    durationSeconds: point.durationSecondsToDate,
    reps: point.repsToDate,
  };
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.huge },
  masthead: {
    paddingHorizontal: spacing.lg,
    // Deeper above than the `lg` it was, and shallower below, because the strip
    // under it now belongs to this block rather than following it. The space
    // this buys above the kicker is what the figure is set into, and it is the
    // reason the tabs sit under the block rather than over it.
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  /* The figure and its unit on one line, the unit sitting on the figure's
     baseline. `flex-shrink` on the digits alone: a seven-figure volume in
     pounds shrinks itself under `adjustsFontSizeToFit` rather than pushing the
     unit off the screen. */
  figure: { flexDirection: 'row', alignItems: 'baseline' },
  // Tabular figures, which `display` does not set. See `CountUp`.
  figureDigits: { flexShrink: 1, fontVariant: ['tabular-nums'] },
  // Centred rather than baseline-aligned: the caret is a glyph in a 11pt box,
  // not type, so its baseline is not where its arrow is.
  delta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  meta: { marginTop: spacing.sm },
  // On the screen's margin like everything else, and nearer the bars above it
  // than the rule below: `md` up against the `xl` the rule brings with it, so
  // the control reads as belonging to the chart rather than as a third thing
  // between the chart and whatever follows the rule.
  // Further from the chart than a control usually sits from what it drives.
  //
  // The gap is measured from the chart's box, and the box ends only a few px
  // below the "0" tick, so at `md` the track was landing on the y-axis origin
  // and reading as part of the plot rather than as something under it. The
  // clearance that is actually wanted is from the glyph, not from the box, and
  // there is no way to say that in a margin: hence a step that looks larger
  // than it is on paper and comes out as ordinary on screen.
  tabs: { marginHorizontal: spacing.lg, marginTop: spacing.xl },
  strip: { marginHorizontal: spacing.lg },
  rule: { marginHorizontal: spacing.lg, marginTop: spacing.xl },
  /* One row of the grid: on the screen's margin, one `lg` clear of the row
     above it. Every block below the rule uses it, so the vertical rhythm of the
     grid is one number rather than a margin repeated at each call site. */
  tileRow: { marginHorizontal: spacing.lg, marginTop: spacing.lg },
  /*
   * The two-up row.
   *
   * `alignItems: 'flex-start'` is what lets a square be square. A row stretches
   * its children to the tallest by default, and a stretched cross size wins
   * over `aspectRatio`: the tiles came out as whatever height the row happened
   * to be rather than as their own width. Held at the start, the cross size is
   * auto, the ratio drives the height, and two tiles of equal width are
   * therefore of equal height with nothing having to say so.
   */
  pair: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.lg,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },
  /*
   * `flex: 1` rather than a percentage basis.
   *
   * Two `48%` bases plus an `lg` gap comes to more than the row on any phone
   * narrower than about 400pt, and a flex child does not shrink below its basis
   * by default: the pair wrapped into a column on exactly the devices it was
   * drawn for. `flex: 1` asks for an equal share of what is left after the gap,
   * which is the thing the percentages were approximating.
   *
   * `minWidth: 0` alongside it: a flex child will not shrink below its content,
   * and a workout name is content. Without it a long one widens its tile and
   * the two stop being halves.
   */
  tile: { flex: 1, minWidth: 0 },

  /*
   * The placeholder blocks. See `DashboardSkeleton`.
   *
   * `bone` carries only the corner, and each of the others only a height (or a
   * ratio). Nothing here sets a margin or a horizontal position: every one of
   * these is dropped into one of the layout objects above, which is what keeps
   * the skeleton and the dashboard in the same places.
   *
   * The heights are the type they stand in for rather than round numbers:
   * `overline` and `label` are 11 and 13, the masthead figure is the 40px
   * `display`, and the tabs are `controlHeight.sm`. A bone measured off the
   * text it replaces is a bone that does not move the page when the text
   * arrives.
   */
  bone: { borderRadius: radius.sm },
  boneKicker: { width: 132, height: 11 },
  boneFigure: { width: 190, height: 40 },
  boneMeta: { width: 148, height: 13, marginTop: spacing.sm },
  boneChart: { height: 150, borderRadius: radius.md },
  boneTabs: { height: controlHeight.sm },
  boneSquare: { aspectRatio: 1, borderRadius: radius.lg },
  // Roughly a `WideWidget` with a header and a body: see the note on
  // `DashboardSkeleton` about why these two are approximate.
  boneWide: { height: 190, borderRadius: radius.lg },
});
