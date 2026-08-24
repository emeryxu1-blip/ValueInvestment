import { and, count, desc, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as workspaceSchema from "../../db/schema";
import {
  anonymousSessions,
  savedScreeners,
  type AnonymousSession,
} from "../../db/schema";
import { WorkspaceLimitError, WorkspaceNotFoundError } from "./request";
import type { SavedScreenerWrite } from "./validation";

const MAX_SAVED_SCREENERS = 100;

export type WorkspaceDatabase = DrizzleD1Database<typeof workspaceSchema>;

export type WorkspaceSavedScreener = {
  id: string;
  name: string;
  filters: SavedScreenerWrite["filters"];
  columns: SavedScreenerWrite["columns"];
  sortKey: SavedScreenerWrite["sortKey"];
  sortOrder: "asc" | "desc";
  createdAt: string;
  updatedAt: string;
};

const iso = (timestamp: number) => new Date(timestamp).toISOString();

function parseStoredArray<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function screenerResult(
  row: typeof savedScreeners.$inferSelect,
): WorkspaceSavedScreener {
  return {
    id: row.id,
    name: row.name,
    filters: parseStoredArray<SavedScreenerWrite["filters"][number]>(
      row.filtersJson,
    ),
    columns: parseStoredArray<SavedScreenerWrite["columns"][number]>(
      row.columnsJson,
    ),
    sortKey: row.sortKey as SavedScreenerWrite["sortKey"],
    sortOrder: row.sortOrder,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export async function findAnonymousSession(
  db: WorkspaceDatabase,
  id: string,
): Promise<AnonymousSession | null> {
  const [session] = await db
    .select()
    .from(anonymousSessions)
    .where(eq(anonymousSessions.id, id))
    .limit(1);
  return session ?? null;
}

export async function insertAnonymousSession(
  db: WorkspaceDatabase,
  session: AnonymousSession,
): Promise<void> {
  await db.insert(anonymousSessions).values(session);
}

export async function touchAnonymousSession(
  db: WorkspaceDatabase,
  id: string,
  lastSeenAt: number,
): Promise<void> {
  await db
    .update(anonymousSessions)
    .set({ lastSeenAt })
    .where(eq(anonymousSessions.id, id));
}

export async function listSavedScreeners(
  db: WorkspaceDatabase,
  sessionId: string,
): Promise<WorkspaceSavedScreener[]> {
  const rows = await db
    .select()
    .from(savedScreeners)
    .where(eq(savedScreeners.sessionId, sessionId))
    .orderBy(desc(savedScreeners.updatedAt), desc(savedScreeners.createdAt))
    .limit(MAX_SAVED_SCREENERS);
  return rows.map(screenerResult);
}

export async function getSavedScreener(
  db: WorkspaceDatabase,
  sessionId: string,
  id: string,
): Promise<WorkspaceSavedScreener | null> {
  const [row] = await db
    .select()
    .from(savedScreeners)
    .where(
      and(eq(savedScreeners.id, id), eq(savedScreeners.sessionId, sessionId)),
    )
    .limit(1);
  if (!row) return null;
  return screenerResult(row);
}

export async function createSavedScreener(
  db: WorkspaceDatabase,
  sessionId: string,
  input: SavedScreenerWrite,
  now = Date.now(),
): Promise<WorkspaceSavedScreener> {
  const [{ value: currentCount }] = await db
    .select({ value: count() })
    .from(savedScreeners)
    .where(eq(savedScreeners.sessionId, sessionId));
  if (currentCount >= MAX_SAVED_SCREENERS) {
    throw new WorkspaceLimitError(
      `A workspace can contain at most ${MAX_SAVED_SCREENERS} saved screeners.`,
    );
  }

  const id = crypto.randomUUID();
  const row: typeof savedScreeners.$inferSelect = {
    id,
    sessionId,
    name: input.name,
    filtersJson: JSON.stringify(input.filters),
    columnsJson: JSON.stringify(input.columns),
    sortKey: input.sortKey,
    sortOrder: input.sortOrder,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(savedScreeners).values(row);
  return screenerResult(row);
}

export async function replaceSavedScreener(
  db: WorkspaceDatabase,
  sessionId: string,
  id: string,
  input: SavedScreenerWrite,
  now = Date.now(),
): Promise<WorkspaceSavedScreener> {
  const [existing] = await db
    .select()
    .from(savedScreeners)
    .where(
      and(eq(savedScreeners.id, id), eq(savedScreeners.sessionId, sessionId)),
    )
    .limit(1);
  if (!existing) {
    throw new WorkspaceNotFoundError("The saved screener was not found.");
  }

  const row: typeof savedScreeners.$inferSelect = {
    ...existing,
    name: input.name,
    filtersJson: JSON.stringify(input.filters),
    columnsJson: JSON.stringify(input.columns),
    sortKey: input.sortKey,
    sortOrder: input.sortOrder,
    updatedAt: now,
  };
  await db
    .update(savedScreeners)
    .set({
      name: input.name,
      filtersJson: JSON.stringify(input.filters),
      columnsJson: JSON.stringify(input.columns),
      sortKey: input.sortKey,
      sortOrder: input.sortOrder,
      updatedAt: now,
    })
    .where(
      and(eq(savedScreeners.id, id), eq(savedScreeners.sessionId, sessionId)),
    );
  return screenerResult(row);
}

export async function deleteSavedScreener(
  db: WorkspaceDatabase,
  sessionId: string,
  id: string,
): Promise<void> {
  const rows = await db
    .delete(savedScreeners)
    .where(
      and(eq(savedScreeners.id, id), eq(savedScreeners.sessionId, sessionId)),
    )
    .returning({ id: savedScreeners.id });
  if (rows.length === 0) {
    throw new WorkspaceNotFoundError("The saved screener was not found.");
  }
}
