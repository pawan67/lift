import {
  buildCoachPrompt,
  coachFileName,
  estimateTokens,
  formatDateTime,
  type CoachReport,
} from '@lift/shared';
import { File, Paths } from 'expo-file-system';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  Share,
  StyleSheet,
  View,
  type AccessibilityActionEvent,
} from 'react-native';

import {
  Button,
  Card,
  Divider,
  ListRow,
  Screen,
  SectionHeader,
  Text,
  TextField,
  useScrollEdge,
} from '@/components/ui';
import { loadAiConfig } from '@/features/ai/client';
import { deleteThread, listThreads, type CoachThread } from '@/features/ai/threads';
import { RangePicker } from '@/features/analytics/range-picker';
import { buildCoachReport, MAX_LOGGED_SESSIONS } from '@/features/coach/report';
import { SettingToggle } from '@/features/settings/rows';
import { showAlert, showConfirm } from '@/store/dialog';
import { spacing } from '@/theme';
import type { StatRange } from '@/features/analytics/windows';

/** Mirrors the export screen: the one line of an unknown failure worth showing. */
function reason(cause: unknown): string {
  const text = cause instanceof Error ? cause.message.trim() : '';
  return text.length > 0 ? text : 'The reason was not reported.';
}

/**
 * How much of the document the preview shows.
 *
 * Enough to reach the first session. The part nobody believes is really in
 * there until they see it, and not so much that the screen becomes a text
 * viewer. Anyone who wants the whole thing has two buttons above that hand it
 * to something built for reading.
 */
const PREVIEW_LINES = 80;

/**
 * Thirty days.
 *
 * Long enough for weekly set counts to mean anything and short enough that the
 * session log is complete rather than capped, which is the window a review is
 * most useful over. The picker is right there for anyone who wants the year.
 */
const DEFAULT_RANGE: StatRange = '30d';

/** What the document is read from. The three answers that cost a query. */
interface Choices {
  range: StatRange;
  withSessions: boolean;
  withRoutines: boolean;
}

/**
 * Handing your training to a language model.
 *
 * The screen builds one Markdown document: the sessions as they happened, the
 * weekly set count per muscle against the landmarks the statistics screens use,
 * the routines, the records, and ends it by asking for criticism. The user
 * sends it to whichever assistant they already use and gets an answer written
 * against their real log instead of against a description of it.
 *
 * It is an export, and it is built like the others: everything above the two
 * buttons is a read, nothing on this screen writes, and the document says out
 * loud what it left out. The one thing it adds is the note field, because the
 * log cannot know what someone is training *for*, and a review that has to
 * guess at the goal spends its best paragraph on the wrong one.
 */
export default function CoachScreen() {
  const scrollEdge = useScrollEdge();

  const [choices, setChoices] = useState<Choices>({
    range: DEFAULT_RANGE,
    withSessions: true,
    withRoutines: true,
  });
  const [note, setNote] = useState('');

  /**
   * Whether asking in the app is even on the table.
   *
   * A keychain read, so it cannot be answered during render, and it decides
   * which of the buttons below is the primary one. Nothing about this screen
   * breaks when it stays false: the export it was built as is still the whole
   * feature for anyone who has not set up a key, and is still the right answer
   * for anyone who would rather read the review somewhere else.
   */
  const [configured, setConfigured] = useState(false);

  /** Stored conversations, newest first. Empty until one has been had. */
  const [threads, setThreads] = useState<CoachThread[]>([]);

  const [report, setReport] = useState<CoachReport | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<'text' | 'file' | null>(null);
  const [previewing, setPreviewing] = useState(false);

  /**
   * Changing what to send also throws away what was read.
   *
   * The reset belongs to the tap rather than to the effect that follows it. A
   * report left on screen under a range the user has already moved away from
   * describes the wrong window for as long as the new query takes, and the row
   * of counts is the one part of this screen someone reads before committing.
   */
  const choose = useCallback((patch: Partial<Choices>) => {
    setChoices((previous) => ({ ...previous, ...patch }));
    setReport(null);
    setFailed(false);
  }, []);

  const refreshThreads = useCallback(() => {
    void listThreads('review')
      .then(setThreads)
      .catch(() => setThreads([]));
  }, []);

  // Re-read on focus rather than on mount: coming back from a conversation just
  // had is exactly when this list is wrong.
  useFocusEffect(refreshThreads);

  useEffect(() => {
    let live = true;
    void loadAiConfig().then((config) => {
      if (live) setConfigured(config !== null);
    });
    return () => {
      live = false;
    };
  }, []);

  const remove = useCallback(
    async (threadId: string) => {
      const confirmed = await showConfirm({
        title: 'Delete this review?',
        message: 'The conversation is removed from this device. Your training log is untouched.',
        confirmLabel: 'Delete',
      });
      if (!confirmed) return;

      await deleteThread(threadId);
      refreshThreads();
    },
    [refreshThreads],
  );

  useEffect(() => {
    // Two reads can be in flight (change the range, then a toggle) and they
    // answer in whatever order they answer in. Without this the slower one wins
    // and the screen describes a window nobody asked for.
    let cancelled = false;

    // The note is deliberately not an input here: it changes the document, not
    // the query, so it is applied below and a keystroke never reaches SQLite.
    void buildCoachReport({
      range: choices.range,
      includeSessions: choices.withSessions,
      includeRoutines: choices.withRoutines,
      note: null,
    }).then(
      (next) => {
        if (!cancelled) setReport(next);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [choices]);

  const prompt = useMemo(() => {
    if (!report) return null;
    const trimmed = note.trim();
    return buildCoachPrompt({
      ...report,
      profile: { ...report.profile, note: trimmed.length > 0 ? trimmed : null },
    });
  }, [report, note]);

  const shareText = async () => {
    if (!prompt) return;

    setBusy('text');
    try {
      await Share.share({ message: prompt });
    } catch (error) {
      // Android carries a shared message through a transaction with a size cap,
      // and a year of training can exceed it. The file below has no such limit,
      // so the failure is worth naming rather than merely reporting.
      void showAlert(
        'The share sheet would not take it',
        `${reason(error)}\n\nA prompt this long can be more than a share sheet will carry. Saving it as a file always works.`,
      );
    } finally {
      setBusy(null);
    }
  };

  const shareFile = async () => {
    if (!prompt || !report) return;

    setBusy('file');
    try {
      const file = new File(Paths.cache, coachFileName(report.generatedAt));
      // Overwrite, so building one twice in a day doesn't fail.
      file.create({ overwrite: true });
      file.write(prompt);

      if (!(await Sharing.isAvailableAsync())) {
        void showAlert(
          'No share sheet on this device',
          `The file is written and waiting at:\n${file.uri}`,
        );
        return;
      }

      // `text/plain` rather than `text/markdown`, which almost nothing on
      // Android registers for: the share sheet filters by MIME type, and the
      // honest one would leave the sheet empty of the apps this file is for.
      // The `.md` extension still travels with it.
      await Sharing.shareAsync(file.uri, {
        mimeType: 'text/plain',
        dialogTitle: 'Training review',
      });
    } catch (error) {
      void showAlert(
        'File not written',
        `${reason(error)}\n\nIf the phone is out of storage, freeing some space and trying again is the fix.`,
      );
    } finally {
      setBusy(null);
    }
  };

  const empty = report !== null && report.totals.workouts === 0;

  return (
    <Screen width="form" scrolled={scrollEdge.progress}>
      <Stack.Screen options={{ title: 'Coach review' }} />

      <ScrollView {...scrollEdge.list} contentContainerStyle={styles.content}>
        <Text variant="body" color="textSecondary">
          This writes out your training as one long message: every session in the window, how many
          sets each muscle got against what it needs, your routines and your records, and ends by
          asking for criticism. Send it to ChatGPT, Claude or whatever you use, and the answer comes
          back against your real log instead of a guess at it. Set up a key under Settings, AI
          coach, and you can ask here instead and keep the conversation.
        </Text>

        <SectionHeader title="How much to send" />
        <RangePicker value={choices.range} onChange={(range) => choose({ range })} />

        <Card padded={false} style={styles.card}>
          <SettingToggle
            icon="list-outline"
            label="Session by session"
            description="Every set of every workout, with dates."
            value={choices.withSessions}
            onChange={(withSessions) => choose({ withSessions })}
          />
          <Divider inset={spacing.lg} />
          <SettingToggle
            icon="albums-outline"
            label="My routines"
            description="What each routine prescribes, so it can suggest edits."
            value={choices.withRoutines}
            onChange={(withRoutines) => choose({ withRoutines })}
          />
        </Card>
        <Text variant="caption" color="textTertiary" style={styles.hint}>
          Turn either off to make the message shorter. The weekly set counts and the totals cover
          the whole window regardless, and the message says which parts were left out.
        </Text>

        <SectionHeader title="Anything it should know" />
        <TextField
          multiline
          value={note}
          onChangeText={setNote}
          placeholder="I want bigger arms. My left shoulder clicks on incline press. I can train four days a week."
          style={styles.note}
        />
        <Text variant="caption" color="textTertiary" style={styles.hint}>
          Optional, and the one thing the log cannot supply. It records what you did, not what you
          are training for, what hurts, or how many days you actually have.
        </Text>

        <SectionHeader title="What gets sent" />
        <Card style={styles.card}>
          <Row label="Sessions" value={countOf(report, (r) => r.sessions.length)} />
          <Row label="Working sets" value={countOf(report, (r) => r.totals.sets)} />
          <Row label="Routines" value={countOf(report, (r) => r.routines.length)} />
          <Row
            label="Roughly"
            value={prompt === null ? null : `${estimateTokens(prompt).toLocaleString()} tokens`}
          />
        </Card>

        {failed ? (
          <Text variant="label" color="danger" style={styles.hint}>
            Could not read the database to build the review. Nothing was changed. It is worth
            trying again, or exporting a backup from Backup &amp; export instead.
          </Text>
        ) : empty ? (
          <Text variant="label" color="warning" style={styles.hint}>
            No finished workouts in this window, so there is nothing to review. Widen the range.
          </Text>
        ) : report && report.omittedSessions > 0 ? (
          <Text variant="caption" color="textTertiary" style={styles.hint}>
            The log is capped at the {MAX_LOGGED_SESSIONS} most recent sessions:{' '}
            {report.omittedSessions.toLocaleString()} older ones are summarised rather than written
            out, which the message says where it happens. A shorter range writes every one.
          </Text>
        ) : null}

        {/*
         * Two ways out, and which one leads depends on whether a key is set.
         *
         * The export is not a fallback that the in-app answer replaced. It is
         * the honest option for somebody who has no key, does not want one, or
         * would rather read a long review on a computer, and it is the only one
         * of the two that costs nothing. So it keeps its size and its wording;
         * asking in the app is added above it when asking in the app is
         * possible, and is silent otherwise.
         */}
        {configured && (
          <>
            <Button
              title="Ask now"
              icon="sparkles-outline"
              size="lg"
              fullWidth
              disabled={prompt === null || empty}
              onPress={() =>
                router.push({
                  pathname: '/coach/chat',
                  params: {
                    range: choices.range,
                    sessions: choices.withSessions ? '1' : '0',
                    routines: choices.withRoutines ? '1' : '0',
                    note: note.trim(),
                  },
                })
              }
            />
            <Text variant="caption" color="textTertiary" style={styles.hint}>
              Sends the same message to your own model and reads the answer here, where you can ask
              it follow-up questions against the same log.
            </Text>
          </>
        )}

        <Button
          title="Share the prompt"
          icon="chatbubble-ellipses-outline"
          size={configured ? 'md' : 'lg'}
          variant={configured ? 'secondary' : 'primary'}
          fullWidth
          loading={busy === 'text'}
          disabled={prompt === null || busy !== null}
          onPress={() => void shareText()}
        />
        <Text variant="caption" color="textTertiary" style={styles.hint}>
          Opens the share sheet with the whole message. Pick your assistant to send it straight
          there, or copy it and paste it wherever you like.
        </Text>

        <Button
          title="Save as a Markdown file"
          icon="document-text-outline"
          variant="secondary"
          fullWidth
          loading={busy === 'file'}
          disabled={prompt === null || busy !== null}
          onPress={() => void shareFile()}
        />
        <Text variant="caption" color="textTertiary" style={styles.hint}>
          For a long window, or for finishing the job on a computer. A share sheet can refuse a
          message this large; a file never is.
        </Text>

        <Button
          title={previewing ? 'Hide the prompt' : 'Read it first'}
          icon={previewing ? 'eye-off-outline' : 'eye-outline'}
          variant="ghost"
          fullWidth
          disabled={prompt === null}
          onPress={() => setPreviewing((open) => !open)}
        />

        {/*
         * Past conversations.
         *
         * The one thing the export could never do. A shared file goes into a
         * chat app and the answer lives there, so there is no memory, no
         * follow-up against the same log, and nothing to compare a review from
         * March against. These are stored on the device, are excluded from sync
         * for wire-compatibility reasons, and travel in a backup.
         *
         * Reopening one does not re-read the log: the answer keeps the evidence
         * it was actually given, which is the only way two reviews months apart
         * can be compared at all.
         */}
        {threads.length > 0 && (
          <>
            <SectionHeader title="Earlier reviews" />
            <Card padded={false}>
              {threads.map((thread, index) => (
                <View key={thread.id}>
                  {index > 0 && <Divider inset={spacing.lg} />}
                  <ListRow
                    icon="time-outline"
                    title={thread.title}
                    subtitle={`${formatDateTime(new Date(thread.createdAt))} · ${thread.model}`}
                    onPress={() => router.push({ pathname: '/coach/chat', params: { thread: thread.id } })}
                    accessibilityActions={[{ name: 'delete', label: 'Delete this review' }]}
                    onAccessibilityAction={(event: AccessibilityActionEvent) => {
                      if (event.nativeEvent.actionName === 'delete') void remove(thread.id);
                    }}
                    accessory={
                      <Button
                        title="Delete"
                        variant="ghost"
                        size="sm"
                        onPress={() => void remove(thread.id)}
                      />
                    }
                  />
                </View>
              ))}
            </Card>
          </>
        )}

        {previewing && prompt !== null && (
          <Card style={styles.preview}>
            <Text variant="caption" color="textSecondary">
              {previewOf(prompt)}
            </Text>
            <Text variant="caption" color="textTertiary" style={styles.previewFoot}>
              The first {PREVIEW_LINES} lines of {prompt.split('\n').length.toLocaleString()}.
              Nothing leaves this phone until you tap one of the buttons above.
            </Text>
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}

/** The first lines of the document, for someone who wants to see it before sending it. */
function previewOf(prompt: string): string {
  return prompt.split('\n').slice(0, PREVIEW_LINES).join('\n').trimEnd();
}

function countOf(report: CoachReport | null, read: (report: CoachReport) => number): string | null {
  return report === null ? null : read(report).toLocaleString();
}

/**
 * A value of `null` is "still counting", which is not the statement zero is:
 * the same rule the export screen's rows follow.
 */
function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <View style={styles.row}>
      <Text variant="body" color="textSecondary">
        {label}
      </Text>
      <Text variant="numeric" color={value === null ? 'textTertiary' : 'text'}>
        {value ?? '—'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.sm },
  card: { gap: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hint: { paddingTop: spacing.sm, paddingHorizontal: spacing.xs },
  // Tall enough that a sentence about a shoulder and a sentence about a
  // schedule are visible at once, which is what people actually write here.
  note: { minHeight: 96, textAlignVertical: 'top' },
  preview: { marginTop: spacing.sm, gap: spacing.md },
  previewFoot: { paddingTop: spacing.sm },
});
