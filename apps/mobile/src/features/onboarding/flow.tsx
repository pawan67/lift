/**
 * The first four screens, and the only four questions the app asks unprompted.
 *
 * Everything here is optional. Every page can be left by the control in the
 * corner, the flow can be abandoned at any point, and abandoning it costs
 * nothing that cannot be set later on a settings screen that already exists.
 * That is not politeness, it is the shape of the app: this is a tracker, the
 * user has already decided to install it, and a wall of questions between
 * somebody and their first set is a wall between somebody and the reason they
 * came. Four pages is the most a tracker gets to ask for.
 *
 * The four are also not arbitrary. Each is something the app is measurably
 * worse without and cannot work out for itself: units decide whether every
 * figure in the app reads right, bodyweight decides whether a push-up counts as
 * work at all, and an import decides whether somebody starts at zero or starts
 * with their history. The welcome page asks nothing, and is the only one that
 * could be cut without losing a number.
 *
 * It renders over the app rather than instead of it, which is what lets the
 * import page hand off to `/import` with a real back stack behind it. See the
 * note on `Onboarding` for the rest of that reasoning.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { BackHandler, Platform, StyleSheet, View } from 'react-native';
import Animated, {
  FadeInDown,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, PressableScale, Text } from '@/components/ui';
import { haptics } from '@/features/feedback/haptics';
import { useSettings } from '@/store/settings';
import { contentWidth, duration, easing, spacing, timing, useColors } from '@/theme';

import { PAGES } from './pages';

/**
 * What a page is handed, and the whole of what it is allowed to do.
 *
 * A page owns its own question and nothing else: it cannot advance the flow, it
 * does not know which number it is, and it never draws the button that submits
 * it. `onCommit` is the one channel out, and a page with nothing to write
 * simply never calls it.
 */
export interface PageProps {
  /**
   * Register what to write if this page's button is pressed, or null to write
   * nothing.
   *
   * Called from an effect rather than during render, because the shell holds it
   * in a ref and a page that registered during render would be writing into its
   * parent mid-render. The stored function is only ever read from the button
   * handler, by which point every effect has run.
   */
  onCommit: (commit: (() => void | Promise<void>) | null) => void;
}

export interface OnboardingPage {
  /** Stable key. Also the page's identity across the transition. */
  key: string;
  /** The question, in sentence case. One line at the width of a phone. */
  title: string;
  /** One or two lines under it, saying why the question is worth answering. */
  detail: string;
  /** The primary button's label. "Continue" on most of them. */
  action: string;
  /**
   * The control that answers the question, if there is one.
   *
   * Optional because the welcome page asks nothing, and a page with no control
   * should have no slot: an empty View with a 32pt margin above it is not
   * nothing, it is a gap that reads as something failing to render.
   */
  render?: (props: PageProps) => ReactNode;
}

/** How far a page rises as it fades in. The same distance `Reveal` uses. */
const PAGE_RISE = 12;

/**
 * The page transition: a fade with a short rise.
 *
 * Not a horizontal slide, which is what a stepped flow usually gets. A slide
 * says the two pages are places, side by side, and invites a swipe back between
 * them. These are four unrelated questions in a fixed order and there is no
 * swipe to offer. Built once at module scope because an entering animation is a
 * descriptor, not a hook, and rebuilding it per render would re-fire it on
 * updates that were never entrances.
 *
 * `ReduceMotion.System` matters more here than almost anywhere in the app: this
 * is the first thing a new install animates, so it is the one animation nobody
 * has had a chance to expect.
 */
const PAGE_ENTERING = FadeInDown.duration(duration.base)
  .easing(easing.out)
  .withInitialValues({ transform: [{ translateY: PAGE_RISE }] })
  .reduceMotion(ReduceMotion.System);

/** The corner control is small type; the target around it is not. */
const SKIP_HIT_SLOP = { top: 12, bottom: 12, left: 16, right: 16 };

/** Thin enough to read as a rule rather than as a bar with a job. */
const RULE_HEIGHT = 3;

/**
 * The flow, over the app it is about to hand over to.
 *
 * Mounted as a sibling of the navigator rather than in place of it, and the
 * difference matters exactly once: the last page offers to read an export, and
 * the screen that does that is a route. Rendered instead of the navigator this
 * component would have no router to push into, and would need a hand-off
 * channel plus a deferred navigation on the other side of it. Rendered over the
 * navigator it can simply finish and push, and what the push lands on top of is
 * the app the user was going to end up in anyway.
 *
 * It is opaque and fills the screen, so what is underneath is never seen. The
 * one thing that does leak through is the Android back gesture, which would
 * otherwise drive a stack the user cannot see, so this owns the back button for
 * as long as it is up.
 */
export function Onboarding() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const update = useSettings((state) => state.update);

  const [index, setIndex] = useState(0);
  const page = PAGES[index]!;
  const isLast = index === PAGES.length - 1;

  /*
   * What the current page would write, held in a ref rather than in state.
   *
   * Nothing renders differently because of it: the button is drawn by the shell
   * and its label comes from the page descriptor, so a page registering a write
   * is not a visual change and should not cost a render. It is read in one
   * place, the button handler, and cleared on every move so a page's write can
   * never be applied by the page after it.
   */
  const commit = useRef<(() => void | Promise<void>) | null>(null);
  const onCommit = useCallback((next: (() => void | Promise<void>) | null) => {
    commit.current = next;
  }, []);

  const finish = useCallback(() => {
    update('onboardingCompletedAt', Date.now());
  }, [update]);

  const advance = useCallback(
    (applying: boolean) => {
      haptics.selection();

      /*
       * The write goes first, and is not waited on.
       *
       * Everything a page commits lands in a store that is read synchronously
       * and persisted behind the user, so holding the transition open for
       * SQLite would buy a stutter and nothing else. The one page that writes
       * to a table rather than to settings owns that wait itself.
       */
      if (applying) void commit.current?.();
      commit.current = null;

      if (isLast) {
        finish();
        return;
      }
      setIndex((current) => current + 1);
    },
    [finish, isLast],
  );

  /*
   * Android's back gesture, for as long as this is on screen.
   *
   * Without this it reaches the navigator underneath and pops a stack nobody
   * can see, so the first press appears to do nothing and the second closes the
   * app from what looks like its first screen. Here it does the one thing back
   * means in a stepped flow: the previous question, and on the first one,
   * nothing at all. Deliberately not "leave the flow", which is what the corner
   * control is for and is a decision worth making on purpose rather than by
   * pressing back one more time than intended.
   */
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (index === 0) return true;
      commit.current = null;
      setIndex((current) => current - 1);
      return true;
    });

    return () => subscription.remove();
  }, [index]);

  return (
    <View
      // `collapsable={false}`: a layout-only View whose whole job is to be the
      // opaque layer over the navigator, which is exactly the shape Android's
      // view flattening has removed in this app before.
      collapsable={false}
      // iOS: stops VoiceOver walking into the navigator underneath, which is
      // otherwise fully readable through an opaque layer. Android has no
      // equivalent prop on the modal side, so the navigator is hidden from its
      // own side instead: see `importantForAccessibility` in `_layout`.
      accessibilityViewIsModal
      style={[
        styles.sheet,
        {
          backgroundColor: colors.background,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        },
      ]}
    >
      {/*
        A column rather than the full width of the window.

        This app runs in a browser and on a tablet, where `fullWidth` on the
        button means a 1400pt control, and a question centred in that much
        space stops reading as centred at all. `contentWidth.form` is what
        every other single-column screen in the app is held to.
      */}
      <View style={styles.column}>
        <View style={styles.top}>
          <ProgressRule step={index + 1} total={PAGES.length} />
          <PressableScale
            onPress={() => advance(false)}
            accessibilityRole="button"
            accessibilityLabel={isLast ? 'Skip, and finish setting up' : 'Skip this question'}
            hitSlop={SKIP_HIT_SLOP}
            style={styles.skip}
          >
            <Text variant="label" color="textTertiary">
              Skip
            </Text>
          </PressableScale>
        </View>

        {/*
          Keyed on the page, so every page is a fresh mount.

          That is what makes the transition work without a pager: the outgoing
          tree unmounts and the incoming one animates in under its own entering
          animation. It also means a page cannot carry state into the next one,
          which is the right default for four questions with nothing to do with
          each other.
        */}
        <Page key={page.key} page={page} onCommit={onCommit} />

        <View style={styles.footer}>
          <Button title={page.action} onPress={() => advance(true)} fullWidth />
        </View>
      </View>
    </View>
  );
}

/**
 * One question, centred in whatever is left between the rule and the button.
 *
 * Centred rather than topped, and it is the only layout decision here worth
 * defending at length. A form is top-aligned because it has many fields and the
 * eye needs a left edge to run down. This has one field, and a single control
 * floating under a heading at the top of an otherwise empty page reads as a
 * page that failed to finish loading. Centred, the emptiness is the
 * composition rather than an absence.
 */
function Page({ page, onCommit }: { page: OnboardingPage; onCommit: PageProps['onCommit'] }) {
  const control = page.render?.({ onCommit });

  return (
    <Animated.View style={styles.page} entering={PAGE_ENTERING}>
      <Text variant="title" align="center">
        {page.title}
      </Text>
      <Text variant="body" color="textSecondary" align="center" style={styles.detail}>
        {page.detail}
      </Text>
      {control != null && <View style={styles.control}>{control}</View>}
    </Animated.View>
  );
}

/**
 * How far through, as a single filled rule.
 *
 * A rule rather than a row of dots, and full-bleed rather than inset, because
 * at four pages the difference between two dots and three is a glance where the
 * difference between a quarter and a half is not. The fill travels rather than
 * jumping, which is the only thing on the page saying the two screens were the
 * same screen.
 */
function ProgressRule({ step, total }: { step: number; total: number }) {
  const colors = useColors();
  const progress = useSharedValue(step / total);

  useEffect(() => {
    progress.value = withTiming(step / total, timing.travel);
  }, [progress, step, total]);

  /*
   * Two flexed halves rather than one animated width, because a width in points
   * needs a measured track and this one is whatever the row leaves it.
   *
   * Both floors are non-zero. A `flex: 0` child falls back to its content size,
   * which for an empty View is nothing, and the first page would then draw no
   * fill at all on the frame before the animation starts. A thousandth of the
   * track is invisible and removes the whole question.
   */
  const fill = useAnimatedStyle(() => ({ flex: Math.max(progress.value, 0.001) }));
  const rest = useAnimatedStyle(() => ({ flex: Math.max(1 - progress.value, 0.001) }));

  return (
    <View
      style={styles.rule}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: total, now: step }}
      accessibilityLabel={`Step ${step} of ${total}`}
    >
      <Animated.View style={[fill, styles.ruleSegment, { backgroundColor: colors.accent }]} />
      <Animated.View style={[rest, styles.ruleSegment, { backgroundColor: colors.border }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    flex: 1,
    width: '100%',
    maxWidth: contentWidth.form,
    alignSelf: 'center',
  },
  sheet: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    // Above the navigator and the desktop rail, and below nothing: no sheet or
    // dialog can be open while this is up, because none of the screens that
    // raise one is reachable from here.
    zIndex: 10,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },
  rule: {
    flex: 1,
    flexDirection: 'row',
    height: RULE_HEIGHT,
    borderRadius: RULE_HEIGHT,
    overflow: 'hidden',
  },
  ruleSegment: { borderRadius: RULE_HEIGHT },
  skip: { paddingVertical: spacing.xs },
  page: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
    // Pulled up off the true centre. Optical centring: a heading and a control
    // read as sitting low when they are on the geometric middle of a page with
    // a button pinned underneath them, and the button is what is underneath.
    paddingBottom: spacing.huge,
  },
  detail: {
    marginTop: spacing.sm,
    maxWidth: 300,
  },
  control: {
    width: '100%',
    maxWidth: 320,
    marginTop: spacing.xxxl,
    alignItems: 'center',
  },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
  },
});
