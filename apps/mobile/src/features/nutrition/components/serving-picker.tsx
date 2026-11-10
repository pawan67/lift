/**
 * Which size one serving is: the food's own sizes, the gram sizes, and any
 * size typed in, plus an editor for the selected one.
 *
 * Used by the add screen and by each item of an AI estimate, so a size the
 * model guessed ("1 large egg (50 g)") is corrected the same way as one from a
 * database: tap Edit, change the weight, and the figures follow. Typed fields
 * only, no wheels (see the time picker's header for why).
 */

import { Ionicons } from '@expo/vector-icons';
import { splitServingLabel, withGrams, type Serving, type ServingSize } from '@lift/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Chip, Text, TextField } from '@/components/ui';
import { haptics } from '@/features/feedback/haptics';
import { radius, spacing, useColors } from '@/theme';

interface Props {
  options: readonly Serving[];
  selectedId: string;
  onSelect: (serving: Serving) => void;
  /** The selected size renamed or given another weight. Figures scale by weight when both are known. */
  onResize: (size: ServingSize) => void;
  /** A size typed in. Only offered when some size knows its weight, since figures come from it. */
  onAdd?: (size: ServingSize) => void;
}

type Mode = { kind: 'edit' } | { kind: 'add' } | null;

export function ServingPicker({ options, selectedId, onSelect, onResize, onAdd }: Props) {
  const colors = useColors();
  const selected = options.find((option) => option.id === selectedId) ?? options[0]!;
  const canAdd = !!onAdd && options.some((option) => option.grams !== null && option.grams > 0);
  const [mode, setMode] = useState<Mode>(null);
  const [name, setName] = useState('');
  const [gramsText, setGramsText] = useState('');

  const open = (next: NonNullable<Mode>) => {
    haptics.selection();
    if (next.kind === 'edit') {
      const parts = splitServingLabel(selected.label);
      setName(parts.name);
      const grams = selected.grams ?? parts.grams;
      setGramsText(grams ? String(Math.round(grams * 10) / 10) : '');
    } else {
      setName('');
      setGramsText('');
    }
    setMode(next);
  };

  const gramsValue = gramsText.trim() === '' ? null : Number(gramsText.replace(',', '.'));
  const gramsValid = gramsValue === null || (Number.isFinite(gramsValue) && gramsValue > 0 && gramsValue <= 100_000);
  const canSave =
    gramsValid && (mode?.kind === 'add' ? gramsValue !== null : name.trim() !== '' || gramsValue !== null);

  const save = () => {
    if (!mode || !canSave) return;
    const label = withGrams(name.trim() || (mode.kind === 'add' ? '1 serving' : ''), gramsValue);
    haptics.selection();
    if (mode.kind === 'edit') onResize({ label, grams: gramsValue });
    else onAdd?.({ label, grams: gramsValue });
    setMode(null);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.chips}>
        {options.map((option) => (
          <Chip
            key={option.id}
            label={option.label}
            selected={option.id === selected.id}
            onPress={() => {
              if (option.id === selected.id) return;
              haptics.selection();
              setMode(null);
              onSelect(option);
            }}
          />
        ))}
        {canAdd ? (
          <Chip icon="add" label="Custom size" selected={mode?.kind === 'add'} onPress={() => open({ kind: 'add' })} />
        ) : null}
      </View>

      {mode ? (
        <View style={[styles.editor, { backgroundColor: colors.surfaceMuted }]}>
          <Text variant="label">{mode.kind === 'edit' ? `Edit ${selected.label}` : 'New serving size'}</Text>
          <View style={styles.fields}>
            <TextField
              label="Name"
              value={name}
              onChangeText={setName}
              placeholder={mode.kind === 'add' ? '1 container' : '1 serving'}
              maxLength={60}
              containerStyle={styles.nameField}
            />
            <TextField
              label="Weight (g)"
              value={gramsText}
              onChangeText={(text) => setGramsText(text.replace(/[^0-9.,]/g, ''))}
              keyboardType="decimal-pad"
              placeholder="50"
              error={gramsValid ? undefined : 'Check'}
              containerStyle={styles.gramsField}
            />
          </View>
          <Text variant="caption" color="textTertiary">
            {mode.kind === 'add'
              ? 'Figures are worked out from the weight.'
              : selected.grams
                ? 'Changing the weight scales the figures with it.'
                : 'Adding a weight lets you switch to grams.'}
          </Text>
          <View style={styles.actions}>
            <Button title="Cancel" variant="ghost" onPress={() => setMode(null)} style={styles.action} />
            <Button title={mode.kind === 'add' ? 'Add size' : 'Save size'} disabled={!canSave} onPress={save} style={styles.action} />
          </View>
        </View>
      ) : (
        <Pressable
          onPress={() => open({ kind: 'edit' })}
          style={styles.editLink}
          accessibilityRole="button"
          accessibilityLabel={`Edit serving size, ${selected.label}`}
        >
          <Ionicons name="create-outline" size={15} color={colors.accent} />
          <Text variant="label" color="accent">
            Edit size
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  editor: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg },
  fields: { flexDirection: 'row', gap: spacing.sm },
  nameField: { flex: 2 },
  gramsField: { flex: 1 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
  editLink: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start' },
});
