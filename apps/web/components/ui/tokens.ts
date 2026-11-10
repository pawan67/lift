/**
 * The design tokens as CSS variable references, for the places that take a
 * colour as a string rather than a class: Recharts props, SVG attributes and
 * inline `style`. Each one resolves against the active theme, so a chart
 * redraws in the light palette with no re-render.
 *
 * The values live in `theme.css`; this file only names them.
 */

const v = (name: string) => `var(--${name})`;

/** A token at reduced strength, for fills that sit behind something. */
export const alpha = (color: string, percent: number) => `color-mix(in srgb, ${color} ${percent}%, transparent)`;

export const color = {
  ink: v("ink"),
  surface: v("surface"),
  surface2: v("surface-2"),
  surface3: v("surface-3"),
  surface4: v("surface-4"),
  line: v("line"),
  lineStrong: v("line-strong"),
  fg: v("fg"),
  fg2: v("fg-2"),
  fg3: v("fg-3"),
  volt: v("volt"),
  voltDeep: v("volt-deep"),
  voltInk: v("volt-ink"),
  record: v("record"),
  signal: v("signal"),
  warn: v("warn"),
  alarm: v("alarm"),
  info: v("info"),
  violet: v("violet"),
  teal: v("teal"),
  hoverWash: v("hover-wash"),
} as const;
