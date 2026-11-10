/**
 * The phone's half of AI food estimates: getting a photo small enough to send,
 * and turning one model reply into items the diary can log.
 *
 * The request goes out with the user's own key through the same client the
 * coach uses, so there is no server hop and no second place a key is stored.
 * The prompt and the parser live in `@lift/shared` (`nutrition/ai.ts`); this
 * file only wires them to the network and the camera.
 */

import {
  buildFoodEstimateRequest,
  estimateProgress,
  parseFoodEstimate,
  type AiImage,
  type CustomNutrient,
  type FoodEstimate,
} from '@lift/shared';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { requireAiConfig, streamCompletion } from '@/features/ai/client';
import { AiError } from '@/features/ai/errors';

export interface EstimateFoodInput {
  description: string;
  image: AiImage | null;
  customNutrients: readonly CustomNutrient[];
  signal?: AbortSignal;
  /** Foods started so far, called as the reply streams in. A long meal takes a while. */
  onProgress?: (found: number) => void;
}

/**
 * Asks the configured model what was eaten and parses its answer.
 *
 * Nothing is shown until the whole reply is in, since half a JSON object is
 * not something a person can review, but the stream does feed a count of foods
 * found so far, so a long description reads as progress rather than a hang. A reply the parser cannot use becomes `bad-response`
 * with the parser's own sentence as the detail, so the screen can say "try
 * describing it differently" rather than showing a stack trace.
 */
export async function estimateFood(input: EstimateFoodInput): Promise<FoodEstimate> {
  const config = await requireAiConfig();
  const request = buildFoodEstimateRequest({
    description: input.description,
    image: input.image,
    customNutrients: input.customNutrients,
  });

  let partial = '';
  let found = 0;
  const text = await streamCompletion(config, request, {
    onDelta: (delta) => {
      partial += delta;
      const now = estimateProgress(partial);
      if (now !== found) {
        found = now;
        input.onProgress?.(found);
      }
    },
    signal: input.signal,
  });

  try {
    return parseFoodEstimate(text, input.customNutrients);
  } catch (cause) {
    throw new AiError('bad-response', cause instanceof Error ? cause.message : undefined);
  }
}

/** Long edge, in pixels. Plenty to recognise a plate, and a few hundred kilobytes as JPEG. */
const MAX_EDGE = 1024;
const JPEG_QUALITY = 0.7;

/**
 * Takes or picks one photo and returns it shrunk and base64-encoded.
 *
 * Shrunk because a phone camera's 12 MP original is several megabytes of
 * base64, past what providers accept inline and slow to upload on a gym's
 * connection, and the extra detail does not improve a guess at a portion size.
 *
 * Resolves null when the user cancels or refuses permission: neither is an
 * error worth a dialog, the button simply did nothing.
 */
export async function pickMealPhoto(source: 'camera' | 'library'): Promise<AiImage | null> {
  const permission =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;

  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: false, quality: 1 };
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets[0]) return null;

  const asset = result.assets[0];
  const longEdge = Math.max(asset.width, asset.height);
  const context = ImageManipulator.manipulate(asset.uri);
  if (longEdge > MAX_EDGE) {
    // Only one dimension: the other follows from the aspect ratio.
    context.resize(asset.width >= asset.height ? { width: MAX_EDGE } : { height: MAX_EDGE });
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ base64: true, format: SaveFormat.JPEG, compress: JPEG_QUALITY });
  if (!saved.base64) return null;

  return { mediaType: 'image/jpeg', data: saved.base64 };
}
