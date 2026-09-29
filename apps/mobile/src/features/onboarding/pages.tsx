/**
 * The four questions, and nothing about how they are presented.
 *
 * Each page here owns one question and the control that answers it. The
 * heading, the button, the progress rule, the skip and the order are all the
 * shell's (`flow.tsx`), which is what keeps these four short enough to read at
 * once and stops a page inventing its own layout.
 *
 * Two of them write nothing: the welcome asks nothing, and the import hands off
 * to a screen that already exists rather than growing a second copy of it here.
 * That leaves exactly two settings this flow can change, which is about right
 * for something that appears before anybody has used the app.
 */

import { fromDisplayWeight, WEIGHT_UNITS, type WeightUnit } from '@lift/shared';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { NumericField, SegmentedControl, Text } from '@/components/ui';
import { recordBodyweight } from '@/features/measurements/repository';
import { useSettings } from '@/store/settings';
import { radius, spacing } from '@/theme';

import type { OnboardingPage, PageProps } from './flow';

/**
 * Registers a page's write with the shell, and takes it back on unmount.
 *
 * From an effect rather than during render, and the cleanup is the half that
 * matters: a page that is skipped rather than confirmed unmounts with its write
 * still registered, and without the cleanup the *next* page's button would
 * apply it. Depending on `commit` means a field's current value is always what
 * is registered, because the closure is rebuilt on every keystroke.
 */
function useCommit(
  onCommit: PageProps['onCommit'],
  commit: (() => void | Promise<void>) | null,
): void {
  useEffect(() => {
    onCommit(commit);
    return () => onCommit(null);
  }, [onCommit, commit]);
}

// ---------------------------------------------------------------------------
// 1. Welcome
// ---------------------------------------------------------------------------

/**
 * The one page that asks nothing, and the only one that could be cut.
 *
 * It earns its place by being the answer to "what is this and how long is
 * this going to take", which is the question somebody actually has on the first
 * frame of an app they installed a minute ago. Saying "three questions, all
 * optional" up front is also what makes the Skip in the corner read as an
 * offer rather than as a way out of something.
 *
 * No control, so nothing is rendered below the copy. The shell leaves the slot
 * out entirely rather than drawing an empty one.
 */
const welcome: OnboardingPage = {
  key: 'welcome',
  title: 'Lift',
  detail:
    'A training log that stays on this phone. Three questions before you start, and every one of them is optional.',
  action: 'Get started',
};

// ---------------------------------------------------------------------------
// 2. Units
// ---------------------------------------------------------------------------

const UNIT_OPTIONS = WEIGHT_UNITS.map((value) => ({
  value,
  label: value === 'kg' ? 'Kilograms' : 'Pounds',
}));

/**
 * The highest-value question in the flow, and a one-tap answer.
 *
 * Every weight in the app is stored in kilograms and rendered through this, so
 * getting it wrong does not corrupt anything: it just means an American reads
 * their whole log in a unit they do not think in until they find the setting.
 * Asking once costs a tap and removes that entirely.
 */
function UnitsPage() {
  const weightUnit = useSettings((state) => state.weightUnit);
  const update = useSettings((state) => state.update);

  /*
   * Written on tap rather than on the button, which is why this page registers
   * no commit at all.
   *
   * A segmented control is not a field being filled in, it is a switch being
   * thrown: it already shows the answer, and holding the write until Continue
   * would mean the two visible states of this page disagree about what the app
   * thinks. It also makes Skip and Continue do the same thing here, which is
   * correct rather than a shortcut. There is nothing on this page to skip; the
   * value was already chosen, or already the default.
   */
  const choose = (next: WeightUnit) => {
    update('weightUnit', next);

    /*
     * The other two units follow, and only here.
     *
     * `update` deliberately does not do this. Changing the weight unit on the
     * settings screen sits three rows above a distance unit the user can see
     * and has possibly already set, and quietly rewriting it there would be the
     * app overruling a choice somebody made on purpose. On this page nobody has
     * made any choice yet: these are the defaults a brand-new install starts
     * with, and a lifter who thinks in pounds does not think in kilometres.
     *
     * The barbell comes along too, but that is `update`'s own doing and it
     * happens everywhere: 20 kg and 45 lb are different bars, not one bar
     * described twice.
     */
    const imperial = next === 'lb';
    update('distanceUnit', imperial ? 'mi' : 'km');
    update('measurementUnit', imperial ? 'in' : 'cm');
  };

  return (
    <SegmentedControl
      options={UNIT_OPTIONS}
      value={weightUnit}
      onChange={choose}
      label="Weight unit"
      style={styles.fullWidth}
    />
  );
}

const units: OnboardingPage = {
  key: 'units',
  title: 'Kilograms or pounds?',
  detail: 'Every weight you read, and every one you type. Changeable later in Settings.',
  action: 'Continue',
  render: () => <UnitsPage />,
};

// ---------------------------------------------------------------------------
// 3. Bodyweight
// ---------------------------------------------------------------------------

/**
 * The only typed answer in the flow, and the only one that writes to a table.
 *
 * Filed as a measurement rather than straight into settings, exactly as the
 * Body settings screen does it: the repository mirrors it back into the store,
 * and this way the number also becomes the first point on the bodyweight chart
 * instead of a second figure that quietly disagrees with it.
 */
function BodyweightPage({ onCommit }: PageProps) {
  const weightUnit = useSettings((state) => state.weightUnit);
  const [text, setText] = useState('');

  // Parsed here rather than in the commit so the guard and the field agree
  // about what an empty box means: nothing to write, not a zero.
  const parsed = text.trim() === '' ? null : Number(text.replace(',', '.'));
  const usable = parsed !== null && Number.isFinite(parsed) && parsed > 0;

  const commit = useCallback(async () => {
    // Re-checked rather than trusted from the closure's own guard below:
    // narrowing does not survive into a callback, and this is the line that
    // decides what lands in the measurement log.
    if (parsed === null || !Number.isFinite(parsed) || parsed <= 0) return;
    // Not awaited by the shell, and it does not need to be: the repository
    // mirrors into the settings store as soon as the row lands, and nothing on
    // the page after this one reads a bodyweight.
    await recordBodyweight(fromDisplayWeight(parsed, weightUnit));
  }, [parsed, weightUnit]);

  // Null while the box is empty, so Continue on an untouched field is exactly
  // Skip. Leaving a live commit registered would file a zero-weight entry the
  // user never typed.
  useCommit(onCommit, usable ? commit : null);

  return (
    <View style={styles.weighIn}>
      <NumericField
        value={text}
        onChangeText={setText}
        placeholder="0"
        accessibilityLabel={`Bodyweight in ${weightUnit}`}
        // The set row's field is 34pt because four of them share a row. This
        // one is the only thing on the page, so it takes a control's full
        // height and the figure is set at the size a single answer deserves.
        //
        // Size only. `NumericField` spreads this last, so a colour set here
        // would win over its own focus ring, and the ring is the whole of how
        // a typed field says the keyboard is pointed at it.
        style={styles.weighInField}
      />
      <Text variant="subheading" color="textSecondary">
        {weightUnit}
      </Text>
    </View>
  );
}

const bodyweight: OnboardingPage = {
  key: 'bodyweight',
  title: 'What do you weigh?',
  detail:
    'Push-ups, pull-ups and dips are valued at this. Without it they count as zero volume.',
  action: 'Continue',
  render: (props) => <BodyweightPage {...props} />,
};

// ---------------------------------------------------------------------------
// 4. History
// ---------------------------------------------------------------------------

/**
 * The page that decides whether somebody starts at zero.
 *
 * It opens `/import`, which already reads every format this app understands,
 * matches exercise names against the catalogue and asks about the ones it
 * cannot place. None of that belongs here: an onboarding page that grew its own
 * file picker would be a second, worse copy of a screen that is one push away.
 *
 * Pushing is the whole of what this page does. Finishing the flow is the
 * shell's job and happens in the same tick, which is what leaves the import
 * screen sitting on the dashboard rather than on a welcome page: backing out of
 * an import lands somewhere the user can use, not back at the start of a flow
 * they have already been through.
 */
function HistoryPage({ onCommit }: PageProps) {
  const router = useRouter();

  const commit = useCallback(() => {
    router.push('/import');
  }, [router]);

  useCommit(onCommit, commit);

  return (
    <Text variant="caption" color="textTertiary" align="center">
      Your file is read on this device. Nothing is uploaded.
    </Text>
  );
}

const history: OnboardingPage = {
  key: 'history',
  title: 'Coming from another app?',
  detail: 'Lift reads exports from Hevy, Strong and Lyfta, and its own backup files.',
  action: 'Choose a file',
  render: (props) => <HistoryPage {...props} />,
};

// ---------------------------------------------------------------------------

/**
 * The flow, in order.
 *
 * Units before bodyweight because the second page's field is labelled in the
 * unit the first page chose, and history last because it is the one page that
 * leaves: whatever it does, there is nothing sensible to ask afterwards.
 */
export const PAGES: readonly OnboardingPage[] = [welcome, units, bodyweight, history];

const styles = StyleSheet.create({
  fullWidth: { width: '100%' },
  weighIn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  weighInField: {
    width: 140,
    height: 56,
    fontSize: 28,
    borderRadius: radius.md,
    // Overrides the set row's tight horizontal padding, which exists to fit a
    // four-digit weight into a column and has nothing to do with this field.
    paddingHorizontal: spacing.md,
  },
});
