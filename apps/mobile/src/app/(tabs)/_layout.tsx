import { Ionicons } from '@expo/vector-icons';
import { Tabs, router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { type ColorValue } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HeaderAction, tabHeaderOptions } from '@/components/ui';
import { useOpenSession } from '@/features/workouts/use-open-session';
import {
  font,
  fontSize,
  spacing,
  spring,
  stroke,
  timing,
  useColors,
  useColumnGutter,
  useLayout,
} from '@/theme';

/** The bar's own height, before the system navigation area is added to it. */
const TAB_BAR_CONTENT_HEIGHT = 58;

/** How far a tab icon overshoots before settling when its tab is selected. */
const ICON_POP_SCALE = 1.14;

/**
 * The icon in a tab bar button, with a pop when its tab becomes the current one.
 *
 * The bar is the one piece of chrome on every screen, and switching tabs is the
 * most frequent navigation in the app, so it is the place where a missing
 * response is felt most often. The tint change alone is a state readout; the
 * pop is the part that answers the finger.
 *
 * It fires on becoming focused and never on mount. A bar whose icon jumps the
 * first time it is drawn is announcing the app's own startup, which is not an
 * event the user did anything to cause, and on a cold launch it lands in the
 * same few frames as the first screen's first paint, which is the last moment
 * to be spending on decoration.
 */
function TabIcon({
  name,
  size,
  color,
  focused,
}: {
  name: keyof typeof Ionicons.glyphMap;
  size: number;
  color: ColorValue;
  focused: boolean;
}) {
  const scale = useSharedValue(1);
  const wasFocused = useRef(focused);

  useEffect(() => {
    // Only the falling edge of "not focused" → "focused". Blurring is silent:
    // the tab being left is not the one the user is looking at.
    if (focused && !wasFocused.current) {
      scale.value = withSequence(
        withTiming(ICON_POP_SCALE, timing.press),
        withSpring(1, spring.bounce),
      );
    }
    wasFocused.current = focused;
  }, [focused, scale]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={style}>
      <Ionicons name={name} size={size} color={color} />
    </Animated.View>
  );
}

/** A tab header's side margins for a column `gutter` points in from the pane. */
function columnHeaderStyle(gutter: number) {
  return {
    headerTitleContainerStyle: { marginLeft: spacing.lg + gutter },
    headerRightContainerStyle: { paddingRight: spacing.lg + gutter },
  };
}

export default function TabLayout() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isWide } = useLayout();

  /**
   * Does a session exist: nothing else about it.
   *
   * A workout is app-global but its only affordance used to live on one tab out
   * of five, so anyone who tapped History mid-session had to remember which tab
   * resumes. The bar is the one piece of chrome present on all five, so it is
   * where that fact belongs.
   *
   * The query moved to `useOpenSession` when the desktop rail needed the same
   * bit; the reasoning about why it selects one column and no join went with
   * it, and is worth reading before changing either caller.
   */
  const sessionOpen = useOpenSession();

  /*
   * Each header's margins, set to the column its screen draws in.
   *
   * On a phone both gutters are 0 and this is the `lg` the headers always had.
   * Wide, the title moves in to sit over the content's left edge and the action
   * over its right, instead of the two being pinned to the corners of a pane
   * the content is centred in. Home is a `board` screen and the other two are
   * `column`s, so they get different gutters.
   */
  const boardHeader = columnHeaderStyle(useColumnGutter('board'));
  const columnHeader = columnHeaderStyle(useColumnGutter('column'));

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textTertiary,
        /**
         * The bar sits on the canvas colour, not `surface`. On AMOLED that keeps
         * the bottom of the screen genuinely unlit and stops a faintly lighter
         * strip from floating under every screen.
         *
         * Height and bottom padding both include `insets.bottom`. React
         * Navigation normally works that inset in for you, but only while it
         * owns the height: giving `tabBarStyle` a fixed `height` overrides that
         * calculation entirely, and on Android's edge-to-edge default the bar
         * then renders underneath the gesture pill or the 3-button bar.
         */
        /*
         * Hidden once the side rail is up, and hidden rather than restructured.
         *
         * React Navigation can mount this bar down the left edge instead
         * (`tabBarPosition: 'left'`), and that is not what the app does: see
         * `SideRail` for why a rail owned by this navigator is covered by every
         * screen pushed over it. The rail is a sibling of the whole stack, so
         * what is left here is one bar too many.
         *
         * `display: 'none'` keeps the navigator's structure identical across the
         * breakpoint: the tabs, their state and their frozen subtrees all
         * survive a window resize, where switching navigator configuration would
         * rebuild them.
         */
        tabBarStyle: isWide
          ? { display: 'none' }
          : {
              backgroundColor: colors.background,
              borderTopColor: colors.border,
              borderTopWidth: stroke.rule,
              height: TAB_BAR_CONTENT_HEIGHT + insets.bottom,
              paddingTop: spacing.xs,
              paddingBottom: insets.bottom,
            },
        tabBarLabelStyle: {
          fontSize: fontSize.xs,
          ...font('medium'),
        },
        tabBarItemStyle: { paddingVertical: spacing.xs / 2 },
        /*
         * The box the glyph is drawn in, widened because one tab draws a bigger
         * glyph than the box holds.
         *
         * React Navigation gives the icon a **fixed** wrapper: 24x24 on its
         * Material variant, 31x28 on its UIKit one, from `TabBarIcon`. The
         * glyph inside it is `position: 'absolute'` and centred, so a glyph
         * larger than the wrapper does not grow it. It draws past it, and the
         * bottom is what goes: the wrapper's height is what the item's column
         * reserves, so the label below sits over whatever spills out.
         *
         * The Workout tab asks for `size + 6` while a session is open, which is
         * 30 against a 24pt box on Android and 31 against a 28pt one on iOS.
         * That is the play-circle whose bottom edge is clipped, and it is the
         * one icon in the bar that is meant to be noticed. `size + 2` on the
         * other two overflows as well, by a point, which is why they look
         * slightly soft rather than obviously cut.
         *
         * 32 clears the largest glyph on both platforms with a point to spare.
         * The bar has room for it: 58 of content less the 4 above and the 4 the
         * item pads with leaves 49, and a 32pt icon over an 11pt label comes to
         * about 46.
         */
        tabBarIconStyle: { width: 32, height: 32 },
        /**
         * A 150ms crossfade, replacing the hard cut that used to be here.
         *
         * The cut was put in on the belief that a tab transition is driven from
         * JS and therefore competes with the incoming tab's database query.
         * Half of that is wrong: React Navigation animates the scene with
         * `Animated.timing` under `useNativeDriver`, so the fade itself runs on
         * the UI thread and cannot be stalled by anything JS is doing. The
         * query was real, and it is now held behind the transition by
         * `useDeferredFocusEffect`.
         *
         * What the cut actually bought was a *shorter* glitch, not the absence
         * of one: an instant jump to a tab that has not painted yet, then its
         * content popping in a few frames later. A crossfade covers exactly
         * that gap. There is no moving edge for the eye to track, so a scene
         * that is still resolving underneath simply arrives during the fade.
         *
         * `fade` rather than `shift` for the same reason. A slide would give a
         * directional cue the three fixed tabs could genuinely use, but it also
         * puts a hard edge on screen travelling 50pt, and an unpainted screen
         * behind a hard edge is visible in a way one behind a fade is not.
         */
        animation: 'fade',
        // Inactive tabs stop re-rendering while blurred. Without it, every tab's
        // live query re-runs on each other tab's writes.
        freezeOnBlur: true,
        // The same set the root stack spreads. This navigator titled its own
        // screens at 20/bold against the stack's 17/semibold, so pushing from
        // Home visibly shrank the title. `headerOptions` is where that lives
        // now, and neither navigator gets to disagree with it.
        //
        // The tab variant adds the two things a JS header does not get from the
        // platform: its own height, and a right margin for the actions below.
        ...tabHeaderOptions(colors, insets.top),
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      {/*
        The three headers below are the tab bar's other half, and they are
        configured here rather than by the screens for the same reason the bar
        is: they are chrome the navigator owns, they are mounted whether or not
        their screen has finished its queries, and the one bit any of them needs
        (is a session open) is already read at the top of this component.

        Setting them from inside the screens would mean `Tabs.Screen` options
        rebuilt on every render, which on the Workout tab is once a second while
        a session runs: its elapsed clock ticks, and every tick would push a new
        options object through `setOptions` and re-render the navigator to draw
        a header that had not changed.

        `title` stays on all three because it is what the tab bar labels itself
        with. `headerTitle` only overrides what the header draws.
      */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          /*
           * The week, under the word.
           *
           * This screen opens with "Volume this week" set in 24px and never
           * says which seven days that is, so a Sunday session either counts
           * or it doesn't, and the only way to find out was to log one and
           * watch the number. It also silently resets on a Monday, which reads
           * as data loss to anyone who does not know when the window turns.
           */
          headerTitle: 'Home',
          ...boardHeader,
          /*
           * History, pinned.
           *
           * Home is a summary of what History holds, so it is the destination
           * this tab leads to, but the only link to it lived at the bottom of
           * the recent-workouts block, which means it was behind a scroll, and
           * on an account with no workouts yet it did not exist at all. That
           * block keeps its own button: it is the "see all of these" for the
           * three rows above it, which is a different offer from this one.
           */
          headerRight: () => (
            <HeaderAction
              label="Open workout history"
              icon="time-outline"
              iconSize={24}
              onPress={() => router.push('/history')}
            />
          ),
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon name="home" size={size} color={color} focused={focused} />
          ),
        }}
      />
      {/*
        The middle tab, and the one that changes when something is happening.

        Three tabs rather than four is what puts it in the middle: under the
        thumb, at the widest target the bar has, and starting a workout is the
        thing this app is opened to do. Everything that was competing for that
        position was a place to *read* about training rather than to do it.

        Idle, the glyph is `barbell`. Ionicons has no `dumbbell`, and this is
        that icon in this set. It names the domain rather than the action, which
        is the trade against the `add-circle` it replaced: the tab is now
        recognisably the training tab at a glance, and gives up saying "start"
        to get there. The Workout screen's own button still carries `add`, so
        the instruction survives one level in, on the control that performs it.

        Once a session is open the tab means "go back to it", so the glyph
        becomes `play-circle`, which is both the clearer verb and the same
        `play` the screen's button switches to, so the two still agree there.

        The two are set at different sizes on purpose. `play-circle` is a
        compact filled disc that has to be pushed past its neighbours to read as
        the bar's anchor; `barbell` is a wide horizontal glyph that reaches that
        width on its own, and at the same value it would overhang Home and
        Profile rather than outrank them.

        The tint is the louder half. While a session runs the icon holds
        `accent` even when the tab is blurred, so from Home or Profile the
        middle of the bar is lit while the other two sit at `textTertiary`.
        The label deliberately stays on the inactive tint: lighting both would
        make the tab look selected, which would be a lie about where you are.

        What this is not: a static state, changed at most a few times per
        session. No elapsed clock lives here. A counter in the tab bar would
        re-render the bar every second on top of whichever screen the user is
        actually working on: the mistake `ElapsedStat` on the active screen is
        written to avoid.
      */}
      <Tabs.Screen
        name="workout"
        options={{
          title: 'Workout',
          ...columnHeader,
          /*
           * Resume, for as long as there is something to resume.
           *
           * The screen already opens with a card that does this, and the card
           * scrolls away: under a routine list of any length, the one thing
           * you are mid-way through is the first thing to leave the screen.
           * The header does not scroll.
           *
           * `filled` is spent here rather than saved: it is reserved for the
           * one action a screen exists to complete, and while a session is open
           * this tab exists to get you back into it. It is also the only header
           * in the app whose action appears and disappears, which is the point.
           * A pill that is only ever there when it means something.
           */
          headerRight: sessionOpen
            ? () => (
                <HeaderAction
                  label="Resume the workout in progress"
                  title="Resume"
                  variant="filled"
                  onPress={() => router.push('/workout/active')}
                />
              )
            : undefined,
          // Only overridden while live: otherwise the tab announces its label,
          // which is already right.
          tabBarAccessibilityLabel: sessionOpen ? 'Workout, session in progress' : undefined,
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon
              name={sessionOpen ? 'play-circle' : 'barbell'}
              size={sessionOpen ? size + 6 : size + 2}
              color={sessionOpen ? colors.accent : color}
              focused={focused}
            />
          ),
        }}
      />
      {/*
        No History or Exercises tab. Three is the whole bar.

        Both were places to look something up rather than to do something, and a
        permanent tab is the most expensive piece of chrome the app has to give:
        every one of them narrows the middle target that starts a workout. The
        library is a reference book, opened to check one lift, and the place
        people actually reach for an exercise is the picker inside a session.
        History is read after training, not during, and Home already carries
        the last few sessions, which is the part of it anyone checks daily.

        Both now hang off Profile, which is what that tab is for: everything
        about training that isn't training. Neither lost a feature in the move,
        only a permanent seat.
      */}
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          ...columnHeader,
          /*
           * Settings, from the top of the screen instead of the bottom.
           *
           * Profile is five cards deep: Insights, Account, Library, Tracking,
           * App, and Settings is a row inside the last of them, which puts the
           * most-visited destination on this tab below everything the tab is
           * sorted into. The row stays: the App card is an index of a section
           * and a hole in it would be worse than a second path. The desktop
           * rail already makes the same call, pinning Settings to its footer.
           */
          headerRight: () => (
            <HeaderAction
              label="Open settings"
              icon="settings-outline"
              iconSize={24}
              onPress={() => router.push('/settings')}
            />
          ),
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon name="person" size={size} color={color} focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}
