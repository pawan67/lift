/**
 * The superset control, and the two marks that say a superset is there.
 *
 * One file for both screens on purpose. A superset prescribed in a routine and
 * a superset performed in a session are the same fact about the same two lifts,
 * stored in the same column of two tables, and `copyRoutineIntoWorkout` carries
 * it from one to the other. If they were built separately they would drift, and
 * the first thing to drift would be the letter: a routine calling a pair "A"
 * that the session it starts calls "B" is worse than not labelling either.
 *
 * The arithmetic is not here. `@lift/shared`'s `supersets.ts` decides which
 * rows change, and this decides what the user is asked and what they see.
 */

import { Ionicons } from '@expo/vector-icons';
import {
  joinSuperset,
  leaveSuperset,
  supersetPlacements,
  type SupersetAssignment,
  type SupersetPlacement,
  type SupersetRow,
} from '@lift/shared';
import { StyleSheet, View } from 'react-native';

import { PressableScale, Text } from '@/components/ui';
import { haptics } from '@/features/feedback/haptics';
import { showDialog } from '@/store/dialog';
import { radius, spacing, useColors, type Palette } from '@/theme';

/** An exercise as the superset menu needs it: its grouping, and what to call it. */
export interface SupersetCandidate extends SupersetRow {
  name: string;
}

/**
 * The chip's reach. Asymmetric like the rest chip beside it and for the same
 * reason (`REST_SLOP` in `exercise-block.tsx`): overlapping slop is not shared,
 * so two neighbours both reaching 8pt toward each other turn the gap between
 * them into a band where the later sibling silently wins.
 */
const CHIP_SLOP = { top: 12, bottom: 12, left: 6, right: 4 };

/**
 * Where in a list an exercise sits, for both marks and the menu.
 *
 * Re-derived per screen rather than stored: see `runLabel`. The map is keyed by
 * the *link* row's id (`workoutExercises.id`, `routineExercises.id`), not the
 * exercise's, because the same lift can appear twice in one session and only
 * one of the two may be in the superset.
 */
export function supersetMap(rows: readonly SupersetRow[]): Map<string, SupersetPlacement> {
  return supersetPlacements(rows);
}

/**
 * The ink a superset is drawn in, which is one ink for all of them.
 *
 * This used to be a hue per letter, keyed on the letter rather than on how many
 * supersets happened to be on screen, so dismantling A did not recolour B. It
 * had a second layer under it too: `data` is only a genuine six-hue ramp on the
 * ported themes, and on the default light and dark palettes it is six limes,
 * which is why two rails there once looked like one line, so the letter indexed
 * the role colours instead on those two.
 *
 * All of it is gone with the rest of the app's categorical colour (see
 * `toneColors` in `components/ui/surfaces.tsx`), and this is the call site
 * where losing it costs least. The identity of a superset is a *letter*, drawn
 * at the head of every block in the group and in the chip on each one. Naming
 * it a second time in hue was the most redundant colour in the app: A was
 * already A.
 *
 * What is left, and this is the part to preserve if anyone revisits it, is that
 * a grouped block still has to look grouped. That is carried by the upright
 * rail between members and by the chip, both of which are still drawn, just in
 * ink. The one thing this no longer does is tell *two adjacent groups* apart at
 * a glance, and the letters do that.
 *
 * The signature keeps `label` so the call sites do not churn and so the hue can
 * come back in one function if it is ever wanted.
 */
export function supersetColor(colors: Palette, _label: string): string {
  return colors.textSecondary;
}

/**
 * The state chip, which is also the control.
 *
 * Always rendered, in both states, and that is the discoverability argument:
 * the same one `UnitHeader` makes one file over. A superset has no home in a
 * menu because there is nothing to name it in a menu that the header cannot say
 * outright, and a control that is only there once the feature is already in use
 * is a control nobody finds.
 *
 * The two states are a colour apart rather than a shape apart. `A` on the
 * accent says this lift is in the first superset here; the bare link glyph in
 * tertiary says it is not in one, and both are the same pill in the same slot,
 * so joining a superset does not shove the row's other controls sideways under
 * a thumb that is already moving.
 *
 * The accent is budgeted at roughly one element per view (`theme/tokens.ts`)
 * and this is spending it once per superset member. That is affordable because
 * a superset is rare and deliberate: a session with one has two accented chips
 * in it, and a session without has none. It is the same trade the rest chip
 * makes, which goes accent only when the rest was chosen rather than inherited.
 */
export function SupersetChip({
  placement,
  exerciseName,
  onPress,
}: {
  placement: SupersetPlacement | undefined;
  /** For the spoken label: a chip reading "A" alone names nothing. */
  exerciseName: string;
  onPress: () => void;
}) {
  const colors = useColors();
  const tone = placement ? supersetColor(colors, placement.label) : colors.textTertiary;

  return (
    <PressableScale
      onPress={onPress}
      hitSlop={CHIP_SLOP}
      accessibilityRole="button"
      accessibilityLabel={
        placement
          ? `${exerciseName} is in superset ${placement.label}, ${placement.index} of ${placement.size}`
          : `${exerciseName} is not in a superset`
      }
      accessibilityHint="Pairs this exercise with the one above or below it"
      fill={colors.surfaceMuted}
      fillPressed={colors.surfacePressed}
      style={[styles.chip, { backgroundColor: colors.surfaceMuted }]}
    >
      <Ionicons
        name="git-merge-outline"
        size={12}
        color={tone}
      />
      {placement && (
        <Text variant="caption" style={{ color: tone }}>
          {placement.label}
        </Text>
      )}
    </PressableScale>
  );
}

/**
 * What goes between two exercises performed back to back, in place of the rule
 * that would otherwise separate them.
 *
 * A `Divider` between them would be saying the opposite of the truth. These two
 * are one piece of work, and the list's own punctuation for "next thing" is
 * exactly what has to stop appearing there.
 *
 * Upright, and that is the whole of it. A horizontal stroke is what every rule
 * in the app already is, so a short accented one in the channel between two
 * blocks reads as an underline on the block above rather than as a link to the
 * one below. Turned ninety degrees it crosses the channel instead of lying in
 * it, and the two blocks read as continuous. It sits at the content margin,
 * where every first line on the screen starts.
 *
 * Drawn rather than left blank because blank is ambiguous: a session with no
 * rule between two blocks and no rule anywhere else looks like a rendering bug.
 */
export function SupersetTie() {
  const colors = useColors();

  return (
    <View style={styles.tie}>
      <View style={[styles.tieRule, { backgroundColor: colors.accent }]} />
    </View>
  );
}

/**
 * Asks what to pair this exercise with, and hands back the writes.
 *
 * Positional, and the dialog says so by printing the neighbours' names: the
 * only pairing a superset can express is "these two, back to back", so the
 * offer is the row above and the row below and nothing else. Wanting to
 * superset with something further down the list is a request to move it first,
 * and the reorder sheet is one action away in the same menu.
 *
 * Actions are built in list order, top before bottom, so the two offers sit in
 * the dialog the way they sit on screen. Leaving comes last before Cancel,
 * because it is the destructive one and it is only ever there when the chip was
 * already accented, which is how the user knew to open this.
 *
 * The dialog is not skipped when there is only one thing to offer, though the
 * first version did skip it: the exercises at the two ends of a list have one
 * neighbour each and the ones between them have two, so a shortcut for the
 * single-offer case makes the chip commit instantly at the top and bottom of
 * the session and open a menu everywhere else. A control that sometimes acts
 * and sometimes asks, decided by where you happen to be scrolled to, is worse
 * than one that always asks. The name of the exercise being paired with is the
 * point of asking anyway, and it is not on screen anywhere else at the moment
 * of the tap.
 */
export function showSupersetMenu(
  rows: readonly SupersetCandidate[],
  id: string,
  apply: (writes: SupersetAssignment[]) => void,
): void {
  const index = rows.findIndex((row) => row.id === id);
  if (index === -1) return;

  const placements = supersetPlacements(rows);
  const placement = placements.get(id);
  const self = rows[index];
  if (!self) return;

  const offers: { label: string; writes: SupersetAssignment[] }[] = [];

  for (const [direction, neighbour] of [
    ['up', rows[index - 1]],
    ['down', rows[index + 1]],
  ] as const) {
    if (!neighbour) continue;

    // The empty answer is the filter. `joinSuperset` writes nothing when the
    // two are already in the same superset, which covers both the end of the
    // list and every member that is not at an end of its own run, and an
    // action that writes nothing is an action that appears to have failed.
    const writes = joinSuperset(rows, id, direction);
    if (writes.length > 0) {
      offers.push({
        label: `Superset with ${neighbour.name}`,
        writes,
      });
    }
  }

  const commit = (writes: SupersetAssignment[]) => {
    haptics.selection();
    apply(writes);
  };

  const actions = offers.map((offer) => ({
    label: offer.label,
    onPress: () => commit(offer.writes),
  }));

  if (placement) {
    actions.push({
      label: `Leave superset ${placement.label}`,
      // Not destructive: nothing logged is lost, and the pair is one tap back.
      // The red is reserved for the deletes in the menu this came from.
      onPress: () => commit(leaveSuperset(rows, id)),
    });
  }

  void showDialog({
    title: self.name,
    message: placement
      ? `Superset ${placement.label}, ${placement.index} of ${placement.size}. Supersets are performed back to back, so an exercise can only join the one directly above or below it.`
      : 'A superset is performed back to back, so this can only be paired with the exercise directly above or below it.',
    actions: [...actions, { label: 'Cancel', style: 'cancel' as const }],
  });
}

const styles = StyleSheet.create({
  // The rest chip's box, so the two sit as a pair rather than as two chips that
  // nearly match. The gap is 3 and not a spacing token: the letter is an
  // annotation on the glyph, not a second item beside it.
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    minHeight: 20,
  },
  // No vertical padding: the stroke is the height of the channel, so it spans it
  // rather than floating in the middle of it.
  tie: { height: spacing.xxl, paddingLeft: spacing.lg, justifyContent: 'center' },
  // Two points rather than a hairline. This is the one accented mark on the
  // screen that has to survive being glanced past at arm's length on a rack,
  // and a hairline at that width disappears.
  tieRule: { width: 2, height: '100%', borderRadius: 1 },
});
