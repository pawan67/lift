/**
 * How a trained day is shaded, wherever the app draws a grid of days.
 *
 * One scale, `intensityStep`, decides what counts as a heavy day, and one ramp,
 * `dayFill`, paints it: the muted surface towards the accent. All three grids
 * read both, so the same day is the same intensity and the same colour on
 * Calendar, on History and on Home's tile.
 *
 * There was a second ramp here, `dayShade`, running `borderStrong` towards
 * `textSecondary`, for a grid that was one block among several and could not
 * afford the accent. Home's `CalendarWidget` was its only caller and now draws
 * `dayFill` like the other two; the note on that component records the argument
 * it used to make and what answered it. The neutral ramp went with it rather
 * than sitting here unused, which is the state a second ramp has to earn.
 *
 * This was a component file's private section until it had three consumers. A
 * pure function that takes a number and a palette and returns a colour is not
 * part of a grid, and importing `MonthGrid` to reach one was the tell.
 */

import { mix, type Palette } from '@/theme';

/**
 * How far each step of the ramp travels from the muted surface towards the
 * accent.
 *
 * Four steps rather than a continuous gradient. A day's volume is a coarse
 * signal: the difference between 8,000 kg and 8,400 kg is noise, and rendering
 * it as a visible shade difference invites the reader to compare two squares
 * that are not meaningfully different. Steps also make the legend honest: four
 * swatches can be shown, a gradient can only be gestured at.
 *
 * The floor sits at 0.38 rather than just off the surface it starts from,
 * because the lightest trained day still has to read as *trained*: there it
 * measures 3.57:1 against the dark card and 1.93:1 against the light one. The
 * light palette cannot reach 3:1 at the bottom of the ramp. Its card is white
 * and its accent a mid olive, so a first step that contrasted that strongly
 * would have to start two thirds of the way up and the three above it would
 * have nowhere left to go. What backs it up there is the day number, which
 * changes colour on a trained square, and the label a screen reader is given.
 *
 * The top stops just short of the raw accent so the busiest day of a month
 * reads as the end of a scale rather than as a button. Every step's number
 * clears 5:1 against its own fill in both palettes: see `readableOn`.
 */
const RAMP = [0.38, 0.58, 0.77, 0.96];

/**
 * Which step of the ramp a day's volume lands on, against the typical day.
 *
 * Absolute, not relative to the month on screen: see `typicalVolumeKg` in
 * `calendar.ts` for why. A day at the median sits on step 1, half again on
 * step 2, and 1.5x the median or more tops the scale. Most training days land
 * on the middle two steps, which is what leaves the outliers visible.
 */
export function intensityStep(volumeKg: number, typicalVolumeKg: number): number {
  if (volumeKg <= 0 || typicalVolumeKg <= 0) return 0;

  const ratio = volumeKg / typicalVolumeKg;
  if (ratio < 0.6) return 0;
  if (ratio < 1) return 1;
  if (ratio < 1.5) return 2;
  return 3;
}

/** The ramp every day grid in the app draws. */
/**
 * The four steps of a trained day, ramped toward the ink.
 *
 * This mixed toward the accent, which made the training-days grid the largest
 * block of colour in the app: eight to twelve weeks of squares, most of them
 * carrying some fraction of it. A contribution grid is a sequential scale over
 * one quantity, so it reads exactly as well on a single ink ramp, and it is now
 * the same ramp the body map and every chart use. See `toneColors` in
 * `components/ui/surfaces.tsx` for the rule.
 */
export function dayFill(step: number, colors: Palette): string {
  return mix(colors.surfaceMuted, colors.text, RAMP[step] ?? RAMP[0]);
}

/** The accent ramp's four stops, for the legend under a grid. */
export function rampSamples(colors: Palette): string[] {
  return RAMP.map((_, step) => dayFill(step, colors));
}
