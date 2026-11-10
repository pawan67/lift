import { Ionicons } from '@expo/vector-icons';
import {
  buildCoachDocument,
  carriesCoachLog,
  COACH_STARTERS,
  COACH_TOOLS,
  coachChatBrief,
  coachTurnText,
  isSmallTalk,
  parseCoachReply,
  withCoachLog,
  type AiConfig,
  type AiMessage,
  type AiToolResult,
} from '@lift/shared';
import { LinearGradient } from 'expo-linear-gradient';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import {
  ScrollView,
  Share,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type TextInput,
} from 'react-native';
import Animated, { FadeOut, ReduceMotion, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Button,
  Card,
  Chip,
  HeaderAction,
  popIn,
  PressableScale,
  Reveal,
  Screen,
  Text,
  useScrollEdge,
} from '@/components/ui';
import { loadAiConfig, requireAiConfig, streamTurn, type StreamedTurn } from '@/features/ai/client';
import { AiError } from '@/features/ai/errors';
import {
  appendMessage,
  createThread,
  deleteMessagesFrom,
  readMessages,
  renameThread,
} from '@/features/ai/threads';
import { STAT_RANGES, type StatRange } from '@/features/analytics/windows';
import { AssistantMessage, UserMessage } from '@/features/coach/chat-message';
import { Composer } from '@/features/coach/composer';
import { buildCoachReport } from '@/features/coach/report';
import { ThinkingIndicator } from '@/features/coach/thinking-indicator';
import { runCoachTool } from '@/features/coach/tools';
import { useKeyboardInset } from '@/features/coach/use-keyboard-inset';
import { haptics } from '@/features/feedback/haptics';
import { todayIso } from '@/features/nutrition/dates';
import { useSession } from '@/features/sync/auth-client';
import { useCoachHistory } from '@/store/coach-history';
import { showDialog } from '@/store/dialog';
import { useSettings } from '@/store/settings';
import { duration, radius, spacing, stroke, useColors } from '@/theme';

/**
 * Room for a full review with plan cards in it, and for anything after it.
 *
 * Plan cards are JSON, which costs more tokens per word of advice than prose
 * does. Cutting a four-day programme off in the middle of its third card is
 * worse than not asking.
 */
const MAX_OUTPUT_TOKENS = 6144;

/**
 * Lookups allowed before the coach has to answer with what it has.
 *
 * Each round is a request, and a model that keeps asking for one more history
 * is spending the user's money on its own uncertainty. Four covers "compare
 * these three lifts and check my routines"; the last round is sent without
 * tools, so it can only answer.
 */
const MAX_LOOKUP_ROUNDS = 4;

/** How long a stored title may run before it is cut. */
const TITLE_LENGTH = 80;

/**
 * How long after the landing appears the log is read ahead, and how long that
 * reading stays good for.
 *
 * The delay keeps the SQLite reads out of the screen's own transition. The
 * shelf life is short because a log read ahead and sent ten minutes later
 * would miss the set the user just logged and came here to ask about.
 */
const PREFETCH_DELAY_MS = 600;
const LOG_FRESH_MS = 2 * 60 * 1000;

/** Within this of the end counts as reading the latest, and new text keeps it in view. */
const NEAR_BOTTOM = 80;
/** Scrolled further up than this, the jump-to-latest button appears. */
const SHOW_JUMP = 240;

/** What the coach is doing while there is nothing streaming to show. */
type Phase = 'reading' | 'thinking' | 'looking';

const PHASE_LABELS: Record<Phase, string> = {
  reading: 'Reading your training',
  thinking: 'Thinking',
  looking: 'Looking through your log',
};

interface ChatError {
  failure: AiError;
  /**
   * Whether "Try again" can ask the same thing again. False when the question
   * never left the phone and is back in the box instead.
   */
  retryable: boolean;
}

/**
 * The coach.
 *
 * Opens on a landing rather than straight into an answer: a greeting, the
 * composer, a row of starting questions and the conversations already had.
 * Nothing is sent until the user asks something.
 *
 * The log travels once, with the first message that is about something. A
 * greeting goes out without it: the log is tens of thousands of tokens and
 * several seconds of reading for a model that would answer "hi" the same way
 * without it. While the landing is up, the log is read ahead on the phone, so
 * the first real question does not wait on the database either.
 *
 * After that every turn is a question about an answer the model can still see,
 * so the thread carries the whole exchange and the log is never re-read.
 * Rebuilding it per turn would not merely cost tokens: the log moves, so a
 * follow-up would silently change the evidence underneath an answer that has
 * already been given. What the coach needs beyond it, it looks up.
 */
export default function CoachChatScreen() {
  const scrollEdge = useScrollEdge();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const unit = useSettings((state) => state.weightUnit);
  const { data: session } = useSession();
  const params = useLocalSearchParams<{
    /** An existing conversation to reopen. When set, nothing is re-read or re-asked. */
    thread?: string;
    /** A question to send straight away, from a starter outside this screen. */
    ask?: string;
    range?: string;
    sessions?: string;
    routines?: string;
    note?: string;
  }>();

  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [streaming, setStreaming] = useState('');
  const [pending, setPending] = useState(false);
  const [phase, setPhase] = useState<Phase>('thinking');
  const [error, setError] = useState<ChatError | null>(null);
  const [question, setQuestion] = useState('');
  const [range, setRange] = useState<StatRange>(isRange(params.range) ? params.range : '30d');
  const [configured, setConfigured] = useState<boolean | null>(null);
  /** Turns from this index on rise in as they arrive. A reopened thread's are already there. */
  const [animateFrom, setAnimateFrom] = useState(0);
  const [showJump, setShowJump] = useState(false);

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
  /** A paint of `partial` waiting for the next frame. Tokens land faster than frames. */
  const paint = useRef<number | null>(null);
  /**
   * Whether this provider takes tools at all.
   *
   * Claude and DeepSeek do. Behind the OpenAI-compatible option there may be a
   * local model that refuses a request with tools in it outright; the first such
   * refusal turns lookups off for the rest of the conversation, and the coach
   * answers from the export alone.
   */
  const toolsAccepted = useRef(true);
  /** The thread is named after a greeting, and should take the first real question's name. */
  const titledByGreeting = useRef(false);
  const prefetched = useRef<{ key: string; at: number; document: Promise<string> } | null>(null);
  const nearBottom = useRef(true);
  const jumpShown = useRef(false);
  const scroller = useRef<ScrollView | null>(null);
  const input = useRef<TextInput | null>(null);
  const container = useRef<View | null>(null);
  const opened = useRef(false);
  /**
   * Bumped by "New chat". An exchange still finishing from the conversation
   * before must not write its answer onto the blank one.
   */
  const epoch = useRef(0);

  const keyboard = useKeyboardInset(container);
  // The keyboard covers the home-indicator inset, so the larger of the two is
  // the room to leave, never their sum: summing would float the composer a
  // gesture bar's height above the keys.
  const bottomRoom = useAnimatedStyle(() => ({
    height: Math.max(insets.bottom, keyboard.inset.value),
  }));

  useFocusEffect(
    useCallback(() => {
      void loadAiConfig().then((config) => setConfigured(config !== null));
    }, []),
  );

  const hasLog = messages.some(isLogTurn);
  const logKey = `${range}|${params.sessions ?? ''}|${params.routines ?? ''}|${params.note ?? ''}`;

  /** The training document, from the read-ahead when it is still fresh. */
  const readLog = useCallback((): Promise<string> => {
    const ahead = prefetched.current;
    if (ahead && ahead.key === logKey && Date.now() - ahead.at < LOG_FRESH_MS) return ahead.document;

    const document = buildCoachReport({
      range,
      includeSessions: params.sessions !== '0',
      includeRoutines: params.routines !== '0',
      note: params.note?.trim() || null,
    }).then(buildCoachDocument);
    prefetched.current = { key: logKey, at: Date.now(), document };
    // A failed read is not kept: the next question tries the database again.
    document.catch(() => {
      if (prefetched.current?.document === document) prefetched.current = null;
    });
    return document;
  }, [logKey, range, params.sessions, params.routines, params.note]);

  // Read the log ahead while the user is still typing, so a first question is
  // only ever waiting on the model.
  useEffect(() => {
    if (configured !== true || hasLog) return;
    const timer = setTimeout(() => void readLog().catch(() => {}), PREFETCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [configured, hasLog, readLog]);

  /**
   * Runs one exchange to its answer: stream, look up what was asked for,
   * stream again, until the coach replies without asking for anything.
   *
   * Takes the turns explicitly rather than reading state, because it is called
   * in the same tick that puts the latest question into state and would
   * otherwise send the list from before it.
   */
  const send = useCallback(
    async (turns: AiMessage[]) => {
      const controller = new AbortController();
      abort.current = controller;
      const mine = epoch.current;

      setPending(true);
      setPhase('thinking');
      setError(null);
      setStreaming('');
      partial.current = '';

      let conversation = turns;

      /**
       * Puts a turn on screen and in the database, in that order.
       *
       * The stream is cleared in the same tick the turn lands, so the row that
       * was streaming is handed its finished text in one render rather than
       * showing the answer twice while the insert runs.
       */
      const commit = async (message: AiMessage) => {
        if (paint.current !== null) cancelAnimationFrame(paint.current);
        paint.current = null;
        partial.current = '';
        if (epoch.current !== mine) return;
        conversation = [...conversation, message];
        setMessages(conversation);
        setStreaming('');
        if (threadId.current) await appendMessage(threadId.current, message);
      };

      try {
        const config = await requireAiConfig();

        for (let round = 0; ; round++) {
          const offerTools = toolsAccepted.current && round < MAX_LOOKUP_ROUNDS;

          let turn: StreamedTurn;
          try {
            turn = await ask(config, conversation, offerTools, unit, controller.signal, (text) => {
              partial.current += text;
              paint.current ??= requestAnimationFrame(() => {
                paint.current = null;
                setStreaming(partial.current);
              });
            });
          } catch (cause) {
            // A server that cannot take tools says so with a 400 before a word
            // is written. Ask again without them rather than failing the chat.
            if (
              offerTools &&
              cause instanceof AiError &&
              cause.kind === 'bad-response' &&
              partial.current.length === 0
            ) {
              toolsAccepted.current = false;
              round -= 1;
              continue;
            }
            throw cause;
          }

          if (turn.toolCalls.length === 0) {
            await commit({ role: 'assistant', content: turn.text });
            break;
          }

          // The text that came with the calls is part of the turn that asked
          // for them, and is stored with it.
          setPhase('looking');
          await commit({
            role: 'assistant',
            content: turn.text,
            toolCalls: turn.toolCalls,
            ...(turn.reasoning ? { reasoning: turn.reasoning } : {}),
          });

          // Answered even when the user has pressed stop in the meantime. The
          // lookups are local and quick, and a stored call with no answer is a
          // conversation both providers refuse to continue.
          const results = await Promise.all(turn.toolCalls.map(runCoachTool));
          await commit({ role: 'user', content: '', toolResults: results });
          setPhase('thinking');

          if (controller.signal.aborted) throw new AiError('aborted');
        }
      } catch (cause) {
        const failure = cause instanceof AiError ? cause : new AiError('bad-response');

        // A stop is not a failure, and what arrived before it is worth keeping:
        // the user pressed stop because they had read enough, not because the
        // answer was wrong.
        if (failure.kind === 'aborted') {
          const written = partial.current;
          if (written.length > 0) await commit({ role: 'assistant', content: written });
        } else if (epoch.current === mine) {
          setError({ failure, retryable: true });
          haptics.rejected();
        }
      } finally {
        if (paint.current !== null) cancelAnimationFrame(paint.current);
        paint.current = null;
        setStreaming('');
        partial.current = '';
        setPending(false);
        if (abort.current === controller) abort.current = null;
      }
    },
    [unit],
  );

  /**
   * Sends what the user typed.
   *
   * The bubble goes up at once and the log is attached behind it, so the
   * screen answers the tap before the database has been read. Small talk goes
   * without the log; the first message about anything else carries it.
   */
  const say = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (text.length === 0 || pending || configured === false) return;

      haptics.added();
      setQuestion('');
      setError(null);
      nearBottom.current = true;

      const before = messages;
      const mine = epoch.current;
      const needsLog = !before.some(isLogTurn) && !isSmallTalk(text);
      setMessages([...before, { role: 'user', content: text }]);
      setPending(true);
      setPhase(needsLog ? 'reading' : 'thinking');

      let turn: AiMessage = { role: 'user', content: text };
      try {
        if (needsLog) turn = { role: 'user', content: withCoachLog(await readLog(), text) };

        const config = await requireAiConfig();
        if (!threadId.current) {
          // The question, not the window. A list of earlier conversations all
          // titled "Last 30 days" says nothing about which one is which.
          const created = await createThread({ kind: 'review', title: titleOf(text), model: config.model });
          if (epoch.current !== mine) return;
          threadId.current = created;
          titledByGreeting.current = !needsLog;
        } else if (needsLog && titledByGreeting.current) {
          titledByGreeting.current = false;
          await renameThread(threadId.current, titleOf(text));
        }
        if (epoch.current !== mine) return;
        await appendMessage(threadId.current, turn);
      } catch (cause) {
        if (epoch.current !== mine) return;
        // Nothing was asked, so nothing is kept: the question goes back in the
        // box, ready to send again.
        setMessages(before);
        setQuestion(text);
        setError({ failure: cause instanceof AiError ? cause : new AiError('bad-response'), retryable: false });
        setPending(false);
        return;
      }

      if (epoch.current !== mine) return;
      const turns = [...before, turn];
      setMessages(turns);
      await send(turns);
    },
    [pending, configured, messages, readLog, send],
  );

  /** Takes the conversation back to the last thing the user typed and asks it again. */
  const retry = useCallback(async () => {
    if (pending) return;

    let cut = -1;
    messages.forEach((message, index) => {
      if (message.role === 'user' && coachTurnText(message.content).length > 0) cut = index;
    });
    if (cut === -1) return;

    const kept = messages.slice(0, cut + 1);
    haptics.selection();
    setError(null);
    setMessages(kept);
    if (threadId.current && kept.length < messages.length) await deleteMessagesFrom(threadId.current, kept.length);
    await send(kept);
  }, [pending, messages, send]);

  /** The answer as prose: cards are drawings of the user's data, not words to send. */
  const share = useCallback((text: string) => {
    const prose = parseCoachReply(text)
      .flatMap((segment) => (segment.kind === 'text' ? [segment.text] : []))
      .join('\n\n');
    void Share.share({ message: prose });
  }, []);

  const stop = useCallback(() => {
    haptics.selection();
    abort.current?.abort();
  }, []);

  /** A blank conversation, without leaving the screen. */
  const startOver = useCallback(() => {
    epoch.current += 1;
    abort.current?.abort();
    setPending(false);
    threadId.current = null;
    toolsAccepted.current = true;
    titledByGreeting.current = false;
    nearBottom.current = true;
    jumpShown.current = false;
    setMessages([]);
    setError(null);
    setQuestion('');
    setAnimateFrom(0);
    setShowJump(false);
    scroller.current?.scrollTo({ y: 0, animated: false });
  }, []);

  /**
   * Another stored conversation, in place, from the history panel.
   *
   * The same reset as "New chat" first, so an answer still streaming into the
   * conversation being left cannot land in the one being opened, then the
   * stored turns exactly as `params.thread` would have read them.
   */
  const openThread = useCallback(
    (id: string) => {
      if (id === threadId.current) return;
      startOver();
      threadId.current = id;
      const mine = epoch.current;
      void readMessages(id).then((stored) => {
        if (epoch.current !== mine) return;
        const restored = answerDangling(stored);
        titledByGreeting.current = !restored.some(isLogTurn);
        setAnimateFrom(restored.length);
        setMessages(restored);
      });
    },
    [startOver],
  );

  // What the history panel asks for. Subscribed rather than read in render: the
  // panel posts while this screen sits under it, and each post is one act.
  useEffect(
    () =>
      useCoachHistory.subscribe((state, previous) => {
        if (!state.last || state.last.seq === previous.last?.seq) return;
        const { event } = state.last;
        if (event.kind === 'open') openThread(event.threadId);
        else if (event.kind === 'new') startOver();
        else if (threadId.current && event.threadIds.includes(threadId.current)) startOver();
      }),
    [openThread, startOver],
  );

  // The rows take stable callbacks, so a streaming token re-renders the one
  // row it lands in and not every answer above it. These forward to whatever
  // the latest render's versions are.
  const latest = useRef({ say, retry });
  useEffect(() => {
    latest.current = { say, retry };
  });
  const choose = useCallback((option: string) => void latest.current.say(option), []);
  const askAgain = useCallback(() => void latest.current.retry(), []);

  // Reopening a thread, or a question handed over from another screen. Runs
  // once, guarded by a ref rather than by the dependency array: a question
  // spends money, and a re-run caused by a re-render would spend it again.
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;

    if (params.thread) {
      const id = params.thread;
      threadId.current = id;
      // The stored turns are the conversation. Re-reading the log to rebuild
      // the document would be both a wasted request and a lie: the training has
      // moved since the answer was written, and an answer must keep the
      // evidence it was actually given.
      void readMessages(id).then((stored) => {
        const restored = answerDangling(stored);
        titledByGreeting.current = !restored.some(isLogTurn);
        setAnimateFrom(restored.length);
        setMessages(restored);
      });
    } else if (params.ask?.trim()) {
      // A microtask later rather than in the effect's own body, which would set
      // state while the effect is still running.
      const text = params.ask.trim();
      void Promise.resolve().then(() => say(text));
    }
  }, [params.thread, params.ask, say]);

  // Leaving the screen stops the stream rather than paying for an answer into a
  // screen that is gone.
  useEffect(() => () => abort.current?.abort(), []);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollEdge.list.onScroll(event);

      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      const fromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
      nearBottom.current = fromBottom < NEAR_BOTTOM;

      // State only on the frame the answer changes, never per scroll frame.
      const jump = fromBottom > SHOW_JUMP;
      if (jump !== jumpShown.current) {
        jumpShown.current = jump;
        setShowJump(jump);
      }
    },
    [scrollEdge.list],
  );

  const toLatest = useCallback(() => {
    nearBottom.current = true;
    scroller.current?.scrollToEnd({ animated: true });
  }, []);

  const chooseRange = useCallback(async () => {
    const options = STAT_RANGES.filter((option) => option.value !== 'all');
    const index = await showDialog({
      title: 'What should the coach read?',
      message: 'Sessions, sets per muscle, routines and records from this window. Older history it looks up when it needs it.',
      actions: [
        ...options.map((option) => ({ label: option.label, style: 'default' as const })),
        { label: 'Cancel', style: 'cancel' as const },
      ],
    });
    const picked = options[index];
    if (picked) setRange(picked.value);
  }, []);

  const started = messages.length > 0;
  const lastReply = lastAnswerIndex(messages);
  const rangeLabel = STAT_RANGES.find((option) => option.value === range)?.label ?? 'Last 30 days';

  const composer = (
    <Composer
      ref={input}
      value={question}
      onChangeText={setQuestion}
      onSend={() => void say(question)}
      onStop={stop}
      pending={pending}
      disabled={configured === false}
      placeholder={started ? 'Ask a follow-up' : 'Ask about your training, your food, or your plan'}
      context={rangeLabel}
      // Fixed once the log has gone out: the answers above were built on it.
      onContextPress={hasLog ? undefined : () => void chooseRange()}
    />
  );

  const errorCard = error && (
    <Reveal>
      <View style={[styles.error, { backgroundColor: colors.dangerSurface }]}>
        <View style={styles.errorHead}>
          <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
          <Text variant="bodyMedium" style={styles.flex}>
            {error.failure.message}
          </Text>
        </View>
        {error.failure.detail ? (
          <Text variant="caption" color="textSecondary">
            {error.failure.detail}
          </Text>
        ) : null}
        {error.retryable && (
          <View style={styles.errorActions}>
            <Button title="Try again" size="sm" variant="secondary" onPress={askAgain} />
          </View>
        )}
      </View>
    </Reveal>
  );

  return (
    <Screen width="form" scrolled={scrollEdge.progress}>
      <Stack.Screen
        options={{
          title: 'Coach',
          headerRight: () => (
            <View style={styles.headerActions}>
              {started && (
                <HeaderAction label="New chat" icon="create-outline" onPress={startOver} />
              )}
              <HeaderAction
                label="Chat history"
                icon="time-outline"
                onPress={() =>
                  router.push({
                    pathname: '/coach/history',
                    params: threadId.current ? { current: threadId.current } : {},
                  })
                }
              />
            </View>
          ),
        }}
      />

      <View ref={container} onLayout={keyboard.remeasure} collapsable={false} style={styles.flex}>
        {/* The scroller's own box, so what floats over its foot is positioned
            inside it: Android drops touches outside a parent's bounds. */}
        <View collapsable={false} style={styles.flex}>
          <ScrollView
            {...scrollEdge.list}
            onScroll={onScroll}
            ref={scroller}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={started ? styles.content : styles.landing}
            onContentSizeChange={() => {
              // Follows the answer only while the user is reading the end of it.
              // Scrolled up to reread something, they are left where they are.
              if (started && nearBottom.current) scroller.current?.scrollToEnd({ animated: !pending });
            }}
          >
            {started ? (
              <>
                {messages.map((message, index) => {
                  if (message.role === 'user') {
                    // A turn that only carries lookup results is the app talking
                    // to the model, not the user, and has nothing to show. Nor is
                    // the log: nobody wants to read their own training back.
                    const text = coachTurnText(message.content);
                    if (text.length === 0) return null;
                    return <UserMessage key={index} text={text} animate={index >= animateFrom} />;
                  }

                  return (
                    <AssistantMessage
                      key={index}
                      text={message.content}
                      toolCalls={message.toolCalls}
                      live={false}
                      latest={!pending && index === lastReply}
                      onChoose={choose}
                      onRetry={askAgain}
                      onShare={share}
                    />
                  );
                })}

                {/* Keyed as the turn it is about to become, so the finished answer
                    takes over this row instead of remounting in its place. */}
                {streaming.length > 0 && (
                  <AssistantMessage
                    key={messages.length}
                    text={streaming}
                    live
                    latest={false}
                    onChoose={choose}
                    onRetry={askAgain}
                    onShare={share}
                  />
                )}

                {pending && streaming.length === 0 && (
                  <Reveal>
                    <ThinkingIndicator label={PHASE_LABELS[phase]} />
                  </Reveal>
                )}

                {errorCard}
              </>
            ) : (
              <>
                <Reveal style={styles.greeting}>
                  <View style={[styles.mark, { backgroundColor: colors.accentSurface }]}>
                    <Ionicons name="sparkles" size={22} color={colors.accent} />
                  </View>
                  <Text variant="title" align="center">
                    {greeting(session?.user?.name)}
                  </Text>
                  <Text variant="body" color="textSecondary" align="center">
                    I read your training and your food diary before I answer. Where should we start?
                  </Text>
                </Reveal>

                {configured === false && (
                  <Reveal index={1}>
                    <Card style={styles.setup}>
                      <Text variant="bodyMedium">Connect a model to talk to your coach</Text>
                      <Text variant="caption" color="textSecondary">
                        Add a Claude, DeepSeek or OpenAI-compatible key. It stays on this phone. Or
                        export your log and paste it into any AI you already use.
                      </Text>
                      <View style={styles.setupActions}>
                        <Button title="Set up" size="sm" onPress={() => router.push('/settings/ai')} />
                        <Button title="Export instead" size="sm" variant="secondary" onPress={() => router.push('/coach')} />
                      </View>
                    </Card>
                  </Reveal>
                )}

                <Reveal index={1}>{composer}</Reveal>

                <View style={styles.starters}>
                  {COACH_STARTERS.map((starter, index) => (
                    <Reveal key={starter.label} index={index + 2}>
                      <Chip
                        label={starter.label}
                        icon={starter.icon as ComponentProps<typeof Ionicons>['name']}
                        disabled={configured === false || pending}
                        onPress={() => void say(starter.question)}
                      />
                    </Reveal>
                  ))}
                </View>

                {errorCard}

              </>
            )}
          </ScrollView>

          {/* Answers fade out under the composer rather than being cut off by it. */}
          {started && (
            <LinearGradient
              pointerEvents="none"
              colors={[`${colors.background}00`, colors.background]}
              style={styles.fade}
            />
          )}

          {started && showJump && (
            <Animated.View
              style={styles.jump}
              entering={popIn}
              exiting={FadeOut.duration(duration.fast).reduceMotion(ReduceMotion.System)}
            >
              <PressableScale
                onPress={toLatest}
                accessibilityRole="button"
                accessibilityLabel="Jump to the latest message"
                fill={colors.surfaceElevated}
                fillPressed={colors.surfacePressed}
                style={[styles.jumpButton, { borderColor: colors.border }]}
              >
                <Ionicons name="arrow-down" size={18} color={colors.text} />
              </PressableScale>
            </Animated.View>
          )}
        </View>

        {started && <Reveal style={styles.dock}>{composer}</Reveal>}

        {/* Pinned against Fabric's view flattening: its height animates. */}
        <Animated.View collapsable={false} style={bottomRoom} />
      </View>
    </Screen>
  );
}

/** One request, with or without lookups on offer. */
function ask(
  config: AiConfig,
  conversation: AiMessage[],
  offerTools: boolean,
  unit: 'kg' | 'lb',
  signal: AbortSignal,
  onDelta: (text: string) => void,
): Promise<StreamedTurn> {
  const logAt = conversation.findIndex(isLogTurn);

  return streamTurn(
    config,
    {
      system: coachChatBrief(unit, { withLog: logAt !== -1, today: todayIso() }),
      messages: withCurrentReasoning(conversation),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      // The turn carrying the training document is re-sent with every
      // follow-up. Anthropic will hold on to it if asked, which is most of what
      // a second question costs.
      ...(logAt !== -1 ? { cacheMessageAt: logAt } : {}),
      ...(offerTools ? { tools: COACH_TOOLS } : {}),
    },
    { onDelta, signal },
  );
}

function isLogTurn(message: AiMessage): boolean {
  return message.role === 'user' && carriesCoachLog(message.content);
}

function titleOf(text: string): string {
  return text.length > TITLE_LENGTH ? `${text.slice(0, TITLE_LENGTH - 1).trimEnd()}…` : text;
}

/**
 * DeepSeek's reasoning, kept only for the exchange it belongs to.
 *
 * It must come back with the tool calls it led to while that exchange is still
 * running, and is dead weight once the user has spoken again. Everything up to
 * the last thing the user typed has it stripped.
 */
function withCurrentReasoning(conversation: AiMessage[]): AiMessage[] {
  let lastTyped = -1;
  conversation.forEach((message, index) => {
    if (message.role === 'user' && message.content.length > 0) lastTyped = index;
  });

  return conversation.map((message, index) => {
    if (index > lastTyped || !message.reasoning) return message;
    const { reasoning: _dropped, ...rest } = message;
    return rest;
  });
}

/**
 * Answers a lookup a stored conversation never got the result of.
 *
 * Only reachable when the app was killed between asking and answering, and
 * without it the thread could never be continued: both providers refuse a
 * conversation with an unanswered call in it.
 */
function answerDangling(messages: AiMessage[]): AiMessage[] {
  const last = messages.at(-1);
  if (last?.role !== 'assistant' || !last.toolCalls?.length) return messages;

  const results: AiToolResult[] = last.toolCalls.map((call) => ({
    callId: call.id,
    name: call.name,
    content: 'This lookup was interrupted. Answer without it.',
    isError: true,
  }));
  return [...messages, { role: 'user', content: '', toolResults: results }];
}

/** The latest reply that is an answer rather than a request for a lookup. */
function lastAnswerIndex(conversation: AiMessage[]): number {
  for (let i = conversation.length - 1; i >= 0; i--) {
    const message = conversation[i]!;
    if (message.role === 'user' && message.content.length > 0) return -1;
    if (message.role === 'assistant' && !message.toolCalls?.length) return i;
  }
  return -1;
}

function greeting(name: string | null | undefined): string {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const first = name?.trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
}

function isRange(value: string | undefined): value is StatRange {
  return STAT_RANGES.some((option) => option.value === value);
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xl },
  landing: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    paddingVertical: spacing.xxxl,
    gap: spacing.xl,
  },
  greeting: { gap: spacing.sm, alignItems: 'center' },
  mark: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  setup: { gap: spacing.sm },
  setupActions: { flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.xs },
  starters: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm },
  error: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg },
  errorHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  errorActions: { flexDirection: 'row', paddingTop: spacing.xs },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dock: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: spacing.xl },
  jump: { position: 'absolute', bottom: spacing.md, alignSelf: 'center' },
  jumpButton: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    borderWidth: stroke.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
