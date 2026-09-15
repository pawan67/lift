/**
 * The one place in the app that talks to a model.
 *
 * Two things about it are load-bearing and neither is obvious from reading it.
 *
 * **`fetch` comes from `expo/fetch`, not from the global.** React Native's
 * global `fetch` is built on XMLHttpRequest and its response has no `body`, so a
 * streaming request made with it does not fail: it waits for the whole answer
 * and then hands it over at once. The bug that produces is a feature that looks
 * finished and feels broken, a minute of blank screen followed by a thousand
 * words appearing instantly, and it is invisible in code review. `expo/fetch` is
 * a WinterCG implementation with a real `ReadableStream` body on both native and
 * web.
 *
 * **Lines are reassembled before they are decoded.** Network chunks have nothing
 * to do with SSE frames: one `read()` routinely ends in the middle of a JSON
 * payload. Decoding per chunk would throw on the half, and the `catch` that
 * silences the throw looks like robustness while dropping a word out of the
 * middle of a sentence. So a buffer is carried across reads and only complete
 * lines are passed on. `packages/shared/src/ai/providers.ts` does the decoding
 * and is tested on exactly this.
 */

import {
  buildRequest,
  createSseDecoder,
  DEFAULT_AI_MODELS,
  type AiConfig,
  type AiRequest,
  type SseEvent,
} from '@lift/shared';
import { fetch } from 'expo/fetch';

import { AiError, detailFromBody, kindForStatus } from './errors';
import { readApiKey } from './key-storage';
import { useSettings } from '@/store/settings';

export interface StreamOptions {
  /** Called with each fragment, in order. Never with an empty string. */
  onDelta: (text: string) => void;
  signal?: AbortSignal;
}

/**
 * Reads the configured provider and its key.
 *
 * Returns null rather than throwing when nothing is set up, because "no key" is
 * an ordinary state every AI surface has to render around rather than an error
 * worth interrupting anyone with. Only an explicit attempt to ask a question
 * turns it into an `AiError`.
 */
export async function loadAiConfig(): Promise<AiConfig | null> {
  const settings = useSettings.getState();
  if (!settings.aiEnabled) return null;

  const apiKey = await readApiKey(settings.aiProvider);
  if (!apiKey) return null;

  return {
    provider: settings.aiProvider,
    model: settings.aiModel.trim() || DEFAULT_AI_MODELS[settings.aiProvider],
    apiKey,
    baseUrl: settings.aiBaseUrl.trim() || undefined,
  };
}

/** The same, but for a caller that is about to ask a question and must not proceed without one. */
export async function requireAiConfig(): Promise<AiConfig> {
  const config = await loadAiConfig();
  if (!config) throw new AiError('no-key');
  return config;
}

/**
 * Sends one request and streams the answer back.
 *
 * Resolves with the whole text, having already delivered it in pieces. Both,
 * rather than one or the other: the screen wants the pieces so it can paint, and
 * the caller wants the whole thing so it can store it without reassembling what
 * this function already had.
 */
export async function streamCompletion(
  config: AiConfig,
  request: AiRequest,
  options: StreamOptions,
): Promise<string> {
  const wire = buildRequest(config, request);

  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch(wire.url, {
      method: 'POST',
      headers: wire.headers,
      body: wire.body,
      signal: options.signal,
    });
  } catch (cause) {
    // An aborted request rejects here rather than resolving, and it is not a
    // failure: the user pressed stop.
    if (options.signal?.aborted) throw new AiError('aborted');
    throw new AiError('network', cause instanceof Error ? cause.message : undefined);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new AiError(kindForStatus(response.status), detailFromBody(body));
  }

  const body = response.body;
  if (!body) {
    // Should not happen on either target, and is worth saying plainly rather
    // than crashing on a null read: it means the fetch in use is not the one
    // this module documents.
    throw new AiError('bad-response', 'The response carried no stream.');
  }

  return readStream(config, body, options);
}

async function readStream(
  config: AiConfig,
  body: ReadableStream<Uint8Array>,
  options: StreamOptions,
): Promise<string> {
  const reader = body.getReader();
  const textDecoder = new TextDecoder();
  const sse = createSseDecoder(config);

  let answer = '';

  /** Applies one decoded event. Returns true when the stream is finished. */
  const apply = (event: SseEvent): boolean => {
    if (event.kind === 'delta') {
      answer += event.text;
      options.onDelta(event.text);
      return false;
    }

    if (event.kind === 'error') {
      // Reported inside a 200 response, so there is no status to classify by.
      // `overloaded` is the honest default for a provider-side failure that
      // arrived mid-answer; guessing anything more specific from the wording
      // would be guessing.
      throw new AiError('overloaded', event.message);
    }

    return true;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      // `stream: true` keeps a multi-byte character that straddles two chunks
      // intact. Without it a non-ASCII character split across a read boundary
      // arrives as a replacement glyph.
      for (const event of sse.push(textDecoder.decode(value, { stream: true }))) {
        if (apply(event)) return answer;
      }
    }

    // A stream that closed without a trailing newline still has a frame in the
    // buffer, and on some proxies that frame is the terminator.
    for (const event of sse.flush()) {
      if (apply(event)) return answer;
    }

    // Ended without a terminator at all. Some proxies simply close. What
    // arrived is still the answer, so it is returned rather than discarded.
    return answer;
  } catch (cause) {
    if (cause instanceof AiError) throw cause;
    if (options.signal?.aborted) throw new AiError('aborted');
    throw new AiError('network', cause instanceof Error ? cause.message : undefined);
  } finally {
    // Releasing the lock lets an abort actually tear the socket down instead of
    // leaving it held open behind a screen the user has already left.
    reader.releaseLock();
    await body.cancel().catch(() => {});
  }
}

/**
 * The settings screen's "Test connection".
 *
 * Deliberately a real request rather than a reachability check: the failures
 * worth catching before someone sends a year of training are a rejected key and
 * a model name the provider does not have, and neither shows up in anything
 * cheaper. Two tokens is the smallest request that still proves all of it.
 */
export async function testConnection(config: AiConfig): Promise<void> {
  await streamCompletion(
    config,
    {
      system: 'Reply with the single word: ready.',
      messages: [{ role: 'user', content: 'ready?' }],
      maxOutputTokens: 8,
    },
    { onDelta: () => {} },
  );
}
