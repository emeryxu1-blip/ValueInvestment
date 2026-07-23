import { and, count, desc, eq, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as workspaceSchema from "../../db/schema";
import {
  anonymousSessions,
  savedScreenerBaselineSymbols,
  savedScreeners,
  securityJournal,
  type AnonymousSession,
  type SecurityJournalEntry,
} from "../../db/schema";
import { WorkspaceLimitError, WorkspaceNotFoundError } from "./request";
import type {
  JournalWrite,
  SavedScreenerWrite,
} from "./validation";

const MAX_SAVED_SCREENERS = 100;
// D1 allows at most 100 bound parameters per statement. Each baseline row
// binds three values, so keep bulk inserts comfortably below that ceiling.
const BASELINE_INSERT_CHUNK_SIZE = 30;

export type WorkspaceDatabase = DrizzleD1Database<typeof workspaceSchema>;

export type WorkspaceJournal = {
  exchange: string;
  symbol: string;
  note: string;
  sentiment: "bear" | "neutral" | "bull";
  watchPrice: number | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceSavedScreener = {
  id: string;
  name: string;
  filters: SavedScreenerWrite["filters"];
  columns: SavedScreenerWrite["columns"];
  sortKey: SavedScreenerWrite["sortKey"];
  sortOrder: "asc" | "desc";
  symbols: string[];
  createdAt: string;
  updatedAt: string;
  baselineCapturedAt: string;
};

const iso = (timestamp: number) => new Date(timestamp).toISOString();

function journalResult(row: SecurityJournalEntry): WorkspaceJournal {
  return {
    exchange: row.exchange,
    symbol: row.symbol,
    note: row.note,
    sentiment: row.sentiment,
    watchPrice: row.watchPrice,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

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
  symbols: string[],
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
    symbols,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    baselineCapturedAt: iso(row.baselineCapturedAt),
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

export async function getSecurityJournal(
  db: WorkspaceDatabase,
  sessionId: string,
  exchange: string,
  symbol: string,
): Promise<WorkspaceJournal | null> {
  const [row] = await db
    .select()
    .from(securityJournal)
    .where(
      and(
        eq(securityJournal.sessionId, sessionId),
        eq(securityJournal.exchange, exchange),
        eq(securityJournal.symbol, symbol),
      ),
    )
    .limit(1);
  return row ? journalResult(row) : null;
}

export async function putSecurityJournal(
  db: WorkspaceDatabase,
  sessionId: string,
  exchange: string,
  symbol: string,
  input: JournalWrite,
  now = Date.now(),
): Promise<WorkspaceJournal> {
  const [row] = await db
    .insert(securityJournal)
    .values({
      sessionId,
      exchange,
      symbol,
      note: input.note,
      sentiment: input.sentiment,
      watchPrice: input.watchPrice,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        securityJournal.sessionId,
        securityJournal.exchange,
        securityJournal.symbol,
      ],
      set: {
        note: input.note,
        sentiment: input.sentiment,
        watchPrice: input.watchPrice,
        updatedAt: now,
      },
    })
    .returning();
  return journalResult(row);
}

export async function deleteSecurityJournal(
  db: WorkspaceDatabase,
  sessionId: string,
  exchange: string,
  symbol: string,
): Promise<boolean> {
  const rows = await db
    .delete(securityJournal)
    .where(
      and(
        eq(securityJournal.sessionId, sessionId),
        eq(securityJournal.exchange, exchange),
        eq(securityJournal.symbol, symbol),
      ),
    )
    .returning({ symbol: securityJournal.symbol });
  return rows.length > 0;
}

async function baselineSymbolsByScreener(
  db: WorkspaceDatabase,
  screenerIds: string[],
): Promise<Map<string, string[]>> {
  if (screenerIds.length === 0) return new Map();
  const rows = await db
    .select({
      screenerId: savedScreenerBaselineSymbols.screenerId,
      symbol: savedScreenerBaselineSymbols.symbol,
    })
    .from(savedScreenerBaselineSymbols)
    .where(inArray(savedScreenerBaselineSymbols.screenerId, screenerIds))
    .orderBy(savedScreenerBaselineSymbols.symbol);
  const result = new Map<string, string[]>();
  for (const row of rows) {
    const symbols = result.get(row.screenerId) ?? [];
    symbols.push(row.symbol);
    result.set(row.screenerId, symbols);
  }
  return result;
}

function baselineInsertQueries(
  db: WorkspaceDatabase,
  screenerId: string,
  symbols: string[],
  now: number,
): BatchItem<"sqlite">[] {
  const queries: BatchItem<"sqlite">[] = [];
  for (
    let start = 0;
    start < symbols.length;
    start += BASELINE_INSERT_CHUNK_SIZE
  ) {
    const chunk = symbols.slice(start, start + BASELINE_INSERT_CHUNK_SIZE);
    queries.push(
      db
        .insert(savedScreenerBaselineSymbols)
        .values(
          chunk.map((symbol) => ({
            screenerId,
            symbol,
            createdAt: now,
          })),
        )
        .onConflictDoNothing(),
    );
  }
  return queries;
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
  const symbols = await baselineSymbolsByScreener(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => screenerResult(row, symbols.get(row.id) ?? []));
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
  const symbols = await baselineSymbolsByScreener(db, [id]);
  return screenerResult(row, symbols.get(id) ?? []);
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
    baselineCapturedAt: now,
  };
  const statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
    db.insert(savedScreeners).values(row),
    ...baselineInsertQueries(db, id, input.symbols, now),
  ];
  await db.batch(statements);
  return screenerResult(row, input.symbols);
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
    baselineCapturedAt: now,
  };
  const statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
    db
      .update(savedScreeners)
      .set({
        name: input.name,
        filtersJson: JSON.stringify(input.filters),
        columnsJson: JSON.stringify(input.columns),
        sortKey: input.sortKey,
        sortOrder: input.sortOrder,
        updatedAt: now,
        baselineCapturedAt: now,
      })
      .where(
        and(eq(savedScreeners.id, id), eq(savedScreeners.sessionId, sessionId)),
      ),
    db
      .delete(savedScreenerBaselineSymbols)
      .where(eq(savedScreenerBaselineSymbols.screenerId, id)),
    ...baselineInsertQueries(db, id, input.symbols, now),
  ];
  await db.batch(statements);
  return screenerResult(row, input.symbols);
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
