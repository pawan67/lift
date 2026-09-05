import type { VolumeLandmarks } from '@lift/shared';

import { mix } from '@/theme/color';
import type { Palette } from '@/theme/tokens';

/**
 * The colour a set count is drawn in, given the landmarks it is judged against.
 *
 * The landmarks themselves live in `@lift/shared`. They are per muscle, and the
 * API and the sync engine have as much claim on them as the statistics screens
 * do. What is left here is the part that is only ever true of this app: how a
 * week's volume becomes a colour on a body map.
 */

// ---------------------------------------------------------------------------
// Colour ramp
// ---------------------------------------------------------------------------

/**
 * The ramp, anchored to the landmarks rather than to even percentage steps.
 *
 * Colour changes fastest where the boundaries actually mean something, so two
 * muscles that sit either side of `mev` look different even when their set
 * counts are close. Past `mrv` (the recoverable ceiling) the ramp leaves the
 * accent hue entirely: an overreached muscle should not read as "more of a good
 * thing", which is the one thing a single-hue opacity ramp can never express.
 *
 * Rows whose `mv` and `mev` are zero (glutes, abs, traps: the muscles fed by
 * work logged against something else) collapse the first two stops onto zero,
 * so their ramp starts partway up the accent. That is the right reading: a
 * muscle with no minimum effective volume is growing from its first direct set.
 */
/**
 * The scale, from untrained through the productive range and out the far side.
 *
 * The one place in the app where colour still crosses hues, and the one place
 * it earns it: this is not a category and not a quantity, it is a *verdict* on
 * a quantity, and amber-then-red is the only part of the palette that can say
 * "at your ceiling" and "past it" without a legend. The legend is drawn anyway
 * (`volume-legend.tsx`), because the boundaries are per-muscle.
 *
 * The productive half used to run muted-to-*accent*, which put "you are
 * training this about right" in the app's brightest colour. That was backwards
 * twice over: it made the ordinary state the loudest one, and it left the
 * scale with no quiet end at all, so a body map of six well-trained muscles
 * lit up like an alarm. Ramping to `text` instead means the good range reads
 * as filled-in rather than as flagged, and the two hues above it are the only
 * thing on the map that is trying to catch the eye, which is what they are
 * for.
 */
function stops(l: VolumeLandmarks, colors: Palette): { at: number; color: string }[] {
  return [
    { at: 0, color: colors.surfaceMuted },
    { at: l.mv, color: mix(colors.surfaceMuted, colors.text, 0.35) },
    { at: l.mev, color: mix(colors.surfaceMuted, colors.text, 0.7) },
    { at: l.mav, color: colors.text },
    { at: l.mrv, color: colors.warning },
    { at: l.mrv + 12, color: colors.danger },
  ];
}

/**
 * Colour for a muscle that saw `setsPerWeek` working sets.
 *
 * Unlike a share-of-peak ramp this is absolute: a muscle is dim because it was
 * genuinely undertrained, not merely because some other muscle got more. A
 * deload week and a hard week no longer look the same.
 */
export function volumeColor(
  setsPerWeek: number,
  colors: Palette,
  landmarks: VolumeLandmarks,
): string {
  if (setsPerWeek <= 0) return colors.surfaceMuted;
  // A row with no ceiling is one of the non-muscles, and every stop below would
  // sit on zero, which would put a single logged cardio set at the far end of
  // the ramp, in the colour reserved for overreaching. Nothing is being measured
  // here, so nothing is coloured.
  if (landmarks.mrv <= 0) return colors.surfaceMuted;

  const ramp = stops(landmarks, colors);
  const last = ramp[ramp.length - 1];
  if (setsPerWeek >= last.at) return last.color;

  for (let i = 1; i < ramp.length; i++) {
    const lo = ramp[i - 1];
    const hi = ramp[i];
    if (setsPerWeek <= hi.at) {
      const span = hi.at - lo.at;
      return mix(lo.color, hi.color, span === 0 ? 1 : (setsPerWeek - lo.at) / span);
    }
  }
  return last.color;
}

/**
 * Sample points for the legend, so it ramps identically to the figures.
 *
 * Deduplicated because a row with no MV or MEV collapses those stops onto zero,
 * and the legend would otherwise draw the same swatch three times.
 */
export function legendSamples(l: VolumeLandmarks): number[] {
  return [...new Set([0, l.mv, l.mev, (l.mev + l.mav) / 2, l.mav, l.mrv, l.mrv + 12])];
}
