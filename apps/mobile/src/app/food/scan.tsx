/**
 * Barcode scanner: point at a packet, land on the portion screen with it.
 *
 * The first readable code locks the scanner. A camera reports the same code
 * many times a second while it stays in frame, and without the lock each of
 * those would fire its own lookup and push its own portion screen. The lock is
 * a ref rather than state because it has to hold between two callbacks that
 * arrive inside the same frame, before any re-render could publish it.
 *
 * The lookup goes through the server, which checks the user's own foods first
 * (a food they created for this barcode last week wins over whatever
 * OpenFoodFacts says) and only then asks OpenFoodFacts.
 */

import { Ionicons } from '@expo/vector-icons';
import type { Meal } from '@lift/shared';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Text } from '@/components/ui';
import { haptics } from '@/features/feedback/haptics';
import { nutritionApi } from '@/features/nutrition/api';
import { todayIso } from '@/features/nutrition/dates';
import { useFoodDraft } from '@/features/nutrition/draft';
import { describeError } from '@/features/nutrition/queries';
import { HIT_SLOP, radius, spacing, stroke } from '@/theme';

/** The formats food packaging actually carries. Fewer types means faster, surer decoding. */
const FOOD_BARCODES = ['ean13', 'ean8', 'upc_a', 'upc_e'] as const;

const MEALS: readonly Meal[] = ['breakfast', 'lunch', 'dinner', 'snacks'];

/**
 * The scanner is always dark, whatever the theme: it is a camera feed with
 * chrome on top, and light chrome over a live picture is unreadable half the
 * time. These are the only colours on this screen for that reason.
 */
const INK = '#FFFFFF';
const DIM = 'rgba(0, 0, 0, 0.55)';

type Phase =
  | { kind: 'scanning' }
  | { kind: 'looking'; code: string }
  | { kind: 'missing'; code: string }
  | { kind: 'failed'; code: string; message: string };

export default function ScanScreen() {
  const params = useLocalSearchParams<{ date?: string; meal?: string; for?: string }>();
  const date = params.date ?? todayIso();
  const meal: Meal = MEALS.includes(params.meal as Meal) ? (params.meal as Meal) : 'snacks';
  const forTemplate = params.for === 'template';

  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'scanning' });
  const locked = useRef(false);

  const lookUp = useCallback(
    async (code: string) => {
      setPhase({ kind: 'looking', code });
      try {
        const { food } = await nutritionApi.barcode(code);
        if (!food) {
          haptics.rejected();
          setPhase({ kind: 'missing', code });
          return;
        }
        const { setPortion } = useFoodDraft.getState();
        setPortion(
          forTemplate
            ? { kind: 'template-item', food, item: null, index: null }
            : { kind: 'food', food, target: { date, meal } },
        );
        router.replace('/food/portion');
      } catch (error) {
        haptics.rejected();
        setPhase({ kind: 'failed', code, message: describeError(error) });
      }
    },
    [date, meal, forTemplate],
  );

  const onScanned = useCallback(
    ({ data }: BarcodeScanningResult) => {
      if (locked.current) return;
      const code = data.trim();
      if (!/^\d{6,14}$/.test(code)) return;
      locked.current = true;
      haptics.added();
      void lookUp(code);
    },
    [lookUp],
  );

  const scanAgain = () => {
    setPhase({ kind: 'scanning' });
    locked.current = false;
  };

  const header = <Stack.Screen options={{ headerShown: false }} />;

  const close = (
    <Pressable
      onPress={() => router.back()}
      hitSlop={HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel="Close scanner"
      style={[styles.roundButton, { top: insets.top + spacing.md, left: spacing.lg }]}
    >
      <Ionicons name="close" size={24} color={INK} />
    </Pressable>
  );

  if (!permission) {
    return (
      <View style={styles.root}>
        {header}
        <ActivityIndicator color={INK} />
      </View>
    );
  }

  if (!permission.granted) {
    // `canAskAgain` false means Android will not show the prompt again, so the
    // only way forward is the system settings page.
    return (
      <View style={[styles.root, styles.centered]}>
        {header}
        {close}
        <Ionicons name="camera-outline" size={44} color={INK} style={styles.permissionIcon} />
        <Text variant="heading" align="center" style={styles.light}>
          Camera access is off
        </Text>
        <Text variant="body" align="center" style={styles.lightMuted}>
          Lift needs the camera to read barcodes. Nothing is recorded or kept.
        </Text>
        <Button
          title={permission.canAskAgain ? 'Allow camera' : 'Open settings'}
          onPress={() => (permission.canAskAgain ? void requestPermission() : void Linking.openSettings())}
          style={styles.permissionButton}
        />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {header}
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: [...FOOD_BARCODES] }}
        onBarcodeScanned={phase.kind === 'scanning' ? onScanned : undefined}
      />

      {/* The viewfinder: a clear window in a dimmed frame, so it is obvious where the code goes. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View style={[styles.dim, styles.flex]} />
        <View style={styles.windowRow}>
          <View style={[styles.dim, styles.flex]} />
          <View style={styles.window}>
            <View style={[styles.corner, styles.topLeft]} />
            <View style={[styles.corner, styles.topRight]} />
            <View style={[styles.corner, styles.bottomLeft]} />
            <View style={[styles.corner, styles.bottomRight]} />
          </View>
          <View style={[styles.dim, styles.flex]} />
        </View>
        <View style={[styles.dim, styles.flex, styles.hintArea]}>
          <Text variant="body" align="center" style={styles.lightMuted}>
            {phase.kind === 'looking' ? 'Looking it up…' : 'Line up the barcode inside the frame'}
          </Text>
        </View>
      </View>

      {close}
      <Pressable
        onPress={() => setTorch((on) => !on)}
        hitSlop={HIT_SLOP}
        accessibilityRole="switch"
        accessibilityState={{ checked: torch }}
        accessibilityLabel="Torch"
        style={[styles.roundButton, { top: insets.top + spacing.md, right: spacing.lg }]}
      >
        <Ionicons name={torch ? 'flash' : 'flash-off'} size={22} color={INK} />
      </Pressable>

      {phase.kind === 'looking' && (
        <View style={styles.lookingSpinner} pointerEvents="none">
          <ActivityIndicator color={INK} size="large" />
        </View>
      )}

      {(phase.kind === 'missing' || phase.kind === 'failed') && (
        <View style={[styles.panel, { paddingBottom: insets.bottom + spacing.lg }]}>
          <Text variant="heading" style={styles.light}>
            {phase.kind === 'missing' ? 'Not in the database' : 'Could not look it up'}
          </Text>
          <Text variant="body" style={styles.lightMuted}>
            {phase.kind === 'missing'
              ? `Nobody has added barcode ${phase.code} yet. Enter it from the label once and it will scan from then on.`
              : phase.message}
          </Text>
          <View style={styles.panelActions}>
            {phase.kind === 'missing' ? (
              <Button
                title="Create this food"
                icon="create-outline"
                fullWidth
                onPress={() =>
                  router.replace({
                    pathname: '/food/create',
                    params: { date, meal, barcode: phase.code, ...(forTemplate ? { for: 'template' } : {}) },
                  })
                }
              />
            ) : (
              <Button title="Try again" icon="refresh" fullWidth onPress={() => void lookUp(phase.code)} />
            )}
            <Button title="Scan again" variant="secondary" fullWidth onPress={scanAgain} />
          </View>
        </View>
      )}
    </View>
  );
}

const WINDOW_WIDTH = 280;
const WINDOW_HEIGHT = 180;
const CORNER = 26;
const CORNER_STROKE = 3;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000', justifyContent: 'center', alignItems: 'center' },
  centered: { paddingHorizontal: spacing.xxl, gap: spacing.md },
  flex: { flex: 1, alignSelf: 'stretch' },
  light: { color: INK },
  lightMuted: { color: 'rgba(255, 255, 255, 0.75)' },
  permissionIcon: { marginBottom: spacing.sm },
  permissionButton: { marginTop: spacing.lg },
  dim: { backgroundColor: DIM },
  windowRow: { flexDirection: 'row', height: WINDOW_HEIGHT, alignSelf: 'stretch' },
  window: { width: WINDOW_WIDTH, height: WINDOW_HEIGHT },
  hintArea: { paddingTop: spacing.xl, paddingHorizontal: spacing.xxl },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: INK },
  topLeft: { top: 0, left: 0, borderTopWidth: CORNER_STROKE, borderLeftWidth: CORNER_STROKE, borderTopLeftRadius: radius.md },
  topRight: { top: 0, right: 0, borderTopWidth: CORNER_STROKE, borderRightWidth: CORNER_STROKE, borderTopRightRadius: radius.md },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_STROKE,
    borderLeftWidth: CORNER_STROKE,
    borderBottomLeftRadius: radius.md,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_STROKE,
    borderRightWidth: CORNER_STROKE,
    borderBottomRightRadius: radius.md,
  },
  roundButton: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: DIM,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lookingSpinner: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#161616',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: stroke.rule,
    borderColor: '#2A2A2A',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  panelActions: { gap: spacing.sm, marginTop: spacing.md },
});
