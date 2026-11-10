/**
 * Every nutrient as a typed field: the four core figures up top, everything
 * else folded beneath by group, custom nutrients last.
 *
 * Values are held as strings while editing, because "1." and "" are states a
 * person passes through while typing a number and neither parses to one. The
 * caller converts with `parseNutrientDraft` when it saves. Absent and empty
 * mean "not known", which is stored as a missing key, never as zero.
 */

import {
  BUILT_IN_NUTRIENTS,
  CORE_NUTRIENT_KEYS,
  NUTRIENT_GROUP_LABELS,
  type CustomNutrient,
  type NutrientDefinition,
  type NutrientGroup,
  type NutrientValues,
} from '@lift/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui';
import { font, fontSize, radius, spacing, stroke, useColors } from '@/theme';

export type NutrientDraft = Record<string, string>;

/** Figures to strings, trimmed of float dust, for an edit form. */
export function toNutrientDraft(values: NutrientValues): NutrientDraft {
  const out: NutrientDraft = {};
  for (const [key, value] of Object.entries(values)) out[key] = String(Math.round(value * 100) / 100);
  return out;
}

/** Strings back to figures. Blank or unparsable is dropped, so it reads as "not known". */
export function parseNutrientDraft(draft: NutrientDraft): NutrientValues {
  const out: NutrientValues = {};
  for (const [key, text] of Object.entries(draft)) {
    const value = Number(text.replace(',', '.'));
    if (text.trim() !== '' && Number.isFinite(value) && value >= 0) out[key] = value;
  }
  return out;
}

/** Which of the four core figures are missing, for a save button's validation. */
export function missingCore(draft: NutrientDraft): string[] {
  return CORE_NUTRIENT_KEYS.filter((key) => !(key in parseNutrientDraft({ [key]: draft[key] ?? '' })));
}

interface FieldProps {
  definition: NutrientDefinition;
  value: string;
  onChange: (value: string) => void;
  large?: boolean;
}

function NutrientField({ definition, value, onChange, large }: FieldProps) {
  const colors = useColors();
  const [focused, setFocused] = useState(false);
  return (
    <View
      style={[
        large ? styles.coreField : styles.row,
        large && {
          backgroundColor: colors.surfaceMuted,
          borderColor: focused ? colors.accent : colors.surfaceMuted,
        },
      ]}
    >
      <Text variant={large ? 'caption' : 'body'} color={large ? 'textSecondary' : 'text'} style={large ? undefined : styles.rowLabel}>
        {definition.label}
      </Text>
      <View style={styles.inputWrap}>
        <TextInput
          value={value}
          onChangeText={(text) => onChange(text.replace(/[^0-9.,]/g, ''))}
          keyboardType="decimal-pad"
          placeholder="–"
          placeholderTextColor={colors.textTertiary}
          selectTextOnFocus
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          accessibilityLabel={`${definition.label} in ${definition.unit}`}
          style={[
            large ? styles.coreInput : styles.rowInput,
            { color: colors.text },
            !large && {
              backgroundColor: colors.surfaceMuted,
              borderColor: focused ? colors.accent : colors.surfaceMuted,
            },
          ]}
        />
        <Text variant="caption" color="textTertiary" style={large ? styles.coreUnit : styles.rowUnit}>
          {definition.unit}
        </Text>
      </View>
    </View>
  );
}

interface Props {
  value: NutrientDraft;
  onChange: (next: NutrientDraft) => void;
  customNutrients: readonly CustomNutrient[];
  /** Open the "more nutrients" section from the start, e.g. when editing a food that has them. */
  expanded?: boolean;
}

const GROUP_ORDER: NutrientGroup[] = ['fats', 'carbs', 'minerals', 'vitamins'];

export function NutrientFields({ value, onChange, customNutrients, expanded: initiallyExpanded }: Props) {
  const colors = useColors();
  const extraKnown = Object.keys(value).some(
    (key) => !(CORE_NUTRIENT_KEYS as readonly string[]).includes(key) && value[key]?.trim(),
  );
  const [expanded, setExpanded] = useState(initiallyExpanded ?? extraKnown);

  const set = (key: string) => (text: string) => onChange({ ...value, [key]: text });
  const core = BUILT_IN_NUTRIENTS.filter((n) => (CORE_NUTRIENT_KEYS as readonly string[]).includes(n.key));

  return (
    <View style={styles.wrap}>
      <View style={styles.coreGrid}>
        {core.map((definition) => (
          <NutrientField
            key={definition.key}
            definition={definition}
            value={value[definition.key] ?? ''}
            onChange={set(definition.key)}
            large
          />
        ))}
      </View>

      <Pressable
        onPress={() => setExpanded((open) => !open)}
        style={styles.toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
      >
        <Text variant="label" color="accent">
          {expanded ? 'Fewer nutrients' : 'More nutrients'}
        </Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.accent} />
      </Pressable>

      {expanded && (
        <View style={styles.groups}>
          {GROUP_ORDER.map((group) => (
            <View key={group} style={styles.group}>
              <Text variant="overline" color="textTertiary">
                {NUTRIENT_GROUP_LABELS[group]}
              </Text>
              <View style={[styles.groupCard, { borderColor: colors.border }]}>
                {BUILT_IN_NUTRIENTS.filter((n) => n.group === group).map((definition) => (
                  <NutrientField
                    key={definition.key}
                    definition={definition}
                    value={value[definition.key] ?? ''}
                    onChange={set(definition.key)}
                  />
                ))}
              </View>
            </View>
          ))}
          {customNutrients.length > 0 && (
            <View style={styles.group}>
              <Text variant="overline" color="textTertiary">
                {NUTRIENT_GROUP_LABELS.custom}
              </Text>
              <View style={[styles.groupCard, { borderColor: colors.border }]}>
                {customNutrients.map((custom) => (
                  <NutrientField
                    key={custom.id}
                    definition={{
                      key: custom.id,
                      label: custom.name,
                      short: custom.name,
                      unit: custom.unit as NutrientDefinition['unit'],
                      group: 'custom',
                      decimals: 1,
                    }}
                    value={value[custom.id] ?? ''}
                    onChange={set(custom.id)}
                  />
                ))}
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  coreGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  coreField: {
    flexBasis: '47%',
    flexGrow: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    borderRadius: radius.lg,
    borderWidth: stroke.outline,
  },
  inputWrap: { flexDirection: 'row', alignItems: 'baseline' },
  coreInput: { flex: 1, fontSize: fontSize.xxl, ...font('bold'), paddingVertical: spacing.xs, fontVariant: ['tabular-nums'] },
  coreUnit: { marginLeft: spacing.xs },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start', paddingVertical: spacing.xs },
  groups: { gap: spacing.lg },
  group: { gap: spacing.sm },
  groupCard: { borderWidth: stroke.rule, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs, gap: spacing.md },
  rowLabel: { flex: 1 },
  rowInput: {
    width: 84,
    textAlign: 'right',
    fontSize: fontSize.md,
    ...font('semibold'),
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.sm,
    borderWidth: stroke.outline,
    fontVariant: ['tabular-nums'],
  },
  rowUnit: { width: 30 },
});
