import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type TextInputProps,
} from 'react-native';

import { radius, spacing, useColors } from '@/theme';

import { Button } from './button';
import { TextField } from './input';
import { Text } from './text';

export interface PromptModalProps {
  visible: boolean;
  title: string;
  message?: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  maxLength?: number;
  multiline?: boolean;
  /**
   * Keyboard behaviour for fields that are not prose.
   *
   * An API key, a base URL or a model name are all strings a phone keyboard
   * will happily capitalise and autocorrect into something that no longer
   * works, and the user cannot see that it did it. The default is unset, which
   * is right for the rename dialogs this started as.
   */
  inputProps?: Pick<
    TextInputProps,
    'autoCapitalize' | 'autoCorrect' | 'autoComplete' | 'keyboardType' | 'spellCheck'
  >;
  /**
   * Allow saving an empty value.
   *
   * Off by default: an empty routine name is not a rename. On for the settings
   * fields whose empty state is meaningful, where clearing the box is how the
   * user says "use the default".
   */
  allowEmpty?: boolean;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}

/**
 * Text-input dialog.
 *
 * React Native's `Alert.prompt` is iOS-only: on Android it silently does
 * nothing, which would make "rename routine" a dead button for most users. This
 * is the cross-platform replacement.
 */
export function PromptModal({
  visible,
  title,
  message,
  initialValue = '',
  placeholder,
  confirmLabel = 'Save',
  maxLength = 80,
  multiline = false,
  inputProps,
  allowEmpty = false,
  onCancel,
  onConfirm,
}: PromptModalProps) {
  const colors = useColors();
  const [value, setValue] = useState(initialValue);

  // Re-seeds each time the dialog opens, so a cancelled edit doesn't persist
  // into the next one. Adjusted during render against the props the value was
  // last seeded from, the way RestDurationSheet does it. An effect would do
  // the same job a commit later, painting the previous edit's text for a frame
  // before correcting it.
  const [seed, setSeed] = useState({ visible, initialValue });

  if (seed.visible !== visible || seed.initialValue !== initialValue) {
    setSeed({ visible, initialValue });
    if (visible) setValue(initialValue);
  }

  const trimmed = value.trim();
  const submittable = allowEmpty || trimmed.length > 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        {/*
          `accessible={false}` on both Pressables, deliberately.

          Pressable defaults to `accessible`, which collapses everything under
          it into one element, so the backdrop announced the whole dialog as a
          single button reading "Bodyweight Entered in kg Cancel Save", and
          neither the field nor either button could be reached. Tap-outside-to-
          dismiss has no screen reader equivalent here on purpose: Cancel is one
          swipe past the field, and Android's back gesture already routes to
          `onRequestClose`.
        */}
        <Pressable
          accessible={false}
          style={[styles.backdrop, { backgroundColor: colors.overlay }]}
          onPress={onCancel}
        >
          {/* Swallows taps inside the card so they don't dismiss the modal. */}
          <Pressable
            accessible={false}
            // Hides the screen behind the dialog from VoiceOver, so focus lands
            // on the heading when it opens and a swipe past Save comes back to
            // it rather than wandering into the list underneath.
            accessibilityViewIsModal
            style={[styles.card, { backgroundColor: colors.surfaceElevated }]}
            onPress={(event) => event.stopPropagation()}
          >
            <Text variant="subheading" accessibilityRole="header">
              {title}
            </Text>
            {message && (
              <Text variant="label" color="textSecondary">
                {message}
              </Text>
            )}

            <TextField
              value={value}
              onChangeText={setValue}
              placeholder={placeholder}
              autoFocus
              maxLength={maxLength}
              multiline={multiline}
              style={multiline ? styles.multiline : undefined}
              onSubmitEditing={() => submittable && onConfirm(trimmed)}
              returnKeyType="done"
              {...inputProps}
            />

            {/*
              Both buttons name what they act on. Out of context a screen reader
              announces the visible word alone, and "Save" or "Cancel" with no
              object is the same announcement in every dialog the app has.
            */}
            <View style={styles.actions}>
              <Button
                title="Cancel"
                accessibilityLabel={`Cancel, ${title}`}
                variant="ghost"
                onPress={onCancel}
                style={styles.action}
              />
              <Button
                title={confirmLabel}
                accessibilityLabel={`${confirmLabel}, ${title}`}
                disabled={!submittable}
                onPress={() => onConfirm(trimmed)}
                style={styles.action}
              />
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
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
  multiline: { height: 120, paddingTop: spacing.md, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  action: { flex: 1 },
});
