/**
 * A few sentences on the workout that just finished.
 *
 * Three rules shape it, and all three come from where it sits. This screen is
 * read once, standing in a gym, immediately after the thing it describes:
 *
 * - **It never blocks.** The totals, records and body map above are already
 *   drawn from the database and owe nothing to this. The card appears under
 *   them and fills itself in.
 * - **It is asked for, unless it was asked for once and for all.** Generating
 *   costs money on somebody else's account, so the default is a button. The
 *   `aiAutoSummary` setting is how a user says "always".
 * - **It is written once.** The answer is stored against the workout id, so
 *   reopening a session from last Tuesday reads what was written then rather
 *   than paying for a second opinion on the same sets.
 */

import { SESSION_BRIEF } from '@lift/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Text } from '@/components/ui';
import { loadAiConfig, requireAiConfig, streamCompletion } from './client';
import { AiError } from './errors';
import { buildSessionDocument } from './session-summary';
import { appendMessage, createThread, findThreadFor, readMessages } from './threads';
import { useSettings } from '@/store/settings';
import { spacing } from '@/theme';

/** Three or four sentences. The brief says so; this stops a model disagreeing. */
const MAX_OUTPUT_TOKENS = 400;

export function SessionSummaryCard({ workoutId }: { workoutId: string }) {
  const enabled = useSettings((state) => state.aiEnabled);
  const auto = useSettings((state) => state.aiAutoSummary);

  const [summary, setSummary] = useState<string | null>(null);
  const [configured, setConfigured] = useState(false);
  /**
   * The session had no completed working sets, so there is nothing to say.
   *
   * Tracked rather than left as "no summary yet", because those two states look
   * identical and behave differently: without it the card keeps offering a
   * button that has already decided it has nothing to do, and pressing it does
   * nothing at all.
   */
  const [nothingToSay, setNothingToSay] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AiError | null>(null);

  const abort = useRef<AbortController | null>(null);
  const asked = useRef(false);

  const generate = useCallback(async () => {
    if (asked.current) return;
    asked.current = true;

    const controller = new AbortController();
    abort.current = controller;

    setPending(true);
    setError(null);
    setSummary('');

    try {
      const config = await requireAiConfig();

      const document = await buildSessionDocument(workoutId);
      // A session with no completed working sets: opened and abandoned. Nothing
      // worth spending a request to observe.
      if (!document) {
        setSummary(null);
        setNothingToSay(true);
        return;
      }

      const answer = await streamCompletion(
        config,
        {
          system: SESSION_BRIEF,
          messages: [{ role: 'user', content: document }],
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        },
        {
          onDelta: (text) => setSummary((current) => (current ?? '') + text),
          signal: controller.signal,
        },
      );

      // Written only once it is whole. A stored half-sentence would be served
      // as the final answer on every later visit, and there is no way from
      // here to tell a truncated answer from a short one.
      if (answer.trim().length > 0) {
        const threadId = await createThread({
          kind: 'session',
          title: 'Session summary',
          subjectId: workoutId,
          model: config.model,
        });
        await appendMessage(threadId, { role: 'assistant', content: answer });
      }
    } catch (cause) {
      const failure = cause instanceof AiError ? cause : new AiError('bad-response');
      setSummary(null);
      if (failure.kind !== 'aborted') {
        setError(failure);
        // A failure is worth retrying by hand: the common ones here are a rate
        // limit and a dropped connection, neither of which is permanent.
        asked.current = false;
      }
    } finally {
      setPending(false);
      if (abort.current === controller) abort.current = null;
    }
  }, [workoutId]);

  useEffect(() => {
    let live = true;

    void (async () => {
      // The stored answer first, always, and before anything checks whether a
      // key exists. A summary written last week must still be readable by
      // somebody who has since turned the whole feature off.
      const existing = await findThreadFor('session', workoutId).catch(() => null);
      if (existing) {
        const turns = await readMessages(existing.id).catch(() => []);
        const written = turns.find((turn) => turn.role === 'assistant');
        if (live && written) {
          asked.current = true;
          setSummary(written.content);
          return;
        }
      }

      const config = await loadAiConfig();
      if (!live) return;
      setConfigured(config !== null);

      if (config && auto) void generate();
    })();

    return () => {
      live = false;
      abort.current?.abort();
    };
  }, [workoutId, auto, generate]);

  // Nothing to show and no way to make anything: the card is absent rather than
  // an advertisement for a setting, or a button that has already established it
  // has nothing to do.
  if (nothingToSay) return null;
  if (!summary && !pending && !error && (!enabled || !configured)) return null;

  return (
    <Card style={styles.card}>
      <Text variant="overline" color="textSecondary">
        Written by your model
      </Text>

      {summary ? (
        <Text variant="body">{summary}</Text>
      ) : pending ? (
        <Text variant="body" color="textTertiary">
          Reading the session…
        </Text>
      ) : error ? (
        <Text variant="body" color="danger">
          {error.message}
        </Text>
      ) : (
        <Text variant="body" color="textSecondary">
          A few sentences on what moved, what stalled, and what this session did to the week.
        </Text>
      )}

      {!summary && !pending && (
        <View style={styles.action}>
          <Button
            title={error ? 'Try again' : 'Read it'}
            icon="sparkles-outline"
            variant="secondary"
            onPress={() => void generate()}
          />
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  action: { alignItems: 'flex-start', paddingTop: spacing.xs },
});
