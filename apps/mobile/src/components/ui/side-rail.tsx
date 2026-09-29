/**
 * The desktop navigation rail.
 *
 * ## Why this exists rather than a side-mounted tab bar
 *
 * React Navigation can put its own tab bar down the left edge: `tabBarPosition:
 * 'left'`, and that was the first version of this. It is wrong here for a
 * structural reason rather than a stylistic one: the tab navigator is a *screen
 * inside* the root stack, so anything pushed on top of it (History, Exercises,
 * Settings, a workout detail: most of this app) covers the rail completely.
 * That is correct on a phone, where a pushed screen is meant to take the window,
 * and it is exactly wrong on a desktop, where navigation that disappears the
 * moment you navigate is not navigation.
 *
 * Rendered beside the stack at the root instead, it persists across every route.
 *
 * ## Why it lists more than the three tabs
 *
 * It does not invent an information architecture. Home, Workout and Profile are
 * the same three the bar has and they sit at the top in the same order. What
 * follows is the *second* level (the destinations Profile leads to) promoted
 * into view rather than moved.
 *
 * Progressive disclosure is a small-screen tactic: the tab bar is three items
 * because a fourth would narrow the middle target that starts a workout (see
 * `(tabs)/_layout`), and that argument is about thumbs on a 390pt bar. It says
 * nothing about a rail with 700pt of vertical space and a cursor. Both layouts
 * reach the same places by the same names; one of them can afford to show the
 * map.
 *
 * The grouping is Profile's own, in Profile's own order: Insights, Library,
 * Tracking, so someone who learned the app on a phone finds the same words in
 * the same sequence.
 */

import { Ionicons } from '@expo/vector-icons';
import { router, usePathname, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScrollView, StyleSheet, View } from 'react-native';

import { useOpenSession } from '@/features/workouts/use-open-session';
import {
  font,
  fontSize,
  hoverFill,
  MIN_TOUCH_SIZE,
  radius,
  RAIL_WIDTH,
  spacing,
  stroke,
  useColors,
} from '@/theme';

import { PressableScale } from './motion';
import { Text } from './text';

interface RailItem {
  href: Href;
  label: string;
  /**
   * Every path this row owns, as prefixes.
   *
   * A list rather than one string because a section's index and its detail
   * routes are not always prefixes of each other. The library lives at
   * `/exercises` and its detail at `/exercise/[id]`, so neither path is a
   * prefix of the other and matching on either alone leaves the row dark on
   * half its own screens. Body measurements are the same shape.
   */
  match: string[];
  icon: keyof typeof Ionicons.glyphMap;
}

interface RailGroup {
  /** Sentence case: `overline` uppercases it. Omitted for the primary group. */
  title?: string;
  items: RailItem[];
}

/**
 * The primary group carries no heading. It is the tab bar, and the tab bar has
 * no heading either.
 *
 * `match` is a prefix rather than an exact path because the rail has to stay lit
 * while you are inside a section: reading `/workout/summary/abc123` is still
 * being in Workout, and a rail that goes dark as soon as you open a detail view
 * makes the app feel like it lost track of where you are. Home is the exception
 * and matches exactly. `/` is a prefix of every route there is.
 */
const GROUPS: RailGroup[] = [
  {
    items: [
      { href: '/', label: 'Home', match: ['/'], icon: 'home-outline' },
      {
        href: '/workout',
        label: 'Workout',
        // Routines are edited from the Workout tab and have no row of their own,
        // so the row that leads there stays lit while you are in one.
        match: ['/workout', '/routine'],
        icon: 'add-circle-outline',
      },
    ],
  },
  {
    title: 'Insights',
    items: [
      { href: '/history', label: 'History', match: ['/history'], icon: 'time-outline' },
      { href: '/calendar', label: 'Calendar', match: ['/calendar'], icon: 'calendar-outline' },
      { href: '/stats', label: 'Statistics', match: ['/stats'], icon: 'stats-chart-outline' },
    ],
  },
  {
    title: 'Library',
    items: [
      {
        href: '/exercises',
        label: 'Exercises',
        match: ['/exercises', '/exercise'],
        icon: 'barbell-outline',
      },
    ],
  },
  {
    title: 'Tracking',
    items: [
      {
        href: '/measurements',
        label: 'Body measurements',
        match: ['/measurements', '/measurement'],
        icon: 'body-outline',
      },
      { href: '/records', label: 'Personal records', match: ['/records'], icon: 'trophy-outline' },
      {
        href: '/plate-calculator',
        label: 'Plate calculator',
        match: ['/plate-calculator'],
        icon: 'calculator-outline',
      },
    ],
  },
];

/**
 * Pinned to the bottom, away from the eleven destinations above it.
 *
 * Profile is a tab and belongs with Home and Workout by rank, but the rail has
 * already hoisted most of what Profile *contains* into the groups above, so
 * placed up top it would read as a fourth peer leading to a page the user has
 * just been shown the contents of. At the bottom it reads as what it is on a
 * desktop: the account and the settings, where every other app keeps them.
 */
const FOOTER: RailItem[] = [
  { href: '/profile', label: 'Profile', match: ['/profile'], icon: 'person-outline' },
  { href: '/settings', label: 'Settings', match: ['/settings'], icon: 'settings-outline' },
];

/**
 * Whether the current path belongs to a row.
 *
 * The trailing-slash form is what keeps `/records` from lighting on
 * `/records-archive` if one ever exists: a bare `startsWith` matches any route
 * whose name merely begins with another's. Home is special-cased because every
 * path in the app begins with `/`.
 */
function isActive(pathname: string, match: string[]): boolean {
  return match.some((prefix) =>
    prefix === '/'
      ? pathname === '/'
      : pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function RailRow({ item, active, live }: { item: RailItem; active: boolean; live?: boolean }) {
  const colors = useColors();

  /*
   * Three states, and only one of them is loud.
   *
   * Active takes the accent on both glyph and label over a tinted plate, which
   * is the same pairing a selected `Chip` uses. Inactive sits at
   * `textSecondary` rather than `textTertiary`: eleven rows at the third tier
   * is a wall of grey, and the tier exists for text that repeats something
   * already said.
   *
   * `live` is the rail's half of the tab bar's session indicator. The Workout
   * glyph holds the accent while a workout is open even when you are looking at
   * something else. The label deliberately stays inactive, exactly as it does
   * in the bar: lighting both would make the row look selected, which would be
   * a lie about where you are.
   */
  const fg = active ? colors.accent : colors.textSecondary;
  const fill = active ? colors.accentSurface : colors.background;

  return (
    <PressableScale
      accessibilityRole="link"
      accessibilityState={{ selected: active }}
      accessibilityLabel={live && !active ? `${item.label}, session in progress` : item.label}
      onPress={() => router.navigate(item.href)}
      fill={fill}
      fillPressed={active ? fill : colors.surfacePressed}
      // The active row holds its accent tint through both states, exactly as a
      // selected `Chip` does. It is already at the loud end, and a brighter
      // hover would read as a second kind of selected.
      hoverFill={active ? fill : hoverFill(colors.background, colors.surfacePressed)}
      // No scale. The row spans the rail, so shrinking it pulls both edges off
      // the rail's own margin at once: the same reasoning as `ListRow`.
      scaleTo={1}
      style={[styles.row, { backgroundColor: fill }]}
    >
      <Ionicons
        name={live && !active ? 'play-circle' : item.icon}
        size={19}
        color={live && !active ? colors.accent : fg}
      />
      <Text variant="bodyMedium" numberOfLines={1} style={[styles.rowLabel, { color: fg }]}>
        {item.label}
      </Text>
    </PressableScale>
  );
}

export function SideRail() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const sessionOpen = useOpenSession();

  return (
    <View
      // A `complementary` landmark rather than `navigation`, because the native
      // stack already publishes one for its own header. Two navigation landmarks
      // in one window is a rotor with two identically-named entries.
      accessibilityRole="none"
      style={[
        styles.rail,
        {
          backgroundColor: colors.background,
          borderRightColor: colors.border,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          // Added to the rail's own margin rather than replacing it. On its own
          // this overrode `paddingHorizontal`, and in a browser, where the inset
          // is 0, every row sat flush against the window's left edge.
          paddingLeft: spacing.md + insets.left,
        },
      ]}
    >
      {/*
        The wordmark, in the display cut at the rail's own margin.

        It sits where a desktop app's name sits, and it is the only place this
        app says its name to a user who is already inside it. A phone puts it
        on the launcher icon and the splash, neither of which a browser tab has
        an equivalent for.
      */}
      <View style={styles.brand}>
        <Text variant="subheading" color="text" style={styles.wordmark}>
          Lift
        </Text>
      </View>

      {/*
        Scrollable, because the rail is a list of eleven rows and the window it
        is in has no minimum height. At 700pt everything fits and this never
        appears; in a short window: a laptop with the browser at half height.
        The alternative is a rail whose last rows are simply unreachable.
      */}
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {GROUPS.map((group, index) => (
          <View key={group.title ?? 'primary'} style={index > 0 && styles.group}>
            {group.title && (
              <Text variant="overline" color="textTertiary" style={styles.groupTitle}>
                {group.title}
              </Text>
            )}
            {group.items.map((item) => (
              <RailRow
                key={item.label}
                item={item}
                active={isActive(pathname, item.match)}
                live={item.label === 'Workout' && sessionOpen}
              />
            ))}
          </View>
        ))}
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        {FOOTER.map((item) => (
          <RailRow key={item.label} item={item} active={isActive(pathname, item.match)} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    width: RAIL_WIDTH,
    // A hairline rather than a surface step, which is how this app separates
    // every other layer: see `elevation` in the tokens. A rail tinted off the
    // canvas would also be the one panel in the app that is, and on the AMOLED
    // palette it would light a 248pt strip that is currently unlit.
    borderRightWidth: stroke.rule,
    paddingHorizontal: spacing.md,
  },
  brand: {
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  wordmark: { ...font('display'), letterSpacing: -0.3 },
  scroll: { paddingBottom: spacing.md },
  group: { marginTop: spacing.lg },
  groupTitle: {
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
    // The rail can appear on a touch device. A tablet in landscape clears 840,
    // so the target keeps the app's touch minimum rather than dropping to the
    // 32pt a cursor-only control could get away with.
    minHeight: MIN_TOUCH_SIZE,
    borderRadius: radius.md,
  },
  // `flex: 1` so a long label ellipsises inside the rail rather than pushing
  // the rail wider than the width it declares.
  rowLabel: { flex: 1, fontSize: fontSize.md },
  footer: {
    borderTopWidth: stroke.rule,
    paddingTop: spacing.sm,
    marginTop: spacing.sm,
  },
});
