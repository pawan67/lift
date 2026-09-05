import {
  DEFAULT_TRAINING_LEVEL,
  landmarksFor,
  MUSCLE_GROUP_LABELS,
  type MuscleGroup,
  type TrainingLevel,
  type VolumeLandmarks,
} from '@lift/shared';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Text } from '@/components/ui';
import { formatSets } from '@/features/analytics/format';
import { volumeColor } from '@/features/analytics/volume-landmarks';
import { spacing, useColors } from '@/theme';
import { mix } from '@/theme/color';

import {
  BACK_PATHS,
  BODY_VIEW_HEIGHT,
  BODY_VIEW_WIDTH,
  FRONT_PATHS,
  type BodyMapPaths,
} from './body-map-paths';

const ASPECT = BODY_VIEW_HEIGHT / BODY_VIEW_WIDTH;

/**
 * Muscles the figures have no shape for, drawn onto the nearest region instead.
 *
 * The art has no upper-back or abductor outline of its own, and leaving those
 * regions cold would read as "you never trained your back" to anyone doing rows.
 * Their sets are added to the region that physically overlaps them, so the
 * colour reflects everything that worked that area.
 */
const REGION_ALIASES: Partial<Record<MuscleGroup, MuscleGroup>> = {
  upper_back: 'lats',
  abductors: 'glutes',
};

/**
 * Every muscle a drawn region stands for, the alias table read backwards.
 *
 * Selecting a region has to select everything it covers, or tapping the upper
 * back would filter to lats and quietly drop every row press: the exact
 * exercises the tap was reaching for.
 */
export const REGION_MUSCLES: Partial<Record<MuscleGroup, MuscleGroup[]>> = (() => {
  const out: Partial<Record<MuscleGroup, MuscleGroup[]>> = {};
  for (const [muscle, region] of Object.entries(REGION_ALIASES) as [MuscleGroup, MuscleGroup][]) {
    (out[region] ??= [region]).push(muscle);
  }
  return out;
})();

/** The muscles a tap on `region` covers, including the region's own. */
export function musclesInRegion(region: MuscleGroup): MuscleGroup[] {
  return REGION_MUSCLES[region] ?? [region];
}

/** Muscles with no place on either figure: they still appear in the list. */
export const UNMAPPED_MUSCLES: readonly MuscleGroup[] = ['cardio', 'full_body', 'other'];

export interface BodyMapProps {
  /** Weekly working sets per muscle. Anything missing renders untrained. */
  setsPerWeek: Partial<Record<MuscleGroup, number>>;
  /** Total width for both figures, including the gap between them. */
  width: number;
  /**
   * Ceiling on figure height. Half a phone's width at this aspect ratio is
   * ~345pt per figure, which pushes the breakdown list off screen entirely;
   * the figures narrow rather than stretch.
   */
  maxHeight?: number;
  /** Which set of landmarks each muscle is held to. */
  level?: TrainingLevel;
  selected?: MuscleGroup | null;
  onSelect?: (muscle: MuscleGroup | null) => void;
}

/**
 * Front and back muscle heatmap over anatomical outlines.
 *
 * Colour is absolute, not relative: it comes from where a muscle's weekly sets
 * fall against that muscle's own volume landmarks, so an undertrained muscle
 * stays dim even when it is the most-trained thing you did that month, and an
 * overreached one leaves the accent hue entirely rather than just getting
 * brighter. Per muscle rather than one scale for the whole figure: 20 weekly
 * sets is a growing week for shoulders and past what triceps recover from, and
 * one ramp for both paints one of them wrong every week.
 */
export function BodyMap({
  setsPerWeek,
  width,
  maxHeight = 300,
  level = DEFAULT_TRAINING_LEVEL,
  selected = null,
  onSelect,
}: BodyMapProps) {
  const colors = useColors();

  // Resolved once for both figures so the two sides cannot disagree about what
  // an aliased muscle contributes.
  const regionSets = resolveRegions(setsPerWeek);
  // Selecting an aliased muscle lights up the region standing in for it.
  const selectedRegion = selected ? (REGION_ALIASES[selected] ?? selected) : null;

  return (
    <Figures
      width={width}
      maxHeight={maxHeight}
      // A selected muscle keeps its heat colour and gains an outline.
      // Repainting it would hide the one value the tap was asking about.
      fillFor={(muscle) =>
        volumeColor(regionSets[muscle] ?? 0, colors, regionLandmarks(muscle, level))
      }
      isSelected={(muscle) => selectedRegion === muscle}
      label={(muscle) =>
        `${MUSCLE_GROUP_LABELS[muscle]}, ${formatSets(regionSets[muscle] ?? 0)} sets per week`
      }
      onPress={
        onSelect ? (muscle) => onSelect(selectedRegion === muscle ? null : muscle) : undefined
      }
    />
  );
}

/**
 * The lightest a region gets while still counting as trained.
 *
 * A muscle that took one set out of forty is a real answer to "did I touch my
 * calves today", and a pure share ramp would draw it at 2.5% of the accent:
 * indistinguishable from the untrained grey beside it. The ramp therefore
 * starts here and spends the rest of its range on the differences that are
 * actually being compared.
 */
const SESSION_FLOOR = 0.3;

export interface SessionBodyMapProps {
  /** Weighted working sets per muscle, for this session alone. */
  sets: Partial<Record<MuscleGroup, number>>;
  width: number;
  maxHeight?: number;
}

/**
 * The same two figures, reporting on one session rather than on a training
 * week.
 *
 * Colour here is **relative**, which is the one place this app departs from the
 * absolute ramp `BodyMap` uses, and it is deliberate. Volume landmarks are
 * weekly quantities: MEV for chest is roughly ten sets a week, so a hard push
 * day of eight would paint the chest below its minimum effective volume and
 * read as "you barely trained this", which is the opposite of what happened.
 * A single session has no landmark to be measured against; the only honest
 * question it can answer is *where the work went*, and that is a share.
 *
 * So there is no legend and no ramp key: the figures say which regions this
 * session leaned on and roughly how hard, and the list beneath them carries the
 * numbers. Nothing here is claiming a muscle is under- or over-trained.
 */
export function SessionBodyMap({ sets, width, maxHeight = 240 }: SessionBodyMapProps) {
  const colors = useColors();

  const regionSets = resolveRegions(sets);
  const peak = Math.max(0, ...Object.values(regionSets));

  return (
    <Figures
      width={width}
      maxHeight={maxHeight}
      fillFor={(region) => {
        const value = regionSets[region] ?? 0;
        if (value <= 0 || peak <= 0) return colors.surfaceMuted;
        // Ramped toward the ink rather than toward the accent. One session's
        // map is a single quantity shaded by how much of it landed where,
        // which is the sequential case, and it now runs the same muted-to-ink
        // scale the training-days grid does.
        return mix(
          colors.surfaceMuted,
          colors.text,
          SESSION_FLOOR + (1 - SESSION_FLOOR) * (value / peak),
        );
      }}
      // Nothing on this map is selectable: it is a readout, and an outline
      // would promise a tap that does nothing.
      isSelected={() => false}
      label={(region) =>
        `${MUSCLE_GROUP_LABELS[region]}, ${formatSets(regionSets[region] ?? 0)} sets`
      }
    />
  );
}

export interface MuscleSelectMapProps {
  /** Every selected muscle, including ones drawn as part of another region. */
  selected: ReadonlySet<MuscleGroup>;
  /** Hands back every muscle the tapped region covers. */
  onToggle: (muscles: MuscleGroup[]) => void;
  width: number;
  maxHeight?: number;
}

/**
 * The same two figures, used to *choose* muscles rather than to report on them.
 *
 * The filter this replaced was an alphabetical list of 21 muscle names, which
 * asks the reader to translate "the front of my shoulder" into "Shoulders" and
 * to know that lats and upper back are different rows. Pointing at the body is
 * how anyone actually holds the question, and the map is already drawn.
 */
export function MuscleSelectMap({
  selected,
  onToggle,
  width,
  maxHeight = 320,
}: MuscleSelectMapProps) {
  const colors = useColors();

  // A region counts as on when any muscle it covers is: tapping the upper back
  // selects lats *and* upper_back, and both have to keep the region lit.
  const isSelected = (region: MuscleGroup) =>
    musclesInRegion(region).some((muscle) => selected.has(muscle));

  return (
    <Figures
      width={width}
      maxHeight={maxHeight}
      // Flat accent rather than a ramp: nothing here is a measurement, so the
      // only thing colour has to say is on or off.
      fillFor={(region) => (isSelected(region) ? colors.accent : colors.surfaceMuted)}
      isSelected={isSelected}
      // Selection is spelled into the label because a `Path` takes only
      // `accessible` and `accessibilityLabel`. There is no `accessibilityState`
      // on an SVG node to carry it.
      label={(region) =>
        [
          musclesInRegion(region)
            .map((muscle) => MUSCLE_GROUP_LABELS[muscle])
            .join(' and '),
          isSelected(region) ? 'selected' : null,
        ]
          .filter(Boolean)
          .join(', ')
      }
      onPress={(region) => onToggle(musclesInRegion(region))}
    />
  );
}

/**
 * The landmarks a drawn region is judged against: its own, plus every muscle it
 * stands in for.
 *
 * Summed, because `resolveRegions` sums their sets. The lats shape carries the
 * upper back's rows as well, and holding a two-muscle total to one muscle's
 * ceiling would paint half the back overreached for anyone who trains it
 * properly. For the fifteen regions that alias nothing this is just that
 * muscle's row.
 */
function regionLandmarks(region: MuscleGroup, level: TrainingLevel): VolumeLandmarks {
  const muscles = musclesInRegion(region);
  if (muscles.length === 1) return landmarksFor(region, level);

  return muscles.reduce<VolumeLandmarks>(
    (total, muscle) => {
      const row = landmarksFor(muscle, level);
      return {
        mv: total.mv + row.mv,
        mev: total.mev + row.mev,
        mav: total.mav + row.mav,
        mrv: total.mrv + row.mrv,
      };
    },
    { mv: 0, mev: 0, mav: 0, mrv: 0 },
  );
}

/** Folds aliased muscles into the region that stands in for them. */
function resolveRegions(
  setsPerWeek: Partial<Record<MuscleGroup, number>>,
): Partial<Record<MuscleGroup, number>> {
  const out: Partial<Record<MuscleGroup, number>> = {};
  for (const [muscle, sets] of Object.entries(setsPerWeek) as [MuscleGroup, number][]) {
    if (!sets) continue;
    const region = REGION_ALIASES[muscle] ?? muscle;
    out[region] = (out[region] ?? 0) + sets;
  }
  return out;
}

interface FiguresProps {
  width: number;
  maxHeight: number;
  fillFor: (region: MuscleGroup) => string;
  isSelected: (region: MuscleGroup) => boolean;
  label: (region: MuscleGroup) => string;
  onPress?: (region: MuscleGroup) => void;
}

/**
 * The pair of figures, with everything the caller decides passed in.
 *
 * Shared rather than duplicated because the two callers differ only in what a
 * region's colour *means*. A second copy of this would be a second place for
 * the alias table and the aspect-ratio maths to drift.
 */
function Figures({ width, maxHeight, ...figure }: FiguresProps) {
  const height = Math.min(((width - spacing.md) / 2) * ASPECT, maxHeight);

  return (
    <View style={styles.row}>
      <Figure title="Front" paths={FRONT_PATHS} width={height / ASPECT} height={height} {...figure} />
      <Figure title="Back" paths={BACK_PATHS} width={height / ASPECT} height={height} {...figure} />
    </View>
  );
}

function Figure({
  title,
  paths,
  width,
  height,
  fillFor,
  isSelected,
  label,
  onPress,
}: Omit<FiguresProps, 'width' | 'maxHeight'> & {
  title: string;
  paths: BodyMapPaths;
  width: number;
  height: number;
}) {
  const colors = useColors();

  return (
    <View style={styles.figure}>
      <Svg width={width} height={height} viewBox={`0 0 ${BODY_VIEW_WIDTH} ${BODY_VIEW_HEIGHT}`}>
        {(Object.entries(paths) as [MuscleGroup, string[]][]).map(([muscle, ds]) => {
          const selected = isSelected(muscle);
          const fill = fillFor(muscle);

          return ds.map((d, index) => (
            <Path
              key={`${muscle}-${index}`}
              d={d}
              fill={fill}
              stroke={selected ? colors.text : colors.border}
              strokeWidth={selected ? 4 : 1}
              // Only the first shape of a region is announced, so a muscle
              // drawn as two mirrored halves reads once rather than twice.
              accessible={index === 0 && onPress !== undefined}
              accessibilityLabel={label(muscle)}
              onPress={onPress ? () => onPress(muscle) : undefined}
            />
          ));
        })}
      </Svg>

      <Text variant="caption" color="textTertiary">
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md, justifyContent: 'center' },
  figure: { alignItems: 'center', gap: spacing.xs },
});
