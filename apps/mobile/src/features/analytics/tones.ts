/**
 * Which ink each body part is drawn in, and which one of them is marked.
 *
 * This file used to hand out a hue: `Palette['data']` holds six colours for
 * telling one category from another, `BODY_PARTS` holds seven, six of which are
 * real muscle groups and one of which is "other", and the fit was exact because
 * body part is the category this app charts more than any other.
 *
 * ## Why that is not what it does any more
 *
 * The argument for a fixed hue per part was a good one and it is worth keeping
 * written down, because it is the thing being given up. Every chart of body
 * parts in this app is *sorted by volume*, so colouring the first bar `data[0]`
 * and the second `data[1]` would encode rank, which the bar's own length
 * already encodes, rather than encoding which muscle it is. A fixed map avoided
 * that: back was `data[1]` on Home, on the workout summary and on the stats
 * screens, in every week, forever, which let someone learn the key once instead
 * of reading the labels every time.
 *
 * What it cost is that a body-part chart is six hues, and this app draws one on
 * Home, on the workout summary and on four stats screens. A palette budgeted at
 * roughly one accent element per view was spending twenty. The same decision is
 * made in one place for the whole app and argued in full there: see
 * `toneColors` in `components/ui/surfaces.tsx`.
 *
 * The key is not gone, it is drawn by the thing every one of these call sites
 * already renders beside the bar, which is its name. What replaces the hue is a
 * three-step ink ramp that says something the labels cannot: `text` for the bar
 * the caller marks, `textSecondary` for the rest, `textTertiary` for the bucket
 * that is not a muscle group. In a sorted chart the marked bar is the leading
 * one, so the ramp restates the sort at the top and stays quiet below it, which
 * is a peak the six equal hues never had.
 *
 * ## Why the map below is still here
 *
 * `BODY_PART_TONE`'s indices are unread now. It stays because it is still the
 * one statement of which parts are muscle groups and which one is the
 * leftovers bucket, which is the distinction `bodyPartColor` turns into the
 * tertiary step, and because keeping it means the decision above is one
 * `return` to reverse rather than a ramp to reconstruct. The palettes keep
 * their `data` entries for the same reason, and because `audit-palette.mjs`
 * still measures them.
 */

import { BODY_PARTS, type BodyPart } from '@lift/shared';

import type { Palette } from '@/theme';

/** Index into `Palette['data']`, or null for the one bucket that is not a muscle. */
export const BODY_PART_TONE: Record<BodyPart, 0 | 1 | 2 | 3 | 4 | 5 | null> = {
  chest: 0,
  back: 1,
  shoulders: 2,
  arms: 3,
  core: 4,
  legs: 5,
  other: null,
};

/**
 * The ink a body part is drawn in, with the neutral for `other` folded in.
 *
 * `marked` is the caller saying "this is the one the chart is about", which in
 * every chart here means the largest, since all of them are sorted. It is the
 * caller's call rather than this function's because the sort happens up there:
 * a slice does not know its own rank.
 *
 * `other` ignores `marked` and stays tertiary. A chart whose largest slice is
 * the uncategorised bucket has no marked bar, which is the honest rendering of
 * a chart whose biggest finding is that it could not categorise anything.
 *
 * Unknown strings fall through to the neutral as well: `bodyPart` arrives from
 * the database as text, and a row written by an older build with a body part
 * this one has dropped should render as an uncategorised bar rather than crash
 * on an undefined index.
 */
export function bodyPartColor(bodyPart: string, colors: Palette, marked = false): string {
  const tone = BODY_PART_TONE[bodyPart as BodyPart];
  if (tone === null || tone === undefined) return colors.textTertiary;
  return marked ? colors.text : colors.textSecondary;
}

/**
 * Every body part that is a muscle group, in `BODY_PARTS` order, for a legend.
 *
 * Derived from `BODY_PARTS` rather than from the map's own key order, because
 * an object's key order is a fact about how the literal above was typed and
 * this needs to be the same order the rest of the app lists body parts in.
 */
export const TONED_BODY_PARTS: readonly BodyPart[] = BODY_PARTS.filter(
  (part) => BODY_PART_TONE[part] !== null,
);
