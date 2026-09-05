import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import {
  Image,
  StyleSheet,
  View,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
  type ImageSourcePropType,
  type PressableProps,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

import {
  canHover,
  font,
  fontSize,
  HIT_SLOP,
  hoverFill,
  MIN_TOUCH_SIZE,
  PRESS_SCALE_SMALL,
  radius,
  spacing,
  stroke,
  useColors,
  type Palette,
} from '@/theme';

import { PressableScale } from './motion';
import { Text } from './text';

/**
 * The six category hues, named so a tone can be one.
 *
 * `Tone` was five roles and a neutral, and a role answers "how important is
 * this". A list of six statistics screens, or six body parts, is not six levels
 * of importance, so every such list either drew in one colour or reached past
 * this type for a raw hex. These are the same six in `Palette['data']`, by
 * index, and they resolve through `toneColors` like everything else here.
 */
export const CATEGORY_TONES = [
  'category0',
  'category1',
  'category2',
  'category3',
  'category4',
  'category5',
] as const;

export type CategoryTone = (typeof CATEGORY_TONES)[number];

/** Role colours, plus the six categories, that a tinted surface can be built from. */
export type Tone =
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'
  | 'record'
  | 'neutral'
  | CategoryTone;

/** How far a control with no fill of its own fades under the thumb. */
const PRESSED_OPACITY = 0.6;

/**
 * The two hover fills this file needs, built once per palette.
 *
 * Every hoverable surface here rests on one of two colours: `surface` for
 * cards and the rows inside them, `surfaceMuted` for chips and filled icon
 * buttons, and both press to `surfacePressed`. So there are exactly two
 * blends, and computing them inside `ListRow` would repeat them per row of
 * every list in the app. Same shape as `makeStyles` in the theme, and cached on
 * the palette object for the same reason: there are two of those and they are
 * stable.
 */
const hoverCache = new Map<Palette, { onSurface: string; onMuted: string }>();

function hoverFills(c: Palette): { onSurface: string; onMuted: string } {
  let fills = hoverCache.get(c);
  if (!fills) {
    fills = {
      onSurface: hoverFill(c.surface, c.surfacePressed),
      onMuted: hoverFill(c.surfaceMuted, c.surfacePressed),
    };
    hoverCache.set(c, fills);
  }
  return fills;
}

/**
 * Maps a tone to its foreground and its tinted background.
 *
 * Chips, badges and callouts all read from here, so a "record" badge is the
 * same gold in the history list, the summary screen and the PR sheet. They
 * used to each pick their own pairing inline.
 */
function toneColors(c: Palette, tone: Tone): { fg: string; bg: string } {
  switch (tone) {
    case 'accent':
      return { fg: c.accent, bg: c.accentSurface };
    case 'success':
      return { fg: c.success, bg: c.successSurface };
    case 'warning':
      return { fg: c.warning, bg: c.warningSurface };
    case 'danger':
      return { fg: c.danger, bg: c.dangerSurface };
    case 'record':
      return { fg: c.record, bg: c.recordSurface };
    case 'neutral':
      return { fg: c.textSecondary, bg: c.surfaceMuted };
    default:
      /*
       * A category, drawn in ink.
       *
       * This is the one line that makes the app monochrome, so it is worth
       * being exact about what it gives up and why.
       *
       * Each of the six used to resolve to its own hue out of `Palette['data']`
       * over a tint derived from it at 0.16 alpha. That is a real key: it lets
       * someone learn once that back is the blue one and then read a sorted
       * chart without reading its labels. What it costs is that a screen
       * showing six categories shows six hues, and this app shows categories
       * on Home, on the workout summary, on four stats screens and down the
       * side of the statistics list, which is how a palette budgeted at
       * roughly one accent element per view ends up with twenty on screen at
       * once.
       *
       * Colour is now spent on *state* alone: the five roles above, which say
       * what something is doing rather than which of six things it is. A
       * category is told apart by the thing every one of these call sites
       * already draws beside it, which is its name. In a sorted chart the bar
       * length says the rest.
       *
       * The type is deliberately left standing rather than deleted. A call
       * site saying `tone="category3"` is still making a true statement about
       * its content, and keeping the six names means the decision lives in one
       * `return` that can be reversed in one edit, rather than being spread
       * back out over the fifteen places that used to read the ramp. The
       * palettes keep their `data` ramps too, for the same reason and because
       * `audit-palette.mjs` still measures them.
       */
      return { fg: c.textSecondary, bg: c.surfaceMuted };
  }
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export interface CardProps extends ViewProps {
  /** Adds internal padding. Disable when the card hosts its own list rows. */
  padded?: boolean;
  elevated?: boolean;
  /** Makes the whole card tappable, with a pressed surface. */
  onPress?: () => void;
}

export function Card({ padded = true, elevated = false, onPress, style, ...rest }: CardProps) {
  const colors = useColors();

  const surface = elevated ? colors.surfaceElevated : colors.surface;
  const base: ViewStyle = { backgroundColor: surface };

  // A tappable card gets a real pressed surface rather than a dimmed one. On
  // AMOLED a card is already close to the canvas, so dropping its opacity moves
  // it *towards* the background. The press reads as the card disappearing.
  //
  // The fill crossfades and the card takes a small step back under the thumb,
  // both on the UI thread. A card is a discrete object sitting on the canvas
  // with margin on every side, so it is exactly the shape that can afford to
  // scale: see `PRESS_SCALE`.
  if (onPress) {
    return (
      <PressableScale
        accessibilityRole="button"
        onPress={onPress}
        fill={surface}
        fillPressed={colors.surfacePressed}
        // An elevated card rests a step above a plain one, so blending from
        // `surface` would step it *down* on hover. Both press to the same place,
        // so the blend just has to start where the card actually sits.
        hoverFill={hoverFill(surface, colors.surfacePressed)}
        style={[styles.card, base, padded && styles.cardPadded, style]}
        {...(rest as Omit<PressableProps, 'style'>)}
      />
    );
  }

  return <View style={[styles.card, base, padded && styles.cardPadded, style]} {...rest} />;
}

// ---------------------------------------------------------------------------
// Divider
// ---------------------------------------------------------------------------

export function Divider({ inset = 0, style }: { inset?: number; style?: ViewStyle }) {
  const colors = useColors();
  return (
    <View style={[styles.divider, { backgroundColor: colors.border, marginLeft: inset }, style]} />
  );
}

// ---------------------------------------------------------------------------
// Chip
// ---------------------------------------------------------------------------

export interface ChipProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  selected?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
}

export function Chip({ label, selected = false, icon, ...rest }: ChipProps) {
  const colors = useColors();
  const fg = selected ? colors.accent : colors.textSecondary;

  // A selected chip is already carrying the accent, so it has nowhere quieter
  // to step to on press and holds its fill; an unselected one steps to the
  // pressed surface. Both scale, which is what keeps the two reading as one
  // control in two states rather than one live chip beside a dead one.
  const fill = selected ? colors.accentSurface : colors.surfaceMuted;
  const fillPressed = selected ? fill : colors.surfacePressed;

  // Unselected, the outline is the fill rather than `transparent`: the border
  // is always drawn, so the chip keeps one width, and a transparent stroke
  // around a pill leaves a seam where the border path meets the background
  // path. See `stroke` in the tokens. It follows the fill through the press
  // for the same reason: an outline left behind at the resting colour is a
  // ring around a pressed centre, which is that seam by another route.
  const border = selected ? colors.accent : fill;
  const borderPressed = selected ? border : fillPressed;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ selected }}
      fill={fill}
      fillPressed={fillPressed}
      // A selected chip holds its accent tint through hover for the same reason
      // it holds it through a press: it is already at the loud end and has
      // nowhere brighter to go without reading as a second selected state.
      hoverFill={selected ? fill : hoverFills(colors).onMuted}
      border={border}
      borderPressed={borderPressed}
      style={[styles.chip, { backgroundColor: fill, borderColor: border }]}
      {...rest}
    >
      {icon && <Ionicons name={icon} size={14} color={fg} />}
      <Text variant="label" style={{ color: fg }}>
        {label}
      </Text>
    </PressableScale>
  );
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

export interface BadgeProps {
  label: string;
  tone?: Tone;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: ViewStyle;
}

/** Small non-interactive marker: PR count, set type, sync status. */
export function Badge({ label, tone = 'neutral', icon, style }: BadgeProps) {
  const colors = useColors();
  const { fg, bg } = toneColors(colors, tone);

  return (
    <View style={[styles.badge, { backgroundColor: bg }, style]}>
      {icon && <Ionicons name={icon} size={11} color={fg} />}
      <Text variant="caption" style={[styles.badgeLabel, { color: fg }]}>
        {label}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// IconButton
// ---------------------------------------------------------------------------

export interface IconButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  name: keyof typeof Ionicons.glyphMap;
  size?: number;
  color?: string;
  /** Renders a circular filled background behind the glyph. */
  filled?: boolean;
  style?: ViewStyle;
}

export function IconButton({
  name,
  size = 22,
  color,
  filled = false,
  style,
  ...rest
}: IconButtonProps) {
  const colors = useColors();

  /*
   * An unfilled icon button grows a shape where there is a cursor to meet it.
   *
   * On a phone it has no background to darken, so it keeps the opacity dip and
   * nothing else. That is what the `dimTo` below is, and it is right for a
   * finger, which has already found the target by the time anything can respond.
   * A cursor has to find it first, and a bare 22pt glyph gives no indication
   * that it sits in a 44pt target: these are the smallest things in the app and
   * they carry real actions, including the destructive ones in the headers.
   *
   * So where hovering is possible it borrows the filled variant's shape:
   * nothing at rest, the muted surface under the cursor, the pressed surface
   * under the click. Gated on `canHover` rather than applied everywhere, so a
   * touch device cannot end up with a fill it has no way to reveal, and the
   * phone behaviour is left exactly as it was.
   */
  const revealsShape = canHover && !filled;

  return (
    <PressableScale
      accessibilityRole="button"
      hitSlop={HIT_SLOP}
      fill={filled ? colors.surfaceMuted : revealsShape ? 'transparent' : undefined}
      fillPressed={filled ? colors.surfacePressed : revealsShape ? colors.surfacePressed : undefined}
      hoverFill={filled ? hoverFills(colors).onMuted : colors.surfaceMuted}
      dimTo={filled ? 1 : PRESSED_OPACITY}
      // A deeper press than the shared scale. These are the smallest targets in
      // the app (a bare 22pt glyph in a 44pt circle) and 3% of that is a
      // couple of pixels, which is not a response anyone can see.
      scaleTo={PRESS_SCALE_SMALL}
      style={[styles.iconButton, filled && { backgroundColor: colors.surfaceMuted }, style]}
      {...rest}
    >
      <Ionicons name={name} size={size} color={color ?? colors.textSecondary} />
    </PressableScale>
  );
}

// ---------------------------------------------------------------------------
// StatBand
// ---------------------------------------------------------------------------

export interface StatFigure {
  label: string;
  value: string;
  /** Set apart from the figure: smaller, quieter, on the same baseline. */
  unit?: string;
  /** Renders in the accent. At most one per band; see the note below. */
  lead?: boolean;
}

export interface StatBandProps {
  items: StatFigure[];
  style?: ViewStyle;
}

/**
 * A row of figures, unruled and unboxed.
 *
 * This replaces a row of tiles: rounded card, tinted circle, icon, number,
 * grey caption, which is the single most generic component in mobile design
 * and read as such. Three of them side by side, each in a different role
 * colour, also broke the palette's own rule: lime, amber and green are all
 * near-maximum saturation on a black canvas, and using them decoratively for
 * "workouts / streak / volume" spends every emphasis the app has on three
 * numbers that are not emphatic. `lead` exists so a band can promote *one*
 * figure, which is what the accent is for.
 *
 * What is left is the data. Labels sit above their figures, tracked and
 * uppercase, the way a table heads its columns; the figures are tabular so
 * they align down the row; units are set small and quiet so "184.2k" reads as
 * the number and "kg" as its annotation. The first label aligns to the screen's
 * left margin, so the band sits on the same grid as every section header.
 *
 * The rules are gone: hairlines above, below and between every column. Three
 * figures set in columns, on a shared baseline, under uppercase labels already
 * read as a table; the rules boxed that table in and made a band of two stacked
 * ones read as a grid drawn in chrome. Anything that needs a band separated
 * from what follows it can place a `Divider`, which is a decision the screen
 * makes rather than one every band carries.
 */
export function StatBand({ items, style }: StatBandProps) {
  const colors = useColors();

  return (
    <View style={[styles.statBand, style]}>
      {items.map((item, index) => (
        <View key={item.label} style={[styles.statColumn, index > 0 && styles.statColumnInner]}>
          {/*
           * Two lines, not one. A third of a phone is not enough for "Week
           * streak" or "Last 3 months" set uppercase at this tracking, and a
           * clipped label ("WEEK STRE…") reads as a bug; on a device with the
           * system text size turned up even "Sessions" runs out of room. The
           * wrapper takes the slack so every figure in the row still sits on
           * one baseline however many lines the labels above them need.
           */}
          <View style={styles.statLabel}>
            <Text variant="overline" color="textTertiary" numberOfLines={2}>
              {item.label}
            </Text>
          </View>
          <Text
            numberOfLines={1}
            style={[styles.statValue, item.lead ? { color: colors.accent } : null]}
          >
            {item.value}
            {item.unit ? (
              <Text style={[styles.statUnit, { color: colors.textTertiary }]}>
                {` ${item.unit}`}
              </Text>
            ) : null}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Splits a formatted measurement into figure and unit. "184.2k kg" becomes
 * `['184.2k', 'kg']`, "142" stays `['142', undefined]`.
 *
 * The formatters in `@lift/shared` return display-ready strings with the unit
 * already attached, which is right for a sentence and wrong for a column: the
 * band needs the two set at different sizes. Splitting here keeps that a
 * presentation concern rather than forcing every formatter to grow a variant.
 */
export function splitMeasure(text: string): [string, string | undefined] {
  const match = /^(.*\d.*?)\s+([^\s\d]+)$/.exec(text);
  return match ? [match[1]!, match[2]!] : [text, undefined];
}

// ---------------------------------------------------------------------------
// ListRow
// ---------------------------------------------------------------------------

export interface ListRowProps {
  title: string;
  subtitle?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  image?: ImageSourcePropType;
  /** Tints the leading icon and its backing circle. */
  tone?: Tone;
  /** Replaces the trailing chevron. */
  accessory?: ReactNode;
  /** Hides the chevron without supplying an accessory. */
  showChevron?: boolean;
  onPress?: () => void;
  /**
   * Reaches whatever the accessory does.
   *
   * A row is one accessibility element, so a button rendered into `accessory`.
   * The routine list's Start, say. Is swallowed by the row that contains it
   * and cannot be reached at all. Naming it as a custom action gives it back:
   * the row announces its title, the rotor offers "Start", and the screen keeps
   * the one-element reading order that makes the list scannable.
   */
  accessibilityActions?: readonly AccessibilityActionInfo[];
  onAccessibilityAction?: (event: AccessibilityActionEvent) => void;
}

/**
 * The standard tappable row: optional leading icon, title over subtitle, and a
 * trailing chevron. Settings rows, recent workouts and routine entries were
 * three separate hand-rolled versions of this with three different paddings.
 *
 * The press highlight crossfades from `surface`, which assumes what every call
 * site in the app already does: rows live inside a plain `Card`. A row dropped
 * straight onto the canvas would crossfade from the wrong colour. Put it in a
 * card, which is also the only way its dividers and corners come out right.
 */
export function ListRow({
  title,
  subtitle,
  icon,
  image,
  tone = 'neutral',
  accessory,
  showChevron = true,
  onPress,
  accessibilityActions,
  onAccessibilityAction,
}: ListRowProps) {
  const colors = useColors();
  const { fg, bg } = toneColors(colors, tone);

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      disabled={!onPress}
      onPress={onPress}
      fill={colors.surface}
      fillPressed={onPress ? colors.surfacePressed : colors.surface}
      // A row that does nothing does not light up under the cursor either. This
      // is the one component in the app that is routinely rendered inert: a
      // settings row showing a value, a stat line inside a card, and on a phone
      // that reads correctly because nothing responds until it is touched. A
      // cursor asks the question earlier, and answering it on a row that cannot
      // be clicked is a worse lie than staying dark.
      hoverFill={onPress ? hoverFills(colors).onSurface : colors.surface}
      // No scale. A row runs the full width of its card, so shrinking it pulls
      // both edges off the margin at once and reads as the row lifting away
      // from the page rather than being pressed into it. See `PRESS_SCALE`.
      scaleTo={1}
      style={styles.listRow}
    >
      {(icon || image) && (
        <View
          style={[
            styles.listIcon,
            { backgroundColor: tone === 'neutral' ? colors.surfaceMuted : bg },
          ]}
        >
          {image ? (
            <Image source={image} style={{ width: 17, height: 17, resizeMode: 'contain' }} />
          ) : (
            <Ionicons name={icon!} size={17} color={fg} />
          )}
        </View>
      )}

      <View style={styles.listBody}>
        <Text variant="bodyMedium" numberOfLines={1}>
          {title}
        </Text>
        {subtitle && (
          <Text variant="caption" color="textTertiary" numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>

      {accessory ??
        (showChevron && onPress ? (
          <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
        ) : null)}
    </PressableScale>
  );
}

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------

export interface EmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description?: string;
  action?: ReactNode;
}

/**
 * The glyph used to sit in a 64px grey disc. The disc said nothing the icon did
 * not. It was there to give the icon a shape, and a grey circle floating above
 * centred text is the house style of every empty state ever auto-generated.
 * Naked and larger, at tertiary weight, it reads as a mark rather than a button
 * nobody can press.
 */
export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  const colors = useColors();

  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={38} color={colors.textTertiary} style={styles.emptyIcon} />
      <Text variant="subheading" align="center">
        {title}
      </Text>
      {description && (
        <Text variant="body" color="textSecondary" align="center" style={styles.emptyDescription}>
          {description}
        </Text>
      )}
      {action && <View style={styles.emptyAction}>{action}</View>}
    </View>
  );
}

// ---------------------------------------------------------------------------
// SectionHeader
// ---------------------------------------------------------------------------

/**
 * Pass `title` in sentence case: the `overline` variant uppercases it in CSS.
 * Passing "QUICK START" here would be uppercased twice, which is invisible in
 * Latin but mangles locales with real case rules.
 */
export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <Text variant="overline" color="textSecondary">
        {title}
      </Text>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    // No outline. The fill is the card: `surface` is a full step off the canvas
    // in both palettes (#0C0C0F on black, white on #F4F4F6), so the edge is
    // already legible and a stroke on top of it was drawing the same boundary
    // twice. A card that needs to be marked out: the PR card on the summary
    // screen. Asks for its own border in a role colour, which now reads as a
    // signal rather than as one card among many wearing a slightly louder edge.
    overflow: 'hidden',
  },
  cardPadded: { padding: spacing.lg },
  divider: { height: stroke.rule },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: stroke.outline,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
  },
  // Both halves of the weight, not a bare `fontWeight`. That alone would bold
  // the badge on iOS and leave it regular on Android, which is where the family
  // decides the weight.
  badgeLabel: font('semibold'),
  iconButton: {
    minWidth: MIN_TOUCH_SIZE,
    minHeight: MIN_TOUCH_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  statBand: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingVertical: spacing.md,
  },
  // Equal columns, with the first flush to the screen margin so the band sits
  // on the same grid as the section headers above and below it.
  // The gutter is `md` rather than `lg`: four pixels a side back is four
  // characters of label on a small phone, and this band is read down the
  // columns, which the labels themselves already separate.
  statColumn: { flex: 1, gap: spacing.xs, paddingRight: spacing.md },
  statColumnInner: { paddingLeft: spacing.md },
  // Takes the slack when one label wraps and its neighbours do not, which is
  // what keeps the figures on a shared baseline.
  statLabel: { flex: 1 },
  statValue: {
    // One size, whether the band holds two figures or four.
    //
    // It used to be 32px, stepping down to 24 once a third column arrived:
    // logic that existed because three six-digit volumes at 32 overflowed a
    // phone. At 17 the overflow case cannot arise, so the step-down goes with
    // it, and a band no longer changes type size depending on how many things
    // it happens to be reporting. This is a row that supports the sentence
    // above it, not the headline; `lead` is still there to promote one figure
    // when a band genuinely has a subject.
    fontSize: fontSize.lg,
    ...font('bold'),
    // A row of figures read across is the case this exists for: without it the
    // columns set to different widths as the numbers change.
    fontVariant: ['tabular-nums'],
    // Nearly spent at this size: see the tracking note above `VARIANTS` in
    // `ui/text.tsx`. It was -0.4 when the figures were twice as big.
    letterSpacing: -0.1,
  },
  statUnit: {
    fontSize: fontSize.xs,
    ...font('medium'),
    letterSpacing: 0,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 56,
  },
  listIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listBody: { flex: 1, gap: 2 },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.huge,
    paddingHorizontal: spacing.xxl,
    gap: spacing.md,
  },
  emptyIcon: { marginBottom: spacing.sm, opacity: 0.75 },
  emptyDescription: { maxWidth: 300 },
  emptyAction: { marginTop: spacing.sm },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
  },
});
