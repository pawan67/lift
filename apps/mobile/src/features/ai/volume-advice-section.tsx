/**
 * The volume advisor as a screen drops it in: the card, plus the one button
 * that turns the figures into a prescription.
 *
 * Split from `VolumeAdviceCard` because the card is a pure render of numbers it
 * is handed, and everything that makes this awkward lives out here: whether
 * there is enough logged to say anything, whether a key is configured, and what
 * to show when the request fails. A screen importing this gets the whole
 * behaviour and one element.
 */

import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Text } from '@/components/ui';
import { loadAiConfig } from './client';
import { useVolumeAdvice } from './use-volume-advice';
import { VolumeAdviceCard } from './volume-advice-card';
import { spacing } from '@/theme';

export interface VolumeAdviceSectionProps {
  /** Rows to draw. Unset shows every gap; the home dashboard passes a few. */
  limit?: number;
  /**
   * Offer the model's prescription at all.
   *
   * Off on the home dashboard: that screen is walked past, not read, and a
   * button that spends money does not belong on it.
   */
  offerPrescription?: boolean;
  style?: object;
}

export function VolumeAdviceSection({
  limit,
  offerPrescription = true,
  style,
}: VolumeAdviceSectionProps) {
  const { ready, gaps, prescription, pending, error, ask } = useVolumeAdvice();
  const [configured, setConfigured] = useState(false);

  // Whether a key exists is a keychain read, so it cannot be answered during
  // render. Re-checked when the gaps arrive rather than once on mount, which is
  // the cheapest hook onto "the user may have just been to settings".
  useEffect(() => {
    let live = true;
    void loadAiConfig().then((config) => {
      if (live) setConfigured(config !== null);
    });
    return () => {
      live = false;
    };
  }, [ready]);

  const onAsk = useCallback(() => ask(), [ask]);

  // Nothing to say, or nothing to say it about. Both render as absence: this
  // sits between two cards that are always there, and an empty state here would
  // be a paragraph explaining that everything is fine.
  if (!ready || gaps.length === 0) return null;

  return (
    <View style={[styles.section, style]}>
      <VolumeAdviceCard
        gaps={gaps}
        limit={limit}
        prescription={prescription ?? undefined}
        pending={pending}
        footer={
          offerPrescription && configured ? (
            <View style={styles.footer}>
              <Button
                title={prescription ? 'Ask again' : 'What should I change?'}
                variant="secondary"
                disabled={pending}
                onPress={onAsk}
              />
              {error && (
                <Text variant="caption" color="danger">
                  {error.message}
                </Text>
              )}
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingTop: spacing.lg },
  footer: { gap: spacing.sm },
});
