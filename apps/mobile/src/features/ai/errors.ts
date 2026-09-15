/**
 * What went wrong, in a sentence somebody can act on.
 *
 * Modelled on `SyncHttpError`, and for the same reason: the thing a provider
 * hands back on a bad day is a JSON object with a type, a message and sometimes
 * a nested request id, and putting that on screen tells a lifter standing in a
 * gym nothing at all. Each failure here is classified once, at the boundary,
 * and the screens render the sentence rather than the payload.
 *
 * The classification is deliberately coarse. Six kinds cover every error worth
 * telling apart, where "telling apart" means the user's next action differs: fix
 * the key, wait, check the address, or try again.
 */

export type AiErrorKind =
  | 'no-key'
  | 'auth'
  | 'rate-limit'
  | 'overloaded'
  | 'network'
  | 'bad-response'
  | 'aborted';

const MESSAGES: Record<AiErrorKind, string> = {
  'no-key': 'No API key is set. Add one in Settings, AI coach.',
  auth: 'The provider rejected that API key. Check it in Settings, AI coach.',
  'rate-limit': 'The provider is rate limiting this key. Wait a moment and try again.',
  overloaded: 'The model is overloaded right now. Try again in a minute.',
  network: 'Could not reach the model. Check the connection, and the base URL if you set one.',
  'bad-response': 'The model returned something this app could not read.',
  aborted: 'Stopped.',
};

export class AiError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    /**
     * The provider's own wording, when it gave any.
     *
     * Kept beside the sentence rather than instead of it. A rate-limit message
     * naming which limit was hit is genuinely useful to somebody who can act on
     * it, and useless to everybody else, so the screen shows the sentence and
     * offers this underneath.
     */
    readonly detail?: string,
  ) {
    super(MESSAGES[kind]);
    this.name = 'AiError';
  }

  /** Trying the same thing again might work. Fixing a key is not this. */
  get isTransient(): boolean {
    return this.kind === 'rate-limit' || this.kind === 'overloaded' || this.kind === 'network';
  }
}

/**
 * Maps an HTTP status onto a kind.
 *
 * 529 is Anthropic's overloaded status and is not in any RFC, which is exactly
 * why it is named here rather than falling into the 5xx bucket: it is the one
 * server error where waiting is the right advice.
 */
export function kindForStatus(status: number): AiErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate-limit';
  if (status === 529 || status === 503) return 'overloaded';
  if (status >= 500) return 'overloaded';
  return 'bad-response';
}

/**
 * Digs the provider's message out of an error body.
 *
 * Both providers nest it under `error.message`, and both will occasionally
 * return HTML from a proxy in front of them instead. A body that is not JSON is
 * not shown: a page of markup in an alert is worse than nothing.
 */
export function detailFromBody(body: string): string | undefined {
  const text = body.trim();
  if (text.length === 0 || !text.startsWith('{')) return undefined;

  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown }; message?: unknown };
    const message = parsed.error?.message ?? parsed.message;
    return typeof message === 'string' && message.trim().length > 0 ? message.trim() : undefined;
  } catch {
    return undefined;
  }
}
