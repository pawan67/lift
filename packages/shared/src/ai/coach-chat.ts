/**
 * The coach as a conversation rather than as a document.
 *
 * The review that came before this asked for seven headings and a four-week
 * programme in prose, and got exactly that: a wall of text the app could only
 * print. Three things change here, and each is a contract between the brief
 * and the screen, which is why they live together in one file.
 *
 * **Cards.** The model writes small fenced JSON blocks where a figure, a plan
 * or a question belongs, and the app draws them. An exercise card is drawn from
 * the database, not from the model, so the trend a user looks at is the trend
 * their log actually has. A plan card carries sets and reps in a shape the app
 * can save as a routine.
 *
 * **Choices.** Every reply ends with a handful of tap-to-send next steps. A
 * coach that only answers what it is asked leaves the user to know what to ask.
 *
 * **Lookups.** The export is a window; the log is longer. The tools let the
 * model read an exercise's whole history or one session in full instead of
 * guessing from a thirty-day slice.
 *
 * Pure like the rest of this directory: parsing what streamed back is the half
 * worth testing, and it has no socket in it.
 */

import type { AiTool, AiToolCall } from './messages.ts';

// ---------------------------------------------------------------------------
// The brief
// ---------------------------------------------------------------------------

/**
 * The system prompt for the chat.
 *
 * `unit` is the client's weight unit, and is named because a plan card's
 * `weight` is written in it: a model told nothing writes kilograms, and an
 * American who taps "Save as routine" gets bench targets two and a fifth times
 * lighter than they meant.
 */
export function coachChatBrief(unit: 'kg' | 'lb', options: { withLog?: boolean; today?: string } = {}): string {
  const opening =
    options.withLog === false
      ? `You are Lift's coach: an experienced strength, hypertrophy and nutrition coach talking with a client inside their workout and food-tracking app. The client has only made small talk so far, so their training export has not been attached yet. Reply in one or two warm sentences and offer where to start. If they do ask about their training or their eating, read what you need with the tools provided rather than guessing.`
      : `You are Lift's coach: an experienced strength, hypertrophy and nutrition coach talking with a client inside their workout and food-tracking app. One of the client's messages carries a real export of their training, between <training_log> tags. You can read more of their log, and their food diary, with the tools provided.`;
  const today = options.today ? `\n\nToday is ${options.today} on the client's calendar.` : '';

  return `${opening}${today}

How you talk:

- Like a good coach in person: direct, specific, warm, never gushing. Short paragraphs, plain words. Explain a training idea in one sentence a beginner would follow.
- Every claim about their training names the exercise, the date or the number it rests on. Use only figures from the export or from a tool result. Never invent a session, and never recompute a figure the app already gave you.
- Where the data is too thin to say something, say so and ask for what you need.
- Formatting renders on a phone: short paragraphs, "- " bullets, **bold** sparingly. No tables, no headings, no code blocks other than the cards below.

Cards. The app draws these from the client's real data, so show a card instead of reciting numbers. Write each card on its own lines as a fenced block with the language \`lift\`, holding one JSON object:

\`\`\`lift
{"card":"exercise","exercise":"Bench Press (Barbell)"}
\`\`\`

The cards:

- {"card":"exercise","exercise":"<name>"}: that lift's trend, best estimated max and recent sessions. Use it whenever you discuss how a specific lift is moving.
- {"card":"muscles"}: weekly working sets per muscle over the last four weeks against their targets. Use it when discussing balance or volume.
- {"card":"plan","title":"<short name>","routine":"<existing routine name>","notes":"<one line>","exercises":[{"exercise":"<name>","sets":3,"reps":"8-10","weight":60,"rpe":8,"rest":120,"note":"<cue>"}]}: a workout the client can save as a routine with one tap. Include "routine" only when the plan is a revised version of one of their existing routines, using its exact name; the app then offers to update it after showing what changes. "weight" is in ${unit} and "rest" in seconds; leave out any field you do not want to prescribe. "reps" is a number or a range like "8-10". One plan card per workout day.
- {"card":"nutrition","days":7}: calories a day against their goal over the last N days (1 to 90), with average protein, carbs and fat against their targets. Use it whenever you discuss how their eating has gone over a stretch of days.
- {"card":"food_day","date":"YYYY-MM-DD"}: one day of the food diary: calories and macros against the goals, and every food by meal. Use it when you discuss a specific day's eating.
- {"card":"choices","question":"<optional short question>","options":["<option>","<option>"]}: tap-to-send replies.

Exercise names in cards must be exact: as they appear in the export, or as find_exercises returned them. If you are not sure an exercise exists by that name, call find_exercises first.

Every reply ends with exactly one choices card, as its last line: two to four options, each under forty characters, written in the client's voice as the natural next steps ("Build next week's plan", "Why is my squat stuck?"). When you need something from the client before you can help (time available, equipment, how recovery feels, an injury), ask it as the choices card's "question" with the likely answers as options. The client can always type something else.

When asked for a check-in, give a check-in, not a review: two to four sentences on what stands out most in this window, the biggest thing going well and the biggest thing holding them back, each tied to a lift or a muscle. Show at most two cards that prove it. End with choices, one of which is "Full review". Anything else, answer directly and briefly.

When asked for a full review, cover in order, briefly, with a bold label for each: what this block was, what is working, what is holding them back, which lifts moved and which stalled, fixes to their routines as plan cards, and what you could not tell from the data.

Food: the client logs what they eat in the app's food diary, which is not in the training export. For any question about calories, protein, macros, meals, diet or bodyweight change, read it with food_summary (a stretch of days) or food_day (one day) before answering, then show a nutrition or food_day card rather than reciting the numbers. Tie nutrition advice to their training where it matters: protein against their training load, a surplus or deficit against their goal. If the diary is empty or they are not signed in, say so and answer from general principles.

Tools: the export already covers its window, so do not look up what is in front of you. Use exercise_history for anything older or longer than the window, workout_detail to read one session in full, find_exercises to check names, and the rest as named. Look things up before you answer, not after.`;
}

// ---------------------------------------------------------------------------
// The log, and when to send it
// ---------------------------------------------------------------------------

const LOG_OPEN = '<training_log>';
const LOG_CLOSE = '</training_log>';

/**
 * How a thread from before the tags began: the document's first heading.
 *
 * Those threads put the bare document at the head of the first turn, with the
 * question after its last blank line.
 */
const LEGACY_LOG_HEAD = '## About me';

/**
 * A user turn that carries the training document ahead of the question.
 *
 * Tagged so the screen can find the question again whichever turn the log
 * rode in on: it is no longer always the first, because small talk goes out
 * without it.
 */
export function withCoachLog(document: string, question: string): string {
  return `${LOG_OPEN}\n${document}\n${LOG_CLOSE}\n\n${question}`;
}

/** Whether a user turn carries the training document. */
export function carriesCoachLog(content: string): boolean {
  return content.startsWith(LOG_OPEN) || content.startsWith(LEGACY_LOG_HEAD);
}

/** What the user actually typed, out of a turn that may carry the log ahead of it. */
export function coachTurnText(content: string): string {
  if (content.startsWith(LOG_OPEN)) {
    const end = content.indexOf(LOG_CLOSE);
    return end === -1 ? '' : content.slice(end + LOG_CLOSE.length).trim();
  }
  if (content.startsWith(LEGACY_LOG_HEAD)) {
    const cut = content.lastIndexOf('\n\n');
    return cut === -1 ? content : content.slice(cut + 2);
  }
  return content;
}

/**
 * Every word a greeting, a thanks or an acknowledgement is made of.
 *
 * Deliberately a closed list rather than a length cut-off: "PRs?" is short and
 * needs the log, "hey coach, how are you doing" is long and does not.
 */
const SMALL_TALK_WORDS = new Set([
  'hi', 'hii', 'hiii', 'hello', 'helo', 'hey', 'heya', 'hiya', 'yo', 'sup', 'wassup', 'whats', 'what', 'up',
  'howdy', 'gm', 'morning', 'afternoon', 'evening', 'night', 'good', 'there', 'coach', 'bro', 'man', 'mate',
  'buddy', 'dude', 'thanks', 'thank', 'you', 'u', 'thx', 'ty', 'cheers', 'ok', 'okay', 'k', 'kk', 'cool',
  'nice', 'great', 'awesome', 'perfect', 'got', 'it', 'sounds', 'bye', 'see', 'ya', 'later', 'how', 'are',
  'r', 'is', 'doing', 'hows', 'going', 'lol', 'haha', 'sure', 'alright', 'so', 'much', 'a', 'lot', 'very',
]);

/**
 * Whether a message is small talk that does not need the training log.
 *
 * The log is tens of thousands of tokens and the slowest part of a first
 * answer, both to build and for the model to read. Sending it to answer "hi"
 * is a few seconds of waiting and a few cents for a reply that never looks at
 * it. It goes out with the first message that is about something.
 */
export function isSmallTalk(text: string): boolean {
  const words = text
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0);

  // Nothing but an emoji or a wave: still a greeting.
  if (words.length === 0) return text.trim().length > 0 && !/\d/.test(text);
  if (words.length > 6) return false;
  return words.every((word) => SMALL_TALK_WORDS.has(word));
}

/**
 * The starter that asks for the check-in, as the user sends it.
 *
 * Exported because the brief keys its check-in shape off the request, and the
 * chip that sends it has to send exactly this.
 */
export const COACH_CHECK_IN_REQUEST = 'Check in on my training.';

/**
 * The first questions offered before a conversation starts.
 *
 * Each is the label on a chip and, beside it, the question it sends. The
 * labels are short enough to sit three to a row on a phone; the questions are
 * worded the way a lifter would put them, because the model answers the
 * phrasing as much as the topic.
 */
export const COACH_STARTERS: readonly { label: string; icon: string; question: string }[] = [
  { label: 'Check in', icon: 'pulse-outline', question: COACH_CHECK_IN_REQUEST },
  { label: 'Stalled lifts', icon: 'trending-up-outline', question: 'Which of my lifts have stalled, and what should I change?' },
  { label: 'Plan my week', icon: 'calendar-outline', question: 'Build my training plan for next week.' },
  { label: 'Weak points', icon: 'body-outline', question: 'Which muscles am I under-training, and how do I fix that in my routines?' },
  { label: 'My eating', icon: 'nutrition-outline', question: 'How has my eating been this week? Am I hitting my calories and protein?' },
  { label: 'Full review', icon: 'document-text-outline', question: 'Give me a full review of my training.' },
];

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const COACH_TOOL_NAMES = [
  'exercise_history',
  'find_exercises',
  'recent_workouts',
  'workout_detail',
  'personal_records',
  'muscle_volume',
  'routines',
  'food_summary',
  'food_day',
] as const;
export type CoachToolName = (typeof COACH_TOOL_NAMES)[number];

/**
 * What the model may look up.
 *
 * Descriptions say what comes back, not only what goes in: a model choosing
 * between "history" and "detail" picks by the answer it wants.
 */
export const COACH_TOOLS: AiTool[] = [
  {
    name: 'exercise_history',
    description:
      "One exercise's sessions, newest first: date, every working set with weight, reps and RPE, the session's best estimated one-rep max, plus the all-time best. Covers the whole log, not only the export's window.",
    parameters: {
      type: 'object',
      properties: {
        exercise: { type: 'string', description: 'Exercise name, as in the log.' },
        sessions: { type: 'integer', minimum: 1, maximum: 30, description: 'How many sessions. Default 10.' },
      },
      required: ['exercise'],
    },
  },
  {
    name: 'find_exercises',
    description:
      "Searches the exercise library by name. Returns exact names, equipment, primary muscle and whether the client has ever trained each, most relevant first. Use it to get exact names for plan cards.",
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Words to search for, e.g. "lateral raise".' } },
      required: ['query'],
    },
  },
  {
    name: 'recent_workouts',
    description:
      'Finished workouts, newest first: id, date, name, duration, working sets, volume and the exercises done. Use workout_detail with an id to read one in full.',
    parameters: {
      type: 'object',
      properties: {
        days: { type: 'integer', minimum: 1, maximum: 365, description: 'How far back. Default 30.' },
      },
    },
  },
  {
    name: 'workout_detail',
    description: 'One workout in full: every exercise and set as logged, with notes.',
    parameters: {
      type: 'object',
      properties: { workout_id: { type: 'string', description: 'An id from recent_workouts.' } },
      required: ['workout_id'],
    },
  },
  {
    name: 'personal_records',
    description: 'Current personal bests, all-time. Optionally for one exercise only.',
    parameters: {
      type: 'object',
      properties: { exercise: { type: 'string', description: 'Optional exercise name.' } },
    },
  },
  {
    name: 'muscle_volume',
    description:
      'Working sets per week for every muscle over a window, against the minimum effective and maximum recoverable volume for the client\'s level.',
    parameters: {
      type: 'object',
      properties: {
        weeks: { type: 'integer', minimum: 1, maximum: 12, description: 'Window length. Default 4.' },
      },
    },
  },
  {
    name: 'routines',
    description: "The client's saved routines with every exercise and its set targets.",
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'food_summary',
    description:
      "The food diary over a stretch of days ending today: every logged day's calories, protein, carbs and fat, the client's daily goals, averages per logged day, days on target, the meal split and the foods eaten most. Days with nothing logged are untracked, not fasting.",
    parameters: {
      type: 'object',
      properties: {
        days: { type: 'integer', minimum: 1, maximum: 365, description: 'How many days back, today included. Default 7.' },
      },
    },
  },
  {
    name: 'food_day',
    description: 'One day of the food diary in full: every food logged, by meal, with its amount, calories and macros, and the day against the goals.',
    parameters: {
      type: 'object',
      properties: { date: { type: 'string', description: 'The day, as YYYY-MM-DD. Default today.' } },
    },
  },
];

/**
 * A line saying what the coach looked at, for the screen to show while it does.
 *
 * Shown so a pause reads as reading rather than as a hang, and so a user can
 * see which of their data an answer was built on.
 */
export function describeToolCall(call: AiToolCall): string {
  const text = (key: string): string | null => {
    const value = call.input[key];
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  };

  switch (call.name as CoachToolName) {
    case 'exercise_history':
      return `Read your ${text('exercise') ?? 'exercise'} history`;
    case 'find_exercises':
      return `Searched the library for "${text('query') ?? ''}"`;
    case 'recent_workouts':
      return 'Looked through your recent workouts';
    case 'workout_detail':
      return 'Opened one of your workouts';
    case 'personal_records':
      return text('exercise') ? `Checked your ${text('exercise')} records` : 'Checked your records';
    case 'muscle_volume':
      return 'Counted your sets per muscle';
    case 'routines':
      return 'Read your routines';
    case 'food_summary': {
      const days = call.input.days;
      return typeof days === 'number' && days === 1 ? "Read today's food" : `Read your food diary${typeof days === 'number' ? ` for ${days} days` : ''}`;
    }
    case 'food_day':
      return text('date') ? `Opened your food diary for ${text('date')}` : "Opened today's food diary";
    default:
      return 'Looked something up';
  }
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export interface CoachPlanExercise {
  exercise: string;
  sets: number;
  /** Equal when a single number was given. Null when no reps were prescribed. */
  repsLow: number | null;
  repsHigh: number | null;
  /** In the client's unit, as written. */
  weight: number | null;
  rpe: number | null;
  restSeconds: number | null;
  note: string | null;
}

export interface CoachPlan {
  title: string;
  /** The existing routine this revises, by name. Null for a new one. */
  routine: string | null;
  notes: string | null;
  exercises: CoachPlanExercise[];
}

export type CoachCard =
  | { card: 'exercise'; exercise: string }
  | { card: 'muscles' }
  | { card: 'nutrition'; days: number }
  | { card: 'food_day'; date: string | null }
  | { card: 'plan'; plan: CoachPlan }
  | { card: 'choices'; question: string | null; options: string[] };

export type CoachSegment =
  | { kind: 'text'; text: string }
  | { kind: 'card'; card: CoachCard }
  /** A card still streaming in. The screen holds its place rather than showing raw JSON. */
  | { kind: 'pending' };

const FENCE = /^```\s*([a-z]*)\s*$/i;

/**
 * Splits a reply into prose and cards.
 *
 * Tolerant in the directions a model drifts: a fence labelled `json` holding a
 * card is a card, and a block that is not valid JSON, or not a card the app
 * knows, is dropped rather than printed, because raw JSON in the middle of a
 * coach's answer reads as a crash. A fence still open at the end is the part
 * still streaming.
 *
 * Any other code block is kept as text, so a model that ignores the formatting
 * rule loses nothing.
 */
export function parseCoachReply(reply: string): CoachSegment[] {
  const segments: CoachSegment[] = [];
  const lines = reply.split('\n');
  let prose: string[] = [];

  const flushProse = () => {
    const text = prose.join('\n').trim();
    if (text.length > 0) segments.push({ kind: 'text', text });
    prose = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const open = FENCE.exec(lines[i]!.trim());
    if (!open) {
      prose.push(lines[i]!);
      continue;
    }

    const language = open[1]!.toLowerCase();
    const body: string[] = [];
    let closed = false;
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (/^```\s*$/.test(lines[j]!.trim())) {
        closed = true;
        break;
      }
      body.push(lines[j]!);
    }

    if (language !== 'lift' && language !== 'json') {
      // Not ours. Kept verbatim, fences and all, unless it is still open, in
      // which case it is kept once it closes.
      prose.push(...lines.slice(i, closed ? j + 1 : lines.length));
      i = closed ? j : lines.length;
      continue;
    }

    flushProse();

    if (!closed) {
      segments.push({ kind: 'pending' });
      break;
    }

    const card = readCard(body.join('\n'));
    if (card) segments.push({ kind: 'card', card });
    else if (language === 'json') prose.push(...lines.slice(i, j + 1));
    i = j;
  }

  flushProse();
  return segments;
}

/** The choices to offer under a reply: its last choices card, if it has one. */
export function lastChoices(segments: readonly CoachSegment[]): Extract<CoachCard, { card: 'choices' }> | null {
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i]!;
    if (segment.kind === 'card' && segment.card.card === 'choices') return segment.card;
  }
  return null;
}

function readCard(json: string): CoachCard | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const object = raw as Record<string, unknown>;

  switch (object.card) {
    case 'exercise': {
      const exercise = str(object.exercise);
      return exercise ? { card: 'exercise', exercise } : null;
    }
    case 'muscles':
      return { card: 'muscles' };
    case 'nutrition':
      return { card: 'nutrition', days: clampInt(num(object.days), 1, 90) ?? 7 };
    case 'food_day': {
      const date = str(object.date);
      return { card: 'food_day', date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null };
    }
    case 'choices': {
      const options = Array.isArray(object.options)
        ? object.options.map(str).filter((option): option is string => option !== null).slice(0, 4)
        : [];
      return options.length > 0 ? { card: 'choices', question: str(object.question), options } : null;
    }
    case 'plan': {
      const exercises = Array.isArray(object.exercises)
        ? object.exercises.map(readPlanExercise).filter((entry): entry is CoachPlanExercise => entry !== null)
        : [];
      if (exercises.length === 0) return null;
      return {
        card: 'plan',
        plan: {
          title: str(object.title) ?? 'Workout',
          routine: str(object.routine),
          notes: str(object.notes),
          exercises,
        },
      };
    }
    default:
      return null;
  }
}

function readPlanExercise(raw: unknown): CoachPlanExercise | null {
  if (raw === null || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;

  const exercise = str(entry.exercise) ?? str(entry.name);
  if (!exercise) return null;

  const [repsLow, repsHigh] = readReps(entry.reps);

  return {
    exercise,
    // A plan that names an exercise and forgets the sets still means "do it";
    // one working set is the least wrong reading, and the user sees it before
    // anything is saved.
    sets: clampInt(num(entry.sets), 1, 20) ?? 1,
    repsLow,
    repsHigh,
    weight: positive(num(entry.weight)),
    rpe: positive(num(entry.rpe)),
    restSeconds: clampInt(num(entry.rest), 0, 900),
    note: str(entry.note),
  };
}

/** `8`, `"8"`, `"8-10"`, `"8–10"`, `"8 to 10"`. Anything else prescribes no reps. */
function readReps(value: unknown): [number | null, number | null] {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const reps = Math.round(value);
    return [reps, reps];
  }
  if (typeof value !== 'string') return [null, null];

  const match = /^\s*(\d+)\s*(?:(?:-|–|—|to)\s*(\d+))?/.exec(value);
  if (!match) return [null, null];

  const low = Number(match[1]);
  const high = match[2] ? Number(match[2]) : low;
  if (low <= 0) return [null, null];
  return [Math.min(low, high), Math.max(low, high)];
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function positive(value: number | null): number | null {
  return value !== null && value > 0 ? value : null;
}

function clampInt(value: number | null, min: number, max: number): number | null {
  if (value === null) return null;
  return Math.min(max, Math.max(min, Math.round(value)));
}

// ---------------------------------------------------------------------------
// Prose
// ---------------------------------------------------------------------------

export interface RichSpan {
  text: string;
  bold: boolean;
}

export type RichBlock =
  | { kind: 'paragraph'; spans: RichSpan[] }
  | { kind: 'bullet'; spans: RichSpan[]; marker: string }
  | { kind: 'heading'; spans: RichSpan[] };

/**
 * The little Markdown a coach reply uses, as blocks a screen can lay out.
 *
 * Deliberately small: paragraphs, bullets, numbered items, headings and bold.
 * That is what the brief allows, and a full Markdown dependency for it would
 * render tables nobody asked for. Anything else, italics included, comes
 * through as the text it is.
 */
export function parseRichText(text: string): RichBlock[] {
  const blocks: RichBlock[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', spans: spansOf(paragraph.join(' ')) });
    paragraph = [];
  };

  for (const raw of text.split('\n')) {
    const line = raw.trim();

    if (line.length === 0) {
      flush();
      continue;
    }

    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', spans: spansOf(heading[1]!) });
      continue;
    }

    const bullet = /^(?:[-*•])\s+(.*)$/.exec(line);
    if (bullet) {
      flush();
      blocks.push({ kind: 'bullet', marker: '•', spans: spansOf(bullet[1]!) });
      continue;
    }

    const numbered = /^(\d+)[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      flush();
      blocks.push({ kind: 'bullet', marker: `${numbered[1]}.`, spans: spansOf(numbered[2]!) });
      continue;
    }

    paragraph.push(line);
  }

  flush();
  return blocks;
}

/** `**bold**` and `__bold__`. An unmatched marker is left as text. */
function spansOf(text: string): RichSpan[] {
  const spans: RichSpan[] = [];
  const pattern = /\*\*(.+?)\*\*|__(.+?)__/g;
  let last = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) spans.push({ text: text.slice(last, index), bold: false });
    spans.push({ text: match[1] ?? match[2] ?? '', bold: true });
    last = index + match[0].length;
  }

  if (last < text.length) spans.push({ text: text.slice(last), bold: false });
  return spans;
}
