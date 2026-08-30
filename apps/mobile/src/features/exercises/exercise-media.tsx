import { Ionicons } from '@expo/vector-icons';
import { useEventListener } from 'expo';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { haptics } from '@/features/feedback/haptics';
import { HIT_SLOP, radius, spacing, useColors } from '@/theme';

import { initialsFor } from './exercise-thumbnail';
import { openYoutubeHowTo, youtubeHowToQuery } from './youtube';

export interface ExerciseMediaProps {
  name: string;
  thumbnailUrl?: string | null;
  videoUrl?: string | null;
  /**
   * Start the clip as soon as this mounts. The demo sheet sets it: the user
   * already tapped the still, and a second tap on the same picture is one too
   * many. The exercise page leaves it off so opening the page does not spend
   * mobile data on a clip nobody asked to watch.
   */
  autoplay?: boolean;
}

/**
 * What the frame is shaped like before anything has loaded and reported its own
 * dimensions. The catalog's artwork is squarish, so this is the shape the panel
 * settles into most often and the one that moves least on arrival.
 */
const FALLBACK_RATIO = 4 / 3;

/**
 * How far the panel will follow an asset's own proportions.
 *
 * The point of measuring is that a 1:1 clip should not be letterboxed into a
 * 4:3 box and a 16:9 one should not be pillarboxed into it. The point of the
 * clamp is that the panel still has to be a panel: a catalog entry with a
 * mistyped 3000×200 asset would otherwise render as a hairline, and a portrait
 * one would push everything below it off the screen.
 */
const MIN_RATIO = 0.7;
const MAX_RATIO = 2;

/**
 * The demonstration panel at the top of an exercise's detail screen.
 *
 * The still is shown first and the clip is only fetched once tapped, unless
 * `autoplay` is set. The catalog's clips are 300–450KB each; autoplaying one
 * on every screen open would spend a few hundred KB of someone's mobile data
 * to answer a question the still usually already answers.
 *
 * The frame takes its shape from whatever it is showing rather than imposing
 * one. It used to be a hard 4:3, which is right for the catalog's own artwork
 * and wrong for everything else in it: a 1:1 clip arrived with plate down both
 * sides, and a wide one sat letterboxed with the figure shrunk to fit a box it
 * did not need. Both the still and the clip report their natural size once
 * loaded (`onLoad` for the image, `sourceLoad` for the player) and the frame
 * adopts it, clamped to the range above.
 */
export function ExerciseMedia({ name, thumbnailUrl, videoUrl, autoplay = false }: ExerciseMediaProps) {
  const colors = useColors();
  const [playing, setPlaying] = useState(() => Boolean(autoplay && videoUrl));
  const [ratio, setRatio] = useState<number | null>(null);

  // Hooks cannot be conditional, so the player is always created and simply
  // holds a null source until the user asks for the clip.
  const player = useVideoPlayer(playing && videoUrl ? videoUrl : null, (instance) => {
    // Short silent demo loops. Looping is the expected behaviour, and there is
    // no audio track to interrupt whatever the user is listening to.
    instance.loop = true;
    instance.muted = true;
    instance.play();
  });

  // The clip's shape wins over the still's once it is known: they come from the
  // same catalog entry and normally agree, but if they don't, the thing on
  // screen is the one that should be fitted.
  useEventListener(player, 'sourceLoad', ({ availableVideoTracks }) => {
    const size = availableVideoTracks[0]?.size;
    if (size) setRatio(clampRatio(size.width / size.height));
  });

  const frame = [styles.frame, { aspectRatio: ratio ?? FALLBACK_RATIO }];

  return (
    <View style={[frame, { backgroundColor: colors.mediaPlate }]}>
      {playing && videoUrl ? (
        <VideoView
          player={player}
          style={styles.fill}
          // Still `contain` even though the frame now matches the source. The
          // two agree to within a pixel of rounding, and `cover` would spend
          // that pixel cropping the figure's feet.
          contentFit="contain"
          nativeControls={false}
        />
      ) : (
        <Pressable
          accessibilityRole={videoUrl ? 'button' : 'image'}
          accessibilityLabel={videoUrl ? `Play ${name} demonstration` : name}
          disabled={!videoUrl}
          onPress={() => setPlaying(true)}
          style={styles.fill}
        >
          {thumbnailUrl ? (
            <Image
              source={{ uri: thumbnailUrl }}
              style={styles.fill}
              contentFit="contain"
              cachePolicy="disk"
              transition={160}
              onLoad={(event) =>
                setRatio((current) =>
                  // Never overrides a size the clip has already reported.
                  current ?? clampRatio(event.source.width / event.source.height),
                )
              }
              accessibilityIgnoresInvertColors
            />
          ) : (
            <View style={styles.fallback}>
              <Text variant="display" style={{ color: colors.textTertiary }}>
                {initialsFor(name)}
              </Text>
            </View>
          )}

          {videoUrl && (
            <View style={styles.playBadge} pointerEvents="none">
              <View style={[styles.playCircle, { backgroundColor: colors.overlay }]}>
                <Ionicons name="play" size={26} color="#FFFFFF" style={styles.playGlyph} />
              </View>
              <Text variant="caption" style={styles.playLabel}>
                Watch demo
              </Text>
            </View>
          )}
        </Pressable>
      )}
      <YoutubeHowTo name={name} />
    </View>
  );
}

/** Compact chip on the artwork: YouTube icon and "How to". */
function YoutubeHowTo({ name }: { name: string }) {
  const query = youtubeHowToQuery(name);

  return (
    <Pressable
      onPress={() => {
        haptics.selection();
        void openYoutubeHowTo(name);
      }}
      hitSlop={HIT_SLOP}
      accessibilityRole="link"
      accessibilityLabel={`Search YouTube for ${query}`}
      accessibilityHint="Opens the YouTube app"
      style={({ pressed }) => [styles.youtube, pressed && styles.youtubePressed]}
    >
      <Ionicons name="logo-youtube" size={14} color="#FF0000" />
      <Text variant="caption" style={styles.youtubeLabel}>
        How to
      </Text>
    </Pressable>
  );
}

/** A reported width/height, guarded against zero and against absurd extremes. */
function clampRatio(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return FALLBACK_RATIO;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, value));
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    borderRadius: radius.lg,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fill: { width: '100%', height: '100%' },
  fallback: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBadge: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  playCircle: {
    width: 62,
    height: 62,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The glyph is optically left-heavy inside a circle; a nudge right centres it.
  playGlyph: { marginLeft: 3 },
  playLabel: {
    color: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  youtube: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    zIndex: 2,
    elevation: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  youtubePressed: { opacity: 0.7 },
  youtubeLabel: { color: '#FFFFFF' },
});
