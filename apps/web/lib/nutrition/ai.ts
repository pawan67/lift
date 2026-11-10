/**
 * AI calorie and macro estimates in the browser.
 *
 * On the phone the provider key lives in the device's secure store and never
 * leaves it. The web app follows the same rule in its own way: the key is kept
 * in this browser's localStorage, under `lift-web-ai`, and is never sent to
 * the Lift server. Requests go straight from the page to the provider, built
 * by the same `buildRequest` the phone uses. Anthropic refuses a browser's
 * preflight unless it carries `anthropic-dangerous-direct-browser-access`,
 * which `buildRequest` already sends; OpenAI-compatible servers answer CORS
 * on their own.
 *
 * What to ask and how to read the answer (`buildFoodEstimateRequest`,
 * `parseFoodEstimate`) are shared with the phone, so both estimate the same
 * way and both drop invented nutrient keys the same way.
 */

"use client";

import {
  DEFAULT_AI_MODELS,
  buildFoodEstimateRequest,
  estimateConfigFor,
  estimateProgress,
  buildRequest,
  createSseDecoder,
  parseFoodEstimate,
  type AiConfig,
  type AiImage,
  type AiProvider,
  type CustomNutrient,
  type FoodEstimate,
  type SseEvent,
} from "@lift/shared";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface AiSetup {
  provider: AiProvider;
  /** Empty means `DEFAULT_AI_MODELS` for the provider. */
  model: string;
  /** Origin only, empty means the provider's own. Only shown for OpenAI-compatible. */
  baseUrl: string;
  apiKey: string;
}

interface AiSetupStore extends AiSetup {
  save: (setup: AiSetup) => void;
  forget: () => void;
}

const EMPTY: AiSetup = { provider: "anthropic", model: "", baseUrl: "", apiKey: "" };

export const useAiSetup = create<AiSetupStore>()(
  persist(
    (set) => ({
      ...EMPTY,
      save: (setup) => set({ ...setup, model: setup.model.trim(), baseUrl: setup.baseUrl.trim(), apiKey: setup.apiKey.trim() }),
      forget: () => set(EMPTY),
    }),
    {
      name: "lift-web-ai",
      partialize: ({ provider, model, baseUrl, apiKey }) => ({ provider, model, baseUrl, apiKey }),
    },
  ),
);

function configOf(setup: AiSetup): AiConfig | null {
  if (!setup.apiKey) return null;
  return {
    provider: setup.provider,
    model: setup.model || DEFAULT_AI_MODELS[setup.provider],
    apiKey: setup.apiKey,
    baseUrl: setup.baseUrl || undefined,
  };
}

/** A failure worded for the person looking at the dialog, not for a log. */
export class EstimateError extends Error {
  constructor(
    message: string,
    readonly aborted = false,
  ) {
    super(message);
    this.name = "EstimateError";
  }
}

function messageFor(status: number, body: string): string {
  if (status === 401 || status === 403) return "The provider rejected the key. Check it in AI settings.";
  if (status === 429) return "The provider is rate limiting this key. Wait a moment and try again.";
  if (status >= 500) return "The AI provider is having trouble. Try again in a moment.";
  if (status === 400 && /image|vision/i.test(body)) return "This model cannot read photos. Remove the photo or pick a vision model.";
  if (status === 404) return "The provider did not recognise that model or address. Check AI settings.";
  return `The provider refused the request (${status}).`;
}

export async function estimateFood(input: {
  description: string;
  image: AiImage | null;
  customNutrients: readonly CustomNutrient[];
  signal?: AbortSignal;
  /** Foods started so far, as the reply streams in. A long meal takes a while. */
  onProgress?: (found: number) => void;
}): Promise<FoodEstimate> {
  const config = configOf(useAiSetup.getState());
  if (!config) throw new EstimateError("Set up AI first: pick a provider and paste your key.");

  // On Cerebras a photo goes to its vision model; gpt-oss reads text only.
  const sent = estimateConfigFor(config, !!input.image);
  const wire = buildRequest(sent, buildFoodEstimateRequest(input));

  let response: Response;
  try {
    response = await fetch(wire.url, { method: "POST", headers: wire.headers, body: wire.body, signal: input.signal });
  } catch {
    if (input.signal?.aborted) throw new EstimateError("Stopped.", true);
    throw new EstimateError("Could not reach the AI provider. Check the connection and the address in AI settings.");
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new EstimateError(messageFor(response.status, body));
  }
  if (!response.body) throw new EstimateError("The provider sent no answer.");

  const text = await readAll(config, response.body, input.signal, input.onProgress);
  try {
    return parseFoodEstimate(text, input.customNutrients);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "The answer could not be read.";
    throw new EstimateError(
      /cut off/.test(message) ? `${message} Try a shorter description, or one meal at a time.` : message,
    );
  }
}

/**
 * Collects the streamed answer. Streaming is not shown here, the estimate is
 * only useful whole, but asking for a stream keeps one code path with the
 * phone and lets a slow model's reply arrive without a proxy timing it out.
 */
async function readAll(
  config: AiConfig,
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
  onProgress?: (found: number) => void,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const sse = createSseDecoder(config);
  let answer = "";
  let found = 0;

  const apply = (event: SseEvent): boolean => {
    if (event.kind === "delta") {
      answer += event.text;
      const now = estimateProgress(answer);
      if (now !== found) {
        found = now;
        onProgress?.(found);
      }
      return false;
    }
    if (event.kind === "error") throw new EstimateError(event.message || "The provider stopped with an error.");
    return event.kind === "done";
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // `stream: true` keeps a character split across two chunks intact.
      for (const event of sse.push(decoder.decode(value, { stream: true }))) {
        if (apply(event)) return answer;
      }
    }
    for (const event of sse.flush()) if (apply(event)) break;
    return answer;
  } catch (cause) {
    if (signal?.aborted) throw new EstimateError("Stopped.", true);
    throw cause instanceof EstimateError ? cause : new EstimateError("The answer was cut off. Try again.");
  } finally {
    reader.releaseLock();
  }
}

const MAX_EDGE = 1024;
const JPEG_QUALITY = 0.75;

/**
 * A photo, shrunk before it goes anywhere.
 *
 * A phone photo is 4000 px and several megabytes; providers cap an image at a
 * few, and a model reads a plate just as well at 1024 px. Re-encoding as JPEG
 * also turns a HEIC or a PNG screenshot into a type every provider takes.
 */
export async function fileToAiImage(file: File): Promise<AiImage> {
  if (!file.type.startsWith("image/")) throw new EstimateError("That file is not an image.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new EstimateError("This browser cannot open that image. Try a JPEG or PNG.");
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new EstimateError("Could not prepare the image.");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  return { mediaType: "image/jpeg", data: dataUrl.slice(dataUrl.indexOf(",") + 1) };
}
