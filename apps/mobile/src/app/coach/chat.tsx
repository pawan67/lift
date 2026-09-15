import {
  buildCoachDocument,
  CHAT_ADDENDUM,
  COACH_BRIEF,
  estimateTokens,
  type AiMessage,
} from '@lift/shared';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { Button, Card, EmptyState, Screen, Text, TextField, useScrollEdge } from '@/components/ui';
import { requireAiConfig, streamCompletion } from '@/features/ai/client';
import { AiError } from '@/features/ai/errors';
import { appendMessage, createThread, readMessages } from '@/features/ai/threads';
import { buildCoachReport } from '@/features/coach/report';
import type { StatRange } from '@/features/analytics/windows';
import { spacing } from '@/theme';

/**
 * Room for the seven-heading opening answer, and for anything after it.
 *
 * The review is genuinely long: it is asked for a four-week plan week by week.
 * Cutting it off mid-programme is worse than not asking.
 */
const MAX_OUTPUT_TOKENS = 4096;

/**
 * The document only travels once.
 *
 * Every turn after the first is a question about an answer the model can still
 * see, so the thread carries the whole exchange and the log is never re-read.
 * Rebuilding it per turn would not merely cost tokens: the log moves, so a
 * follow-up would silently change the evidence underneath an answer that has
 * already been given.
 */
export default function CoachChatScreen() {
  const scrollEdge = useScrollEdge();
  const params = useLocalSearchParams<{
    /** An existing conversation to reopen. When set, nothing is re-read or re-asked. */
    thread?: string;
    range?: string;
    sessions?: string;
    routines?: string;
    note?: string;
  }>();

  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [streaming, setStreaming] = useState('');
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<AiError | null>(null);
  const [question, setQuestion] = useState('');

  const threadId = useRef<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  /**
   * What has streamed in so far, mirrored out of state.
   *
   * The stop path needs to read the partial answer and write it to the
   * database. Doing that from inside a `setStreaming` updater would work by
   * accident and break on purpose: React may invoke an updater more than once,
   * and an updater with an insert in it would then store the turn twice.
   */
  const partial = useRef('');
  const scroller = useRef<ScrollView | null>(null);
  const started = useRef(false);

  /**
   * Sends the conversation as it stands and streams the reply into it.
   *
   * Takes the turns explicitly rather than reading state, because the opening
   * request is issued in the same tick that puts the document into state and
   * would otherwise send an empty list.
   */
  const send = useCallback(async (turns: AiMessage[], cacheable: boolean) => {
    const controller = new AbortController();
    abort.current = controller;

    setPending(true);
    setError(null);
    setStreaming('');
    partial.current = '';

    let answer = '';

    try {
      const config = await requireAiConfig();

      answer = await streamCompletion(
        config,
        {
          system: `${COACH_BRIEF}\n\n${CHAT_ADDENDUM}`,
          messages: turns,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          // The first user turn is the training document and is re-sent with
          // every follow-up. Anthropic will hold on to it if asked, which is
          // most of what a second question costs.
          cacheFirstMessage: cacheable,
        },
        {
          onDelta: (text) => {
            partial.current += text;
            setStreaming((current) => current + text);
          },
          signal: controller.signal,
        },
      );

      const reply: AiMessage = { role: 'assistant', content: answer };
      setMessages([...turns, reply]);

      if (threadId.current) await appendMessage(threadId.current, reply);
    } catch (cause) {
      const failure = cause instanceof AiError ? cause : new AiError('bad-response');

      // A stop is not a failure, and what arrived before it is worth keeping:
      // the user pressed stop because they had read enough, not because the
      // answer was wrong.
      if (failure.kind === 'aborted') {
        const written = partial.current;
        if (written.length > 0) {
          const reply: AiMessage = { role: 'assistant', content: written };
          setMessages([...turns, reply]);
          if (threadId.current) await appendMessage(threadId.current, reply);
        }
      } else {
        setError(failure);
      }
    } finally {
      setStreaming('');
      partial.current = '';
      setPending(false);
      if (abort.current === controller) abort.current = null;
    }
  }, []);

  // The opening turn. Runs once, guarded by a ref rather than by the dependency
  // array: this spends money, and a re-run caused by a re-render would spend it
  // again without anybody asking.
  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void (async () => {
      try {
        // Reopening. The stored turns are the conversation, and re-reading the
        // log to rebuild the document would be both a wasted request and a lie:
        // the training has moved since the answer was written, and an answer
        // must keep the evidence it was actually given.
        if (params.thread) {
          threadId.current = params.thread;
          setMessages(await readMessages(params.thread));
          setPending(false);
          return;
        }

        const report = await buildCoachReport({
          range: (params.range as StatRange) ?? '30d',
          includeSessions: params.sessions !== '0',
          includeRoutines: params.routines !== '0',
          note: params.note?.trim() || null,
        });

        const document = buildCoachDocument(report);
        const opening: AiMessage[] = [{ role: 'user', content: document }];
        setMessages(opening);

        const config = await requireAiConfig();
        threadId.current = await createThread({
          kind: 'review',
          title: report.rangeLabel,
          model: config.model,
        });
        await appendMessage(threadId.current, opening[0]);

        await send(opening, true);
      } catch (cause) {
        setError(cause instanceof AiError ? cause : new AiError('bad-response'));
        setPending(false);
      }
    })();

    return () => {
      // Leaving the screen stops the stream rather than paying for an answer
      // into a screen that is gone.
      abort.current?.abort();
    };
  }, [params.thread, params.range, params.sessions, params.routines, params.note, send]);

  const ask = useCallback(() => {
    const text = question.trim();
    if (text.length === 0 || pending) return;

    const turns: AiMessage[] = [...messages, { role: 'user', content: text }];
    setQuestion('');
    setMessages(turns);

    if (threadId.current) void appendMessage(threadId.current, turns[turns.length - 1]);
    void send(turns, true);
  }, [question, pending, messages, send]);

  // The document is the first turn and is tens of thousands of characters. It is
  // not shown: nobody wants to read their own log back, and the screen it was
  // built on already offers a preview of it.
  const conversation = messages.slice(1);

  return (
    <Screen width="form" scrolled={scrollEdge.progress}>
      <Stack.Screen options={{ title: 'Coach' }} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          {...scrollEdge.list}
          ref={scroller}
          contentContainerStyle={styles.content}
          onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
        >
          {messages.length > 0 && (
            <Text variant="caption" color="textTertiary">
              Your log went out as one message of roughly{' '}
              {estimateTokens(messages[0].content).toLocaleString()} tokens. Follow-up questions
              re-use it rather than re-reading your training.
            </Text>
          )}

          {conversation.map((message, index) => (
            <Turn key={index} message={message} />
          ))}

          {streaming.length > 0 && <Turn message={{ role: 'assistant', content: streaming }} />}

          {pending && streaming.length === 0 && (
            <Text variant="body" color="textTertiary">
              Reading your training…
            </Text>
          )}

          {error && (
            <EmptyState
              icon="cloud-offline-outline"
              title="No answer"
              description={[error.message, error.detail].filter(Boolean).join('\n\n')}
            />
          )}
        </ScrollView>

        <View style={styles.composer}>
          {pending ? (
            <Button
              title="Stop"
              icon="stop-circle-outline"
              variant="secondary"
              fullWidth
              onPress={() => abort.current?.abort()}
            />
          ) : (
            <>
              <TextField
                multiline
                value={question}
                onChangeText={setQuestion}
                placeholder="Ask a follow-up"
                style={styles.input}
                containerStyle={styles.inputContainer}
              />
              <Button
                title="Send"
                icon="arrow-up"
                disabled={question.trim().length === 0 || messages.length === 0}
                onPress={ask}
              />
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

/**
 * One turn.
 *
 * A question sits in a card and an answer sits on the page, rather than both
 * being bubbles. The answers here are long, and a thousand words inside a
 * rounded rectangle is harder to read than the same words on the background;
 * the questions are one line and need the edge to be findable when scrolling
 * back through an answer to find what was asked.
 */
function Turn({ message }: { message: AiMessage }) {
  if (message.role === 'user') {
    return (
      <Card style={styles.question}>
        <Text variant="body">{message.content}</Text>
      </Card>
    );
  }

  // Pinned against Fabric's view flattening: layout-only, and its child grows
  // on every streamed token.
  return (
    <View collapsable={false} style={styles.answer}>
      <Text variant="body">{message.content}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.lg },
  question: { gap: spacing.sm },
  answer: { gap: spacing.sm },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    padding: spacing.lg,
    paddingTop: spacing.sm,
  },
  inputContainer: { flex: 1 },
  input: { maxHeight: 120, textAlignVertical: 'top' },
});
