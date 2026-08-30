import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { settleDialog, useDialogs, type DialogAction, type QueuedDialog } from '@/store/dialog';
import { radius, spacing, useColors } from '@/theme';

import { Button, type ButtonVariant } from './button';
import { Text } from './text';

/**
 * Renders whatever is at the head of the dialog queue.
 *
 * Mounted once, at the root, above the navigator: see `app/_layout.tsx` for
 * why it sits beside `Bootstrap` rather than inside `AppNavigator`. Everything
 * it knows comes from `store/dialog`, which is also the only way to open one.
 *
 * Card, backdrop and accessibility handling are `PromptModal`'s, deliberately:
 * that component is the app's existing dialog and the two appear in the same
 * flows (rename a routine, then delete it) so they have to be the same
 * object. Only the body differs, text here against a field there.
 */
export function DialogHost() {
  const colors = useColors();
  const current = useDialogs((state) => state.queue[0] ?? null);

  // The head is cleared the moment an action is pressed, but `Modal` fades out
  // over the frames after that, and children that vanish on the same commit
  // fade out an empty card. Holding the last request keeps the dialog readable
  // until it is actually gone. Adjusted during render rather than in an effect,
  // the way `PromptModal` and `MeasurementEntrySheet` seed themselves. An
  // effect would paint the blank frame first and correct it a commit later.
  const [shown, setShown] = useState<QueuedDialog | null>(current);

  if (current && current !== shown) setShown(current);

  // Resolves to the Cancel action when there is one, so a backdrop tap and the
  // Android back gesture are the same event as pressing it: including its
  // `onPress`. Every dialog can be closed this way, with no exception for the
  // ones that have no Cancel: a modal the hardware back button cannot dismiss
  // is a trap, and `Alert.alert`'s Android default of `cancelable: false` is
  // the behaviour this replaces rather than one to carry over.
  const dismiss = () => {
    if (!current) return;
    settleDialog(
      current,
      current.actions.findIndex((action) => action.style === 'cancel'),
    );
  };

  const actions = shown?.actions ?? [];

  // Accented only when it is the sole ordinary action. A menu: the exercise
  // block's Replace / Edit note / Remove. Is three or four of these at once,
  // and painting them all in the accent spends a screen's entire colour budget
  // (`theme/tokens.ts`: roughly one accent element per view) on a list of
  // equally weighted choices, none of which is the one being recommended.
  const ordinary = actions.filter((action) => (action.style ?? 'default') === 'default').length;

  // Side by side only when both labels are short enough to survive it. Two
  // buttons split a 400pt card into ~170pt each, which holds about twelve
  // characters at the label's size before `Button`'s `numberOfLines={1}`
  // truncates, and a confirmation whose verb reads "Open Push Day…" is worse
  // than a taller dialog. Anything else stacks full width.
  const inline = actions.length === 2 && actions.every((action) => action.label.length <= 12);

  // Cancel leads the row and trails the stack, which is where each platform
  // puts it and where the eye looks for it. Sorting here rather than asking
  // call sites to order for a layout they cannot see also means the original
  // index (the one `settleDialog` and the promise are keyed on) has to travel
  // alongside. `sort` is stable, so everything else keeps the order it was
  // passed in.
  const ordered = actions
    .map((action, index) => ({ action, index }))
    .sort((a, b) => cancelRank(a.action, inline) - cancelRank(b.action, inline));

  return (
    <Modal visible={current !== null} transparent animationType="fade" onRequestClose={dismiss}>
      {/*
        `accessible={false}` on both Pressables: the same reasoning as
        `PromptModal`. Pressable defaults to accessible, which collapses its
        whole subtree into one element, and the backdrop would announce the
        dialog as a single button reading "Delete workout This session its sets
        and any records it set will be removed Cancel Delete" with none of the
        three reachable.
      */}
      <Pressable
        accessible={false}
        style={[styles.backdrop, { backgroundColor: colors.overlay }]}
        onPress={dismiss}
      >
        {/* Swallows taps inside the card so they don't dismiss the dialog. */}
        <Pressable
          accessible={false}
          // Hides the screen behind it from the screen reader, so focus lands on
          // the heading and a swipe past the last button returns to it instead
          // of wandering into the list underneath.
          accessibilityViewIsModal
          style={[styles.card, { backgroundColor: colors.surfaceElevated }]}
          onPress={(event) => event.stopPropagation()}
        >
          <Text variant="subheading" accessibilityRole="header">
            {shown?.title}
          </Text>

          {shown?.message !== undefined && (
            <Text variant="body" color="textSecondary">
              {shown.message}
            </Text>
          )}

          <View style={[styles.actions, inline ? styles.inline : styles.stacked]}>
            {ordered.map(({ action, index }) => (
              <Button
                key={`${action.label}-${index}`}
                title={action.label}
                // Out of context a screen reader reads the visible word alone,
                // and "Delete" with no object is the same announcement in six
                // different dialogs. Naming the title is what separates them.
                accessibilityLabel={`${action.label}, ${shown?.title ?? ''}`}
                variant={variantFor(action, ordinary)}
                // Stacked actions are the ones that name something longer than
                // a verb. Inline pairs are already capped at twelve characters.
                marquee={!inline}
                fullWidth={!inline}
                // `current`, not `shown`: the two agree whenever the dialog is
                // actually open, and during the fade-out `current` is already
                // null, which is what makes the closing card inert to a second
                // tap. `settleDialog` refuses a repeat anyway; this stops the
                // press from reaching it.
                onPress={() => current && settleDialog(current, index)}
                style={inline ? styles.inlineAction : undefined}
              />
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function cancelRank(action: DialogAction, inline: boolean): number {
  const isCancel = action.style === 'cancel';
  if (!isCancel) return inline ? 1 : 0;
  return inline ? 0 : 1;
}

function variantFor(action: DialogAction, ordinary: number): ButtonVariant {
  switch (action.style) {
    case 'cancel':
      return 'ghost';
    case 'destructive':
      return 'danger';
    case 'confirm':
      return 'success';
    default:
      return ordinary > 1 ? 'secondary' : 'primary';
  }
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.md,
  },
  actions: { gap: spacing.sm, marginTop: spacing.xs },
  inline: { flexDirection: 'row' },
  inlineAction: { flex: 1 },
  stacked: { flexDirection: 'column' },
});
