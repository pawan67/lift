/**
 * When a session started, on iOS.
 *
 * Android's pickers are dialogs the platform opens on request (see
 * `pick-date-time`). On iOS the same library is a view that has to be laid out
 * somewhere, so it gets the card `WorkoutDurationSheet` uses: the two sheets
 * sit side by side on the save screen and should read as one pair.
 */

import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { Button, Text } from '@/components/ui';
import { radius, spacing, useColors, useTheme } from '@/theme';

export interface StartTimeSheetProps {
  visible: boolean;
  /** The start currently shown on the save screen. */
  value: Date;
  /** The latest start allowed: now. A session cannot have started in the future. */
  latest: Date;
  onCancel: () => void;
  onSave: (startedAt: Date) => void;
}

export function StartTimeSheet({ visible, value, latest, onCancel, onSave }: StartTimeSheetProps) {
  const colors = useColors();
  const { scheme } = useTheme();
  const [draft, setDraft] = useState(value);
  const [seed, setSeed] = useState({ visible, value });

  // Re-seeded each time the sheet opens, during render rather than in an
  // effect, for the reason `WorkoutDurationSheet` gives.
  if (seed.visible !== visible || seed.value !== value) {
    setSeed({ visible, value });
    if (visible) setDraft(value);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable
        accessible={false}
        style={[styles.backdrop, { backgroundColor: colors.overlay }]}
        onPress={onCancel}
      >
        <Pressable
          accessible={false}
          accessibilityViewIsModal
          style={[styles.card, { backgroundColor: colors.surfaceElevated }]}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={styles.heading}>
            <Text variant="subheading" accessibilityRole="header">
              Started
            </Text>
            <Text variant="label" color="textSecondary">
              When the session began. It ends that long after.
            </Text>
          </View>

          <DateTimePicker
            value={draft}
            mode="datetime"
            display="inline"
            maximumDate={latest}
            themeVariant={scheme}
            accentColor={colors.accent}
            onChange={(_event, picked) => {
              if (picked) setDraft(picked);
            }}
          />

          <View style={styles.actions}>
            <Button
              title="Cancel"
              variant="ghost"
              accessibilityLabel="Cancel, leave the start unchanged"
              onPress={onCancel}
              style={styles.action}
            />
            <Button
              title="Save"
              accessibilityLabel="Save the start time"
              onPress={() => onSave(draft.getTime() > latest.getTime() ? latest : draft)}
              style={styles.action}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
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
  heading: { gap: 2 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
});
