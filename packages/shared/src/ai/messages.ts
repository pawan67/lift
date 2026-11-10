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
  /**
   * Assistant turns only: the lookups the model asked for before it would
   * answer. The turn after one of these is always a user turn carrying the
   * matching `toolResults`, because both providers reject a conversation where
   * a call goes unanswered.
   */
  toolCalls?: AiToolCall[];
  /** User turns only: what the app found for the previous turn's `toolCalls`. */
  toolResults?: AiToolResult[];
  /**
   * DeepSeek's thinking mode only. Its reasoning has to be handed back with the
   * tool calls it led to, inside the same exchange, or the follow-up request is
   * refused. Never shown and never sent to any provider that did not emit it.
   */
  reasoning?: string;
  /**
   * User turns only: pictures sent alongside the text, such as a photo of a
   * meal. Needs a vision-capable model; one without vision answers with an
   * error, which surfaces as an ordinary `AiError`.
   */
  images?: AiImage[];
}

/** A picture, inline. Kept small by the caller: providers cap it at a few megabytes. */
export interface AiImage {
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  /** Base64, no `data:` prefix. */
  data: string;
}

/**
 * Something the model can ask the app to look up.
 *
 * `parameters` is a JSON Schema object. Both providers take the same schema
 * under different keys, so it is stored once in the shape they agree on.
 */
export interface AiTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AiToolCall {
  /** The provider's id for the call, echoed back on the result. */
  id: string;
  name: string;
  /** Parsed arguments. `{}` when the model sent something that was not JSON. */
  input: Record<string, unknown>;
}

export interface AiToolResult {
  callId: string;
  name: string;
  /** What the model reads. Plain text, figures already formatted. */
  content: string;
  isError?: boolean;
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
  /**
   * The same, for a document that rode in on a later turn.
   *
   * A chat that opens with "hi" sends the log with the first real question
   * instead, so the turn worth caching is wherever that landed. Everything
   * before it is cached with it, which is a prefix of a few short turns.
   */
  cacheMessageAt?: number;
  temperature?: number;
  /** Lookups the model may make before answering. Omitted means none. */
  tools?: AiTool[];
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

export const AI_PROVIDERS = ['anthropic', 'deepseek', 'cerebras', 'openai-compatible'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: 'Claude',
  deepseek: 'DeepSeek',
  cerebras: 'Cerebras',
  'openai-compatible': 'OpenAI-compatible',
};

/**
 * Whether a provider can read photos. DeepSeek's API takes text only, so a
 * photo estimate there is refused with a sentence that says why.
 */
export const AI_PROVIDER_READS_IMAGES: Record<AiProvider, boolean> = {
  anthropic: true,
  deepseek: false,
  // Through `CEREBRAS_VISION_MODEL`, which a photo estimate switches to.
  cerebras: true,
  'openai-compatible': true,
};

/**
 * The Cerebras model a photo goes to. gpt-oss reads text only; Qwen 3.8 27B is
 * the Cerebras model that takes images (base64 PNG or JPEG), so an estimate
 * with a photo is sent there and one without stays on the faster default.
 */
export const CEREBRAS_VISION_MODEL = 'qwen-3.8-27b';

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
  // `deepseek-chat` was retired on 2026-07-24. `deepseek-flash` is the
  // cheaper of the two current models and the one that takes tool calls.
  deepseek: 'deepseek-flash',
  // OpenAI's open-weight model, served at a few thousand tokens a second: the
  // reason to pick Cerebras is speed, and this is its fastest strong model.
  cerebras: 'gpt-oss-120b',
  'openai-compatible': 'gpt-4o-mini',
};

/** The address used when the user leaves `baseUrl` empty. */
export const DEFAULT_BASE_URLS: Record<AiProvider, string> = {
  anthropic: 'https://api.anthropic.com',
  deepseek: 'https://api.deepseek.com',
  cerebras: 'https://api.cerebras.ai',
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
/** What a stored turn keeps beside its text. See `coach_messages.parts`. */
export type CoachMessageParts = Pick<AiMessage, 'toolCalls' | 'toolResults' | 'reasoning'>;

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
