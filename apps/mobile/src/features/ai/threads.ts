/**
 * Stored conversations.
 *
 * Plain inserts, no oplog, no `touch()`. Both tables are outside
 * `SYNCABLE_TABLES` on purpose (see the note on the schema), and the type
 * system enforces it: `trackUpsert` takes a `SyncableTable`, so there is no way
 * to accidentally queue one of these rows for a server that would reject the
 * whole batch it travelled in.
 *
 * Messages are positioned rather than ordered by `createdAt`. Two turns of a
 * fast exchange can land in the same millisecond, and a conversation that
 * renders its question after its answer is worse than one that renders slowly.
 */

import { COACH_PROMPT_VERSION, uuidv7, type AiMessage, type CoachThreadKind } from '@lift/shared';
import { and, asc, desc, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { coachMessages, coachThreads } from '@/db/schema';

export interface CoachThread {
  id: string;
  kind: CoachThreadKind;
  title: string;
  subjectId: string | null;
  model: string;
  promptVersion: number;
  createdAt: number;
  updatedAt: number;
}

export async function createThread(input: {
  kind: CoachThreadKind;
  title: string;
  model: string;
  subjectId?: string | null;
}): Promise<string> {
  const id = uuidv7();
  const now = Date.now();

  await db.insert(coachThreads).values({
    id,
    kind: input.kind,
    title: input.title,
    subjectId: input.subjectId ?? null,
    promptVersion: COACH_PROMPT_VERSION,
    model: input.model,
    createdAt: now,
    updatedAt: now,
  });

  return id;
}

/**
 * Appends a turn.
 *
 * `position` is read as "one past the highest", not "count of rows", so a
 * deleted turn cannot make two messages collide on the same position.
 */
export async function appendMessage(
  threadId: string,
  message: AiMessage,
): Promise<string> {
  const [last] = await db
    .select({ position: coachMessages.position })
    .from(coachMessages)
    .where(eq(coachMessages.threadId, threadId))
    .orderBy(desc(coachMessages.position))
    .limit(1);

  const id = uuidv7();

  await db.insert(coachMessages).values({
    id,
    threadId,
    role: message.role,
    content: message.content,
    position: (last?.position ?? 0) + 1,
    createdAt: Date.now(),
  });

  // So a thread list can order by "last spoken to" rather than by when it was
  // opened, which for a conversation resumed weeks later is the wrong order.
  await db.update(coachThreads).set({ updatedAt: Date.now() }).where(eq(coachThreads.id, threadId));

  return id;
}

export async function readMessages(threadId: string): Promise<AiMessage[]> {
  const rows = await db
    .select({ role: coachMessages.role, content: coachMessages.content })
    .from(coachMessages)
    .where(eq(coachMessages.threadId, threadId))
    .orderBy(asc(coachMessages.position));

  return rows.map((row) => ({ role: row.role, content: row.content }));
}

export async function listThreads(kind: CoachThreadKind): Promise<CoachThread[]> {
  return db
    .select()
    .from(coachThreads)
    .where(eq(coachThreads.kind, kind))
    .orderBy(desc(coachThreads.updatedAt));
}

/**
 * The stored answer for one workout, if there is one.
 *
 * This is what stops a finish-screen summary being regenerated, and re-billed,
 * every time somebody reopens a session they trained last Tuesday. The
 * `promptVersion` comes back with it so a caller can decide whether an answer
 * written against an older document is still worth showing.
 */
export async function findThreadFor(
  kind: CoachThreadKind,
  subjectId: string,
): Promise<CoachThread | null> {
  const [row] = await db
    .select()
    .from(coachThreads)
    .where(and(eq(coachThreads.kind, kind), eq(coachThreads.subjectId, subjectId)))
    .orderBy(desc(coachThreads.updatedAt))
    .limit(1);

  return row ?? null;
}

/** Messages cascade: the foreign key carries `onDelete: 'cascade'`. */
export async function deleteThread(threadId: string): Promise<void> {
  await db.delete(coachThreads).where(eq(coachThreads.id, threadId));
}
