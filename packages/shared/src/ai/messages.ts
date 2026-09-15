/**
 * The shape a request has before it belongs to any provider.
 *
 * Two providers answer this app: Anthropic natively, and anything speaking
 * OpenAI's chat-completions dialect, which transitively covers OpenRouter, Groq
 * and a local Ollama. Their wire formats disagree about almost everything worth
 * disagreeing about, so the disagreement is confined to one file
 * (`providers.ts`) and everything upstream of it composes the neutral shape
 * here.
 *
 * There is no `fetch` in this directory and there is not going to be. The
 * package is pure by policy, and the half worth testing is the half that has no
 * network in it: which bytes go out, and how a stream of them is read back.
 */

/**
 * Who said a thing.
 *
 * No `system` member. Both providers take the system prompt out of the message
 * list, Anthropic as a top-level field and OpenAI as a first message it
 * synthesises, so carrying it as a role here would mean every adapter starting
 * by splitting it back out again. It is a field on the request instead.
 */
export type AiRole = 'user' | 'assistant';

export interface AiMessage {
  role: AiRole;
  content: string;
}

/**
 * One turn's worth of everything a provider needs.
 *
 * `cacheFirstMessage` is the reason the Anthropic adapter exists at all rather
 * than everything going out over the OpenAI-compatible path. The first user
 * message in a coach thread is the whole training document, tens of thousands of
 * tokens of it, and every follow-up question re-sends the lot. Anthropic will
 * cache that prefix if it is asked to; the flag is how a caller asks. Providers
 * with no such control ignore it, which is why it is a hint on the request and
 * not a required part of the message.
 */
export interface AiRequest {
  /** The instruction. Never part of the conversation. */
  system: string;
  messages: AiMessage[];
  maxOutputTokens: number;
  /**
   * Mark the first user message as worth caching across follow-ups.
   *
   * Only meaningful when that message is large and stable, which for this app
   * means the training document and nothing else.
   */
  cacheFirstMessage?: boolean;
  temperature?: number;
}

/** Where the request is going, and who is paying for it. */
export interface AiConfig {
  provider: AiProvider;
  model: string;
  apiKey: string;
  /**
   * Where the API lives: `https://api.openai.com`, `http://localhost:11434`, or
   * a root that already carries its own version segment such as
   * `https://open.bigmodel.cn/api/paas/v4`.
   *
   * See `apiRoot` in `providers.ts` for how the two are told apart. Trailing
   * slashes are tolerated because a user typing a URL into a phone keyboard
   * will leave one. Also honoured on the Anthropic path, for a proxy in front
   * of it.
   */
  baseUrl?: string;
}

export const AI_PROVIDERS = ['anthropic', 'openai-compatible'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: 'Claude',
  'openai-compatible': 'OpenAI-compatible',
};

/**
 * What each provider is asked for when the user has expressed no preference.
 *
 * A default model is a perishable fact, which is why it is one exported
 * constant rather than a string spread through the settings screen. The
 * OpenAI-compatible default is deliberately a widely-served name rather than a
 * good one: that path also points at Ollama and OpenRouter, where any specific
 * default would be wrong, so the field is expected to be edited.
 */
export const DEFAULT_AI_MODELS: Record<AiProvider, string> = {
  anthropic: 'claude-sonnet-4-5',
  'openai-compatible': 'gpt-4o-mini',
};

/** The address used when the user leaves `baseUrl` empty. */
export const DEFAULT_BASE_URLS: Record<AiProvider, string> = {
  anthropic: 'https://api.anthropic.com',
  'openai-compatible': 'https://api.openai.com',
};

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

/**
 * Which surface a stored conversation came from.
 *
 * Lives here rather than in the app because the brief a thread is resumed with
 * is chosen from it, and the briefs are in this package. Persisted as a string
 * in `coach_threads.kind`, so members are added and never renamed.
 */
export const COACH_THREAD_KINDS = ['review', 'session', 'advice', 'stats'] as const;
export type CoachThreadKind = (typeof COACH_THREAD_KINDS)[number];

/**
 * Whether a thread is a conversation the user can continue.
 *
 * Only the review is. The other three answer one question about one screen, and
 * a reply box under a finish-screen summary would be a chat with no document
 * behind it.
 */
export function isConversational(kind: CoachThreadKind): boolean {
  return kind === 'review';
}
