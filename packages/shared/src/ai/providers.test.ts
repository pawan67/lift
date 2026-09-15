import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildRequest, createSseDecoder, decodeSseLine } from './providers.ts';
import type { AiConfig, AiRequest } from './messages.ts';

const CLAUDE: AiConfig = { provider: 'anthropic', model: 'claude-sonnet-4-5', apiKey: 'sk-ant-test' };
const OPENAI: AiConfig = { provider: 'openai-compatible', model: 'gpt-4o-mini', apiKey: 'sk-test' };

const REQUEST: AiRequest = {
  system: 'Be blunt.',
  messages: [
    { role: 'user', content: 'the training document' },
    { role: 'assistant', content: 'the review' },
    { role: 'user', content: 'why that exercise?' },
  ],
  maxOutputTokens: 2048,
};

function bodyOf(config: AiConfig, request: AiRequest): Record<string, any> {
  return JSON.parse(buildRequest(config, request).body);
}

describe('buildRequest, Anthropic', () => {
  it('posts to the messages endpoint with a versioned key header', () => {
    const wire = buildRequest(CLAUDE, REQUEST);
    assert.equal(wire.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(
      buildRequest({ ...CLAUDE, baseUrl: 'https://proxy.example.com/v1' }, REQUEST).url,
      'https://proxy.example.com/v1/messages',
    );
    assert.equal(wire.headers['x-api-key'], 'sk-ant-test');
    assert.equal(wire.headers['anthropic-version'], '2023-06-01');
  });

  it('asks for direct browser access, because the web build is a browser', () => {
    // Without it Anthropic refuses the preflight rather than the request, which
    // reaches the app as an opaque network failure with nothing to act on.
    assert.equal(buildRequest(CLAUDE, REQUEST).headers['anthropic-dangerous-direct-browser-access'], 'true');
  });

  it('keeps the system prompt out of the conversation', () => {
    const body = bodyOf(CLAUDE, REQUEST);
    assert.equal(body.system, 'Be blunt.');
    assert.equal(body.messages.length, 3);
    assert.equal(body.stream, true);
    assert.equal(body.max_tokens, 2048);
  });

  it('sends plain string content when caching was not asked for', () => {
    assert.equal(bodyOf(CLAUDE, REQUEST).messages[0].content, 'the training document');
  });

  it('marks only the first message cacheable', () => {
    // The first user turn is the whole training document and is identical across
    // every follow-up. Marking a later turn would spend a cache write on text
    // that never repeats.
    const body = bodyOf(CLAUDE, { ...REQUEST, cacheFirstMessage: true });
    assert.deepEqual(body.messages[0].content, [
      { type: 'text', text: 'the training document', cache_control: { type: 'ephemeral' } },
    ]);
    assert.equal(body.messages[1].content, 'the review');
    assert.equal(body.messages[2].content, 'why that exercise?');
  });

  it('sends no bearer token when talking to Anthropic itself', () => {
    assert.equal('authorization' in buildRequest(CLAUDE, REQUEST).headers, false);
  });

  it('adds a bearer token when pointed at a compatible gateway', () => {
    // Anthropic authenticates on x-api-key; the proxies people put in front of
    // it authenticate on a bearer token, because that is what Claude Code sends.
    // Without this, an Anthropic-compatible gateway returns 401 and the user has
    // no way to see that the key was never read.
    const proxy: AiConfig = { ...CLAUDE, baseUrl: 'https://gateway.example.com' };
    const headers = buildRequest(proxy, REQUEST).headers;
    assert.equal(headers.authorization, `Bearer ${CLAUDE.apiKey}`);
    assert.equal(headers['x-api-key'], CLAUDE.apiKey, 'the standard header still goes too');
  });

  it('omits temperature rather than inventing a default', () => {
    assert.equal('temperature' in bodyOf(CLAUDE, REQUEST), false);
    assert.equal(bodyOf(CLAUDE, { ...REQUEST, temperature: 0.4 }).temperature, 0.4);
  });
});

describe('buildRequest, OpenAI-compatible', () => {
  it('posts to chat completions with a bearer key', () => {
    const wire = buildRequest(OPENAI, REQUEST);
    assert.equal(wire.url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(wire.headers.authorization, 'Bearer sk-test');
  });

  it('turns the system prompt into the first message', () => {
    const body = bodyOf(OPENAI, REQUEST);
    assert.deepEqual(body.messages[0], { role: 'system', content: 'Be blunt.' });
    assert.equal(body.messages.length, 4);
    assert.equal(body.stream, true);
  });

  it('reaches a local model when pointed at one', () => {
    const ollama: AiConfig = { ...OPENAI, baseUrl: 'http://localhost:11434' };
    assert.equal(buildRequest(ollama, REQUEST).url, 'http://localhost:11434/v1/chat/completions');
  });

  it('reaches a gateway that answers on a bare origin', () => {
    // Verified against the live service: /v1 appended to the origin is right,
    // and doubling it up returns "Invalid URL (POST /v1/v1/chat/completions)".
    const gateway: AiConfig = { ...OPENAI, baseUrl: 'https://agentrouter.org' };
    assert.equal(buildRequest(gateway, REQUEST).url, 'https://agentrouter.org/v1/chat/completions');
  });

  it('tolerates the trailing slash a phone keyboard leaves behind', () => {
    const typed: AiConfig = { ...OPENAI, baseUrl: 'https://openrouter.ai/api/' };
    assert.equal(buildRequest(typed, REQUEST).url, 'https://openrouter.ai/api/v1/chat/completions');
  });

  it('does not add a second version segment to a base that already has one', () => {
    // Zhipu's GLM API lives at /api/paas/v4/chat/completions. Appending /v1
    // unconditionally produced /api/paas/v4/v1/chat/completions and a 404 whose
    // message says nothing about the cause.
    const glm: AiConfig = { ...OPENAI, baseUrl: 'https://open.bigmodel.cn/api/paas/v4' };
    assert.equal(
      buildRequest(glm, REQUEST).url,
      'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    );

    const explicit: AiConfig = { ...OPENAI, baseUrl: 'https://openrouter.ai/api/v1' };
    assert.equal(buildRequest(explicit, REQUEST).url, 'https://openrouter.ai/api/v1/chat/completions');
  });

  it('still adds /v1 to a path that is not a version', () => {
    // `/api` is a path but not a version, so it wants the /v1 it would get from
    // a bare origin. Dropping it here would lose a segment.
    const router: AiConfig = { ...OPENAI, baseUrl: 'https://openrouter.ai/api' };
    assert.equal(buildRequest(router, REQUEST).url, 'https://openrouter.ai/api/v1/chat/completions');
  });

  it('ignores the cache hint rather than sending something unrecognised', () => {
    const body = bodyOf(OPENAI, { ...REQUEST, cacheFirstMessage: true });
    assert.equal(body.messages[1].content, 'the training document');
  });
});

describe('decodeSseLine, lines that mean nothing', () => {
  const noise = ['', '   ', 'event: content_block_delta', ': keep-alive', 'data:', 'data: {'];

  for (const config of [CLAUDE, OPENAI]) {
    for (const line of noise) {
      it(`${config.provider} ignores ${JSON.stringify(line)}`, () => {
        assert.equal(decodeSseLine(config, line), null);
      });
    }
  }
});

describe('decodeSseLine, Anthropic', () => {
  it('reads a text delta', () => {
    const line =
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Side delts"}}';
    assert.deepEqual(decodeSseLine(CLAUDE, line), { kind: 'delta', text: 'Side delts' });
  });

  it('does not splice reasoning into the answer', () => {
    // `thinking_delta` shares the event with `text_delta`. Reading `delta.text`
    // unconditionally would print the model's reasoning as the review.
    const line =
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"hmm"}}';
    assert.equal(decodeSseLine(CLAUDE, line), null);
  });

  it('ends on message_stop', () => {
    assert.deepEqual(decodeSseLine(CLAUDE, 'data: {"type":"message_stop"}'), { kind: 'done' });
  });

  it('surfaces a mid-stream error in the wording the provider used', () => {
    const line = 'data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}';
    assert.deepEqual(decodeSseLine(CLAUDE, line), { kind: 'error', message: 'Overloaded' });
  });

  it('falls back to a sentence when an error carries no message', () => {
    const line = 'data: {"type":"error","error":{"type":"overloaded_error"}}';
    assert.deepEqual(decodeSseLine(CLAUDE, line), {
      kind: 'error',
      message: 'The model reported an error.',
    });
  });

  it('ignores the frames that carry no answer text', () => {
    for (const type of ['message_start', 'ping', 'content_block_start', 'content_block_stop', 'message_delta']) {
      assert.equal(decodeSseLine(CLAUDE, `data: {"type":"${type}"}`), null, type);
    }
  });

  it('preserves whitespace inside a delta while trimming the frame', () => {
    // Trimming the payload must not reach the text: a leading space is the gap
    // between two words and losing it runs them together.
    const line =
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" and"}}\r';
    assert.deepEqual(decodeSseLine(CLAUDE, line), { kind: 'delta', text: ' and' });
  });
});

describe('decodeSseLine, OpenAI-compatible', () => {
  it('reads a content delta', () => {
    const line = 'data: {"choices":[{"delta":{"content":"Side delts"},"index":0}]}';
    assert.deepEqual(decodeSseLine(OPENAI, line), { kind: 'delta', text: 'Side delts' });
  });

  it('ends on the sentinel, which is not JSON', () => {
    assert.deepEqual(decodeSseLine(OPENAI, 'data: [DONE]'), { kind: 'done' });
  });

  it('ends on a finish reason, for servers that never send the sentinel', () => {
    const line = 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}';
    assert.deepEqual(decodeSseLine(OPENAI, line), { kind: 'done' });
  });

  it('prefers the delta when a final frame carries both', () => {
    const line = 'data: {"choices":[{"delta":{"content":"."},"finish_reason":"stop"}]}';
    assert.deepEqual(decodeSseLine(OPENAI, line), { kind: 'delta', text: '.' });
  });

  it('reads an error delivered as a data frame', () => {
    // The status was already sent as 200, so a gateway failing mid-stream has
    // nowhere else to put it.
    const line = 'data: {"error":{"message":"Rate limit reached","type":"rate_limit_error"}}';
    assert.deepEqual(decodeSseLine(OPENAI, line), { kind: 'error', message: 'Rate limit reached' });
  });

  it('ignores the opening frame that carries a role and no content', () => {
    assert.equal(decodeSseLine(OPENAI, 'data: {"choices":[{"delta":{"role":"assistant"}}]}'), null);
  });

  it('ignores a frame with no choices at all', () => {
    assert.equal(decodeSseLine(OPENAI, 'data: {"choices":[]}'), null);
  });
});

describe('createSseDecoder', () => {
  /** Splits a whole stream into fixed-size pieces, the way a socket would. */
  function chunks(stream: string, size: number): string[] {
    const parts: string[] = [];
    for (let i = 0; i < stream.length; i += size) parts.push(stream.slice(i, i + size));
    return parts;
  }

  function textOf(events: readonly ReturnType<typeof decodeSseLine>[]): string {
    return events.map((event) => (event?.kind === 'delta' ? event.text : '')).join('');
  }

  const ANTHROPIC_STREAM = [
    'event: message_start',
    'data: {"type":"message_start","message":{"id":"msg_1"}}',
    '',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Side delts got "}}',
    '',
    'event: ping',
    'data: {"type":"ping"}',
    '',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"4 sets a week."}}',
    '',
    'event: message_stop',
    'data: {"type":"message_stop"}',
    '',
  ].join('\n');

  it('reassembles the answer however the stream is cut up', () => {
    // The bug this whole shape exists to prevent: a payload split across two
    // reads decoded as two halves throws on both, and a catch around it drops a
    // word out of the middle of a sentence with nothing to show it happened.
    // Every chunk size from 1 byte up is exercised, so every possible split
    // point inside every payload is covered.
    for (let size = 1; size <= 64; size++) {
      const decoder = createSseDecoder(CLAUDE);
      const events = chunks(ANTHROPIC_STREAM, size).flatMap((chunk) => decoder.push(chunk));
      events.push(...decoder.flush());

      assert.equal(textOf(events), 'Side delts got 4 sets a week.', `chunk size ${size}`);
      assert.equal(events.at(-1)?.kind, 'done', `chunk size ${size}`);
    }
  });

  it('does the same for the OpenAI dialect, sentinel included', () => {
    const stream = [
      'data: {"choices":[{"delta":{"role":"assistant"}}]}',
      '',
      'data: {"choices":[{"delta":{"content":"Add 3 sets of "}}]}',
      '',
      'data: {"choices":[{"delta":{"content":"lateral raises."}}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    for (let size = 1; size <= 64; size++) {
      const decoder = createSseDecoder(OPENAI);
      const events = chunks(stream, size).flatMap((chunk) => decoder.push(chunk));
      events.push(...decoder.flush());

      assert.equal(textOf(events), 'Add 3 sets of lateral raises.', `chunk size ${size}`);
      assert.equal(events.at(-1)?.kind, 'done', `chunk size ${size}`);
    }
  });

  it('handles CRLF line endings, which a proxy in front may introduce', () => {
    const decoder = createSseDecoder(CLAUDE);
    const events = decoder.push(
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\r\n',
    );
    assert.deepEqual(events, [{ kind: 'delta', text: 'ok' }]);
  });

  it('recovers a final frame from a stream that closed without a newline', () => {
    const decoder = createSseDecoder(OPENAI);
    assert.deepEqual(decoder.push('data: [DONE]'), []);
    assert.deepEqual(decoder.flush(), [{ kind: 'done' }]);
  });

  it('flushes nothing when the stream ended cleanly', () => {
    const decoder = createSseDecoder(OPENAI);
    decoder.push('data: [DONE]\n');
    assert.deepEqual(decoder.flush(), []);
  });

  it('holds a partial payload rather than reporting it as an error', () => {
    // Half a JSON object is not a provider failure, it is a chunk boundary.
    const decoder = createSseDecoder(CLAUDE);
    assert.deepEqual(decoder.push('data: {"type":"content_block_delta","del'), []);
    assert.deepEqual(decoder.push('ta":{"type":"text_delta","text":"hi"}}\n'), [
      { kind: 'delta', text: 'hi' },
    ]);
  });
});
