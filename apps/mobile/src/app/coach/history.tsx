/**
 * The coach's chat history: a panel that slides in over the chat, the way the
 * ChatGPT app's drawer does, opened from the clock in the chat's header.
 *
 * Search, a new chat, and every stored conversation grouped by when it was
 * last spoken to. A tap opens one in place; the "…" on each row (or a long
 * press) renames or deletes it. Conversations live only on this phone (see
 * `features/ai/threads.ts`), so a delete is final, and it asks first.
 *
 * It is a route of its own, presented transparently over the chat, rather
 * than a modal inside the chat screen. A route covers the header like a
 * drawer should, and its list scrolls as a native screen: scrolling inside an
 * RN `Modal` is unreliable on some Android phones. What the user picks goes
 * back to the chat through `useCoachHistory`.
 */

import { Ionicons } from '@expo/vector-icons';
import { describeElapsed } from '@lift/shared';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { ReduceMotion, SlideInRight } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton, PromptModal, SearchBar, Text } from '@/components/ui';
import { deleteThread, listThreads, renameThread, type CoachThread } from '@/features/ai/threads';
import { haptics } from '@/features/feedback/haptics';
import { useCoachHistory } from '@/store/coach-history';
import { showConfirm, showDialog } from '@/store/dialog';
import { radius, spacing, useColors } from '@/theme';

/** The panel never takes the whole width: the strip of chat beside it is the way back. */
const PANEL_MAX = 380;
const PANEL_SHARE = 0.86;

export default function CoachHistoryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ current?: string }>();
  const post = useCoachHistory((state) => state.post);

  const [threads, setThreads] = useState<CoachThread[] | null>(null);
  const [listedAt, setListedAt] = useState(0);
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<CoachThread | null>(null);

  const refresh = useCallback(() => {
    void listThreads('review')
      .then((rows) => {
        setThreads(rows);
        setListedAt(Date.now());
      })
      .catch(() => setThreads([]));
  }, []);

  useFocusEffect(refresh);

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/coach/chat');
  }, []);

  const open = (thread: CoachThread) => {
    haptics.selection();
    if (thread.id !== params.current) post({ kind: 'open', threadId: thread.id });
    close();
  };

  const startNew = () => {
    haptics.selection();
    post({ kind: 'new' });
    close();
  };

  const remove = async (thread: CoachThread) => {
    const sure = await showConfirm({
      title: 'Delete this chat?',
      message: `"${thread.title}" will be deleted from this phone. This cannot be undone.`,
      confirmLabel: 'Delete',
    });
    if (!sure) return;
    await deleteThread(thread.id);
    haptics.destructive();
    post({ kind: 'deleted', threadIds: [thread.id] });
    refresh();
  };

  const removeAll = async () => {
    if (!threads?.length) return;
    const sure = await showConfirm({
      title: 'Delete all chats?',
      message: `All ${threads.length} conversations with the coach will be deleted from this phone. This cannot be undone.`,
      confirmLabel: 'Delete all',
    });
    if (!sure) return;
    await Promise.all(threads.map((thread) => deleteThread(thread.id)));
    haptics.destructive();
    post({ kind: 'deleted', threadIds: threads.map((thread) => thread.id) });
    refresh();
  };

  const actions = async (thread: CoachThread) => {
    haptics.selection();
    const choice = await showDialog({
      title: thread.title,
      actions: [
        { label: 'Rename', style: 'default' },
        { label: 'Delete', style: 'destructive' },
        { label: 'Cancel', style: 'cancel' },
      ],
    });
    if (choice === 0) setRenaming(thread);
    else if (choice === 1) void remove(thread);
  };

  const groups = useMemo(() => groupThreads(threads ?? [], query, listedAt), [threads, query, listedAt]);
  const panelWidth = Math.min(PANEL_MAX, Math.round(width * PANEL_SHARE));

  return (
    <View style={styles.root}>
      <Pressable
        style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}
        onPress={close}
        accessibilityRole="button"
        accessibilityLabel="Close chat history"
      />

      <Animated.View
        entering={SlideInRight.duration(260).reduceMotion(ReduceMotion.System)}
        accessibilityViewIsModal
        style={[
          styles.panel,
          {
            width: panelWidth,
            backgroundColor: colors.background,
            borderColor: colors.border,
            paddingTop: insets.top + spacing.sm,
            paddingBottom: insets.bottom,
          },
        ]}
      >
        <View style={styles.head}>
          <Text variant="title" style={styles.flex}>
            Chats
          </Text>
          <IconButton name="close" accessibilityLabel="Close chat history" onPress={close} />
        </View>

        <View style={styles.search}>
          <SearchBar
            value={query}
            onChangeText={setQuery}
            onClear={() => setQuery('')}
            placeholder="Search chats"
            returnKeyType="search"
          />
        </View>

        <Row icon="create-outline" label="New chat" onPress={startNew} strong />
        <Row
          icon="options-outline"
          label="What the coach reads, and export"
          onPress={() => {
            close();
            router.push('/coach');
          }}
        />

        <ScrollView style={styles.flex} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          {threads === null ? null : groups.length === 0 ? (
            <Text variant="caption" color="textTertiary" style={styles.empty}>
              {query.trim() ? `No chats match "${query.trim()}".` : 'No chats yet. Ask the coach something and it shows up here.'}
            </Text>
          ) : (
            groups.map((group) => (
              <View key={group.label} style={styles.group}>
                <Text variant="overline" color="textTertiary" style={styles.groupLabel}>
                  {group.label}
                </Text>
                {group.threads.map((thread) => {
                  const current = thread.id === params.current;
                  return (
                    <Pressable
                      key={thread.id}
                      onPress={() => open(thread)}
                      onLongPress={() => void actions(thread)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: current }}
                      accessibilityLabel={`${thread.title}, ${describeElapsed(thread.updatedAt, listedAt)}`}
                      accessibilityHint="Long press to rename or delete"
                      style={({ pressed }) => [
                        styles.thread,
                        { backgroundColor: pressed ? colors.surfacePressed : current ? colors.surfaceMuted : 'transparent' },
                      ]}
                    >
                      <Text variant="body" numberOfLines={1} style={styles.flex}>
                        {thread.title}
                      </Text>
                      <IconButton
                        name="ellipsis-horizontal"
                        size={18}
                        color={colors.textTertiary}
                        accessibilityLabel={`Rename or delete "${thread.title}"`}
                        onPress={() => void actions(thread)}
                      />
                    </Pressable>
                  );
                })}
              </View>
            ))
          )}
        </ScrollView>

        {threads && threads.length > 0 ? (
          <View style={[styles.foot, { borderColor: colors.border }]}>
            <Row icon="trash-outline" label="Delete all chats" onPress={() => void removeAll()} danger />
          </View>
        ) : null}
      </Animated.View>

      <PromptModal
        visible={renaming !== null}
        title="Rename chat"
        initialValue={renaming?.title ?? ''}
        confirmLabel="Rename"
        maxLength={80}
        onCancel={() => setRenaming(null)}
        onConfirm={(value) => {
          const thread = renaming;
          setRenaming(null);
          if (!thread) return;
          void renameThread(thread.id, value.trim()).then(refresh);
        }}
      />
    </View>
  );
}

function Row({
  icon,
  label,
  onPress,
  strong = false,
  danger = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  strong?: boolean;
  danger?: boolean;
}) {
  const colors = useColors();
  const tint = danger ? colors.danger : strong ? colors.text : colors.textSecondary;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfacePressed }]}
    >
      <Ionicons name={icon} size={20} color={tint} />
      <Text variant={strong ? 'bodyMedium' : 'body'} style={{ color: tint }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

interface ThreadGroup {
  label: string;
  threads: CoachThread[];
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Today, Yesterday, Previous 7 days, Previous 30 days, then by month: the
 * buckets the ChatGPT app uses, because that is what people already scan for.
 * Counted in calendar days on the phone's clock, not in 24-hour blocks.
 */
function groupThreads(threads: CoachThread[], query: string, now: number): ThreadGroup[] {
  const needle = query.trim().toLowerCase();
  const shown = needle ? threads.filter((thread) => thread.title.toLowerCase().includes(needle)) : threads;
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const startOfToday = midnight.getTime();
  const day = 86_400_000;

  const groups: ThreadGroup[] = [];
  const push = (label: string, thread: CoachThread) => {
    const last = groups.at(-1);
    if (last?.label === label) last.threads.push(thread);
    else groups.push({ label, threads: [thread] });
  };

  for (const thread of shown) {
    const at = thread.updatedAt;
    if (at >= startOfToday) push('Today', thread);
    else if (at >= startOfToday - day) push('Yesterday', thread);
    else if (at >= startOfToday - 7 * day) push('Previous 7 days', thread);
    else if (at >= startOfToday - 30 * day) push('Previous 30 days', thread);
    else {
      const date = new Date(at);
      const sameYear = date.getFullYear() === midnight.getFullYear();
      push(sameYear ? MONTHS[date.getMonth()]! : `${MONTHS[date.getMonth()]} ${date.getFullYear()}`, thread);
    }
  }
  return groups;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  head: { flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.lg, paddingRight: spacing.sm, paddingBottom: spacing.sm },
  search: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
  },
  list: { paddingBottom: spacing.lg, paddingTop: spacing.sm },
  group: { paddingTop: spacing.md },
  groupLabel: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },
  thread: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: spacing.sm,
    paddingLeft: spacing.md,
    paddingVertical: 2,
    borderRadius: radius.lg,
  },
  empty: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  foot: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: spacing.xs },
});
