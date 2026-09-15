/**
 * "Side delts got 4 sets a week. The minimum that grows anything is 10."
 *
 * The whole card is arithmetic. It renders offline, with no key, with the AI
 * coach switched off, and every number on it comes from `findVolumeGaps` rather
 * than from a model. That is deliberate and it is the reason this file has no
 * import from `client.ts`: the app already knew a muscle was short, it just
 * drew it as a colour on a body map and never said it in words.
 *
 * The prescription underneath, when there is one, is the only part a model
 * wrote, and it is labelled as such.
 */

import { MUSCLE_GROUP_LABELS, VOLUME_ZONE_LABELS, type VolumeGap } from '@lift/shared';
import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Badge, Card, Text } from '@/components/ui';
import { formatSets } from '@/features/analytics/format';
import { spacing, useColors } from '@/theme';

export interface VolumeAdviceCardProps {
  gaps: readonly VolumeGap[];
  /** How many rows to draw. The home card shows a few; the stats screen shows all. */
  limit?: number;
  /** The model's prescription, when one has been asked for and arrived. */
  prescription?: string;
  /** Streaming, or waiting on the first token. */
  pending?: boolean;
  footer?: ReactNode;
}

export function VolumeAdviceCard({
  gaps,
  limit,
  prescription,
  pending = false,
  footer,
}: VolumeAdviceCardProps) {
  const colors = useColors();
  const shown = limit === undefined ? gaps : gaps.slice(0, limit);
  const hidden = gaps.length - shown.length;

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Text variant="overline" color="textSecondary">
          Weekly volume
        </Text>
        <Text variant="caption" color="textTertiary">
          Last 4 weeks
        </Text>
      </View>

      {shown.map((gap) => (
        <GapRow key={gap.muscle} gap={gap} />
      ))}

      {hidden > 0 && (
        <Text variant="caption" color="textTertiary">
          {hidden === 1 ? '1 more muscle is outside its range.' : `${hidden} more muscles are outside their range.`}
        </Text>
      )}

      {(prescription || pending) && (
        <View style={[styles.prescription, { borderTopColor: colors.border }]}>
          {/*
           * Labelled, every time, and not as a disclaimer.
           *
           * Everything above this line is measured and the app stands behind it.
           * Everything below was written by a model and might name an exercise
           * that does not suit somebody's shoulder. Those are different kinds of
           * claim and the card should not let them read as one.
           */}
          <Text variant="overline" color="textTertiary">
            Suggested by your model
          </Text>
          <Text variant="body" color={prescription ? 'text' : 'textTertiary'}>
            {prescription || 'Reading your routines…'}
          </Text>
        </View>
      )}

      {footer}
    </Card>
  );
}

/**
 * One muscle.
 *
 * The rate leads because it is the measurement; the target follows because it is
 * the context. Reversing them turns a fact into a scolding, and the same figures
 * have to sit on the home screen without being unpleasant to walk past.
 */
function GapRow({ gap }: { gap: VolumeGap }) {
  const colors = useColors();
  const short = gap.shortfall > 0;

  return (
    <View style={styles.row}>
      {/*
       * Pinned against Fabric's view flattening: this View carries only layout
       * and a conditional child, which is exactly the shape that has closed the
       * Android release build here before.
       */}
      <View collapsable={false} style={styles.rowText}>
        <Text variant="bodyMedium">{MUSCLE_GROUP_LABELS[gap.muscle]}</Text>
        <Text variant="caption" color="textTertiary">
          {short
            ? `${formatSets(gap.setsPerWeek)} of ${gap.landmarks.mev} sets a week`
            : `${formatSets(gap.setsPerWeek)} sets a week, ${gap.excess} past ${gap.landmarks.mrv}`}
        </Text>
      </View>

      <View style={styles.rowTrailing}>
        <Text
          variant="numeric"
          style={{ color: short ? colors.warning : colors.danger }}
        >
          {short ? `+${gap.shortfall}` : `-${gap.excess}`}
        </Text>
        <Badge label={VOLUME_ZONE_LABELS[gap.zone]} tone={short ? 'warning' : 'danger'} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowText: { flex: 1, gap: 2 },
  rowTrailing: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  prescription: { gap: spacing.xs, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
});
