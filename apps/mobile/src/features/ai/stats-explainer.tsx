/**
 * "What does this mean?" under a chart.
 *
 * The screens each compute something different, so this takes the figures
 * already on screen rather than reading the database itself. That is the point:
 * a reading of a chart has to be a reading of *that* chart, and a component that
 * went off and ran its own query could confidently explain a different window
 * than the one the user is looking at.
 *
 * `figures` is therefore a function returning the same numbers the screen just
 * rendered, written out as text. Nothing here calculates anything.
 */

import { STATS_BRIEF } from '@lift/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Text } from '@/components/ui';
import { loadAiConfig, requireAiConfig, streamCompletion } from './client';
import { AiError } from './errors';
import { spacing } from '@/theme';

/** At most four sentences plus a recommendation. The brief sets the shape. */
const MAX_OUTPUT_TOKENS = 400;

export interface StatsExplainerProps {
  /** What the screen is showing, in a few words. Becomes the first line sent. */
  subject: string;
  /**
   * The figures on screen, serialised.
   *
   * A function rather than a string so nothing is built until somebody asks,
   * and so it always reflects the range currently selected rather than the one
   * that was selected when the component mounted. Returning null means there is
   * nothing on screen worth explaining yet.
   */
  figures: () => string | null;
}

export function StatsExplainer({ subject, figures }: StatsExplainerProps) {
  const [answer, setAnswer] = useState<string | null>(null);
  const [configured, setConfigured] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AiError | null>(null);

  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    let live = true;
    void loadAiConfig().then((config) => {
      if (live) setConfigured(config !== null);
    });
    return () => {
      live = false;
      abort.current?.abort();
    };
  }, []);

  const ask = useCallback(() => {
    const document = figures();
    if (!document || pending) return;

    const controller = new AbortController();
    abort.current = controller;

    setPending(true);
    setError(null);
    setAnswer('');

    void (async () => {
      try {
        const config = await requireAiConfig();

        await streamCompletion(
          config,
          {
            system: STATS_BRIEF,
            messages: [
              {
                role: 'user',
                content: `${subject}\n\n${document}\n\nThese figures are measured. Do not recalculate them.`,
              },
            ],
            maxOutputTokens: MAX_OUTPUT_TOKENS,
          },
          {
            onDelta: (text) => setAnswer((current) => (current ?? '') + text),
            signal: controller.signal,
          },
        );
      } catch (cause) {
        const failure = cause instanceof AiError ? cause : new AiError('bad-response');
        if (failure.kind !== 'aborted') {
          setError(failure);
          setAnswer(null);
        }
      } finally {
        setPending(false);
        if (abort.current === controller) abort.current = null;
      }
    })();
  }, [figures, pending, subject]);

  // No key, no row. The chart above it is the feature; this is an addition to it
  // and has nothing to say about itself when it cannot run.
  if (!configured) return null;

  return (
    <Card style={styles.card}>
      {answer || pending ? (
        <>
          <Text variant="overline" color="textSecondary">
            Written by your model
          </Text>
          <Text variant="body" color={answer ? 'text' : 'textTertiary'}>
            {answer || 'Reading the figures…'}
          </Text>
        </>
      ) : error ? (
        <Text variant="body" color="danger">
          {error.message}
        </Text>
      ) : null}

      {!pending && (
        <View style={styles.action}>
          <Button
            title={answer ? 'Ask again' : error ? 'Try again' : 'What does this mean?'}
            icon="help-circle-outline"
            variant="secondary"
            onPress={ask}
          />
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  action: { alignItems: 'flex-start' },
});
