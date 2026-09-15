/**
 * The two wire formats, and the only place they differ.
 *
 * Everything above this file speaks `AiRequest`. Everything below it is one
 * provider's opinion about JSON. Keeping the translation pure has a practical
 * payoff beyond tidiness: the failure this code actually has is not "the request
 * was wrong", which shows up immediately as a 400, but "the stream was decoded
 * wrong", which shows up as text quietly missing from the middle of an answer.
 * That is a unit test, and it can only be a unit test if no socket is involved.
 *
 * Both providers stream Server-Sent Events. This file understands one line at a
 * time and holds no state; reassembling lines out of network chunks belongs to
 * the caller, because that is where the chunks are.
 */

import type { AiConfig, AiRequest } from './messages.ts';

/** A request, reduced to the three things `fetch` wants. */
export interface WireRequest {
  url: string;
  headers: Record<string, string>;
  /** Already serialised, so the caller cannot accidentally re-shape it. */
  body: string;
}

/**
 * What one SSE line meant.
 *
 * `null` for the many lines that mean nothing: blank separators, `event:` names
 * (the payload's own `type` field is more reliable than the event name and both
 * providers send it), comment keep-alives, and pings.
 */
export type SseEvent =
  | { kind: 'delta'; text: string }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

const ANTHROPIC_VERSION = '2023-06-01';

/** Trailing slashes come free with any URL typed on a phone. */
function origin(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Where a provider's API root actually is.
 *
 * Most OpenAI-compatible servers answer at `<origin>/v1/chat/completions`, and
 * that is what a bare origin gets. But the convention is not universal: Zhipu's
 * GLM API is `/api/paas/v4/chat/completions`, and a user pointing this at it
 * would otherwise get `/api/paas/v4/v1/chat/completions` and a 404 that says
 * nothing about why.
 *
 * The rule is narrow on purpose: a base URL whose path already ends in a
 * version segment is treated as the API root and only the method is appended.
 * Anything else gets the `/v1` it almost certainly wants, so
 * `https://openrouter.ai/api` still resolves to `/api/v1/chat/completions`
 * rather than losing a segment.
 */
function apiRoot(url: string): string {
  const base = origin(url);
  return /\/v\d+$/.test(base) ? base : `${base}/v1`;
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

/**
 * Turns a neutral request into the bytes one provider expects.
 *
 * The `stream: true` is not optional here. A coach answer runs to a thousand
 * words and a non-streaming call means staring at a spinner for most of a
 * minute, which on a phone reads as a hang rather than as thinking.
 */
export function buildRequest(config: AiConfig, request: AiRequest): WireRequest {
  return config.provider === 'anthropic'
    ? anthropicRequest(config, request)
    : openAiRequest(config, request);
}

function anthropicRequest(config: AiConfig, request: AiRequest): WireRequest {
  const base = apiRoot(config.baseUrl || 'https://api.anthropic.com');

  const messages = request.messages.map((message, index) => {
    // Cache the first user turn and only it. That message is the training
    // document: large, identical across every follow-up in a thread, and the
    // entire reason a second question costs a fraction of the first. Marking
    // anything else would spend a cache write on text that never repeats.
    const cacheable = request.cacheFirstMessage === true && index === 0;

    return {
      role: message.role,
      content: cacheable
        ? [{ type: 'text', text: message.content, cache_control: { type: 'ephemeral' } }]
        : message.content,
    };
  });

  return {
    url: `${base}/messages`,
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      // The web build is a browser, and without this header Anthropic refuses
      // the preflight rather than the request, which surfaces as an opaque
      // network failure with nothing in it to act on. It is a no-op on a phone.
      'anthropic-dangerous-direct-browser-access': 'true',
      // Anthropic authenticates on `x-api-key`. Most Anthropic-compatible
      // gateways in front of it (LiteLLM, One API and the rest) authenticate on
      // a bearer token instead, because that is what Claude Code sends when it
      // is pointed at one. Sending both costs nothing and is the difference
      // between a proxy working and returning 401 with no way to tell why.
      //
      // Only when a base URL was set, which is the user saying they are talking
      // to something other than Anthropic. Against Anthropic itself the extra
      // header would be dead weight on every request.
      ...(config.baseUrl ? { authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: request.maxOutputTokens,
      system: request.system,
      messages,
      stream: true,
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    }),
  };
}

function openAiRequest(config: AiConfig, request: AiRequest): WireRequest {
  const base = apiRoot(config.baseUrl || 'https://api.openai.com');

  return {
    url: `${base}/chat/completions`,
    headers: {
      'content-type': 'application/json',
      // Ollama wants no key and is given one anyway. It ignores the header,
      // and the alternative is a branch here on a URL, which is a guess about
      // which server is on the other end.
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      // `max_tokens` rather than `max_completion_tokens`: this path also points
      // at Ollama, OpenRouter and llama.cpp, and it is the spelling all of them
      // still accept.
      max_tokens: request.maxOutputTokens,
      messages: [
        { role: 'system', content: request.system },
        ...request.messages.map((message) => ({ role: message.role, content: message.content })),
      ],
      stream: true,
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    }),
  };
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

/**
 * Reads one complete SSE line.
 *
 * The caller guarantees completeness. A line arriving in two network chunks and
 * decoded twice as halves is the bug this whole shape exists to make impossible
 * to write by accident: `JSON.parse` on half a payload throws, and a `catch`
 * around it looks like robustness while silently dropping a word from the
 * middle of a sentence.
 */
export function decodeSseLine(config: AiConfig, line: string): SseEvent | null {
  const trimmed = line.trimEnd();
  if (trimmed.length === 0) return null;

  // `event:` names and `:` keep-alive comments. Both providers repeat the event
  // name inside the payload, so the payload is the single source read here.
  if (!trimmed.startsWith('data:')) return null;

  const payload = trimmed.slice('data:'.length).trim();
  if (payload.length === 0) return null;

  // OpenAI's end sentinel is not JSON and must be tested before parsing.
  if (payload === '[DONE]') return { kind: 'done' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    // A payload that is not JSON and is not the sentinel is a provider doing
    // something undocumented. Skipping it keeps a stream alive that is very
    // probably still fine, where throwing would lose an answer already part
    // written on screen.
    return null;
  }

  if (parsed === null || typeof parsed !== 'object') return null;

  return config.provider === 'anthropic'
    ? decodeAnthropic(parsed as Record<string, unknown>)
    : decodeOpenAi(parsed as Record<string, unknown>);
}

function decodeAnthropic(event: Record<string, unknown>): SseEvent | null {
  switch (event.type) {
    case 'content_block_delta': {
      const delta = event.delta as Record<string, unknown> | undefined;
      // `thinking_delta` and `input_json_delta` share this event and are not
      // answer text. Reading `delta.text` unconditionally would splice a
      // model's reasoning into the reply.
      if (delta?.type !== 'text_delta') return null;
      return typeof delta.text === 'string' ? { kind: 'delta', text: delta.text } : null;
    }
    case 'message_stop':
      return { kind: 'done' };
    case 'error': {
      const error = event.error as Record<string, unknown> | undefined;
      return { kind: 'error', message: stringOr(error?.message, 'The model reported an error.') };
    }
    default:
      // `message_start`, `ping`, `content_block_start`/`_stop`, `message_delta`.
      return null;
  }
}

function decodeOpenAi(event: Record<string, unknown>): SseEvent | null {
  // Some gateways report a failure mid-stream as an ordinary data frame rather
  // than as an HTTP status, because the status was already sent as 200.
  if (event.error !== undefined && event.error !== null) {
    const error = event.error as Record<string, unknown>;
    return { kind: 'error', message: stringOr(error.message, 'The model reported an error.') };
  }

  const choices = event.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;

  const choice = choices[0] as Record<string, unknown>;
  const delta = choice.delta as Record<string, unknown> | undefined;
  const text = delta?.content;

  if (typeof text === 'string' && text.length > 0) return { kind: 'delta', text };

  // A `finish_reason` closes the stream on servers that never send `[DONE]`,
  // which includes some OpenAI-compatible proxies. Reported after the delta
  // check because the final frame can legitimately carry both.
  if (typeof choice.finish_reason === 'string' && choice.finish_reason.length > 0) {
    return { kind: 'done' };
  }

  return null;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

/**
 * A stateful reader over a stream that arrives in arbitrary pieces.
 *
 * This exists because the bug it prevents is invisible. Network chunks have
 * nothing to do with SSE frames: one `read()` routinely ends in the middle of a
 * JSON payload. Decoding per chunk throws on the half, and the `catch` that
 * silences the throw looks like robustness while dropping a word out of the
 * middle of a sentence, which nobody reviewing the code or using the app would
 * ever notice.
 *
 * So the buffering lives here, next to the decoder and under the same tests,
 * rather than inside the fetch loop where it cannot be exercised without a
 * socket. `push` returns the events completed by this chunk; `flush` reports
 * whatever a stream that closed without a trailing newline left behind.
 */
export function createSseDecoder(config: AiConfig): {
  push: (chunk: string) => SseEvent[];
  flush: () => SseEvent[];
} {
  let buffer = '';

  return {
    push(chunk: string): SseEvent[] {
      buffer += chunk;

      // Everything before the last newline is complete. What follows it is a
      // partial line and waits for the next chunk.
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      const events: SseEvent[] = [];
      for (const line of lines) {
        const event = decodeSseLine(config, line);
        if (event) events.push(event);
      }
      return events;
    },

    flush(): SseEvent[] {
      const rest = buffer;
      buffer = '';
      if (rest.trim().length === 0) return [];

      const event = decodeSseLine(config, rest);
      return event ? [event] : [];
    },
  };
}
