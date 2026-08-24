import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const anonymousSessions = sqliteTable(
  "anonymous_sessions",
  {
    // The browser receives an opaque random token. Only its SHA-256 digest is
    // stored here so a database read does not expose usable session cookies.
    id: text("id").primaryKey(),
    createdAt: integer("created_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [
    index("anonymous_sessions_expires_at_idx").on(table.expiresAt),
    check(
      "anonymous_sessions_expiry_check",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
  ],
);

export const securityJournal = sqliteTable(
  "security_journal",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => anonymousSessions.id, { onDelete: "cascade" }),
    exchange: text("exchange").notNull(),
    symbol: text("symbol").notNull(),
    note: text("note").notNull().default(""),
    sentiment: text("sentiment", {
      enum: ["bear", "neutral", "bull"],
    })
      .notNull()
      .default("neutral"),
    watchPrice: real("watch_price"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({
      name: "security_journal_pk",
      columns: [table.sessionId, table.exchange, table.symbol],
    }),
    index("security_journal_session_updated_idx").on(
      table.sessionId,
      table.updatedAt,
    ),
    check(
      "security_journal_sentiment_check",
      sql`${table.sentiment} in ('bear', 'neutral', 'bull')`,
    ),
    check(
      "security_journal_watch_price_check",
      sql`${table.watchPrice} is null or ${table.watchPrice} > 0`,
    ),
  ],
);

export const savedScreeners = sqliteTable(
  "saved_screeners",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => anonymousSessions.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    filtersJson: text("filters_json").notNull(),
    columnsJson: text("columns_json").notNull(),
    sortKey: text("sort_key").notNull(),
    sortOrder: text("sort_order", { enum: ["asc", "desc"] }).notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("saved_screeners_session_updated_idx").on(
      table.sessionId,
      table.updatedAt,
    ),
    check(
      "saved_screeners_sort_order_check",
      sql`${table.sortOrder} in ('asc', 'desc')`,
    ),
  ],
);

export const topMarketCapUniverse = sqliteTable(
  "top_market_cap_universe",
  {
    marketCode: text("market_code").primaryKey(),
    exchange: text("exchange").notNull(),
    symbol: text("symbol").notNull(),
    marketCap: real("market_cap").notNull(),
    marketRank: integer("market_rank").notNull(),
    refreshedAt: integer("refreshed_at").notNull(),
  },
  (table) => [
    uniqueIndex("top_market_cap_universe_rank_idx").on(table.marketRank),
    check(
      "top_market_cap_universe_rank_check",
      sql`${table.marketRank} between 1 and 1000`,
    ),
    check(
      "top_market_cap_universe_market_cap_check",
      sql`${table.marketCap} >= 0`,
    ),
  ],
);

export const screenerSnapshotGenerations = sqliteTable(
  "screener_snapshot_generations",
  {
    id: text("id").primaryKey(),
    universeRefreshedAt: integer("universe_refreshed_at").notNull(),
    refreshedAt: integer("refreshed_at").notNull(),
    rowCount: integer("row_count").notNull(),
    createdAt: integer("created_at").notNull(),
    // Version 0 marks generations created before precomputed mask semantics
    // were persisted. Readers reject anything except their current version.
    filterMaskSchemaVersion: integer("filter_mask_schema_version")
      .notNull()
      .default(0),
    clientPayloadJson: text("client_payload_json").notNull().default("{}"),
    clientPayloadEtag: text("client_payload_etag").notNull().default(""),
  },
  (table) => [
    index("screener_snapshot_generations_created_idx").on(table.createdAt),
    check(
      "screener_snapshot_generations_row_count_check",
      sql`${table.rowCount} between 1 and 1000`,
    ),
  ],
);

export const screenerSnapshotRows = sqliteTable(
  "screener_snapshot_rows",
  {
    generationId: text("generation_id")
      .notNull()
      .references(() => screenerSnapshotGenerations.id, { onDelete: "cascade" }),
    marketCode: text("market_code").notNull(),
    exchange: text("exchange").notNull(),
    symbol: text("symbol").notNull(),
    payloadJson: text("payload_json").notNull(),
  },
  (table) => [
    primaryKey({
      name: "screener_snapshot_rows_pk",
      columns: [table.generationId, table.marketCode],
    }),
    check(
      "screener_snapshot_rows_payload_check",
      sql`json_valid(${table.payloadJson})`,
    ),
  ],
);

export const screenerSnapshotState = sqliteTable(
  "screener_snapshot_state",
  {
    id: integer("id").primaryKey(),
    activeGenerationId: text("active_generation_id").references(
      () => screenerSnapshotGenerations.id,
    ),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check("screener_snapshot_state_singleton_check", sql`${table.id} = 1`),
  ],
);

export const screenerSnapshotDailyRuns = sqliteTable(
  "screener_snapshot_daily_runs",
  {
    tradingDate: text("trading_date").primaryKey(),
    status: text("status", {
      enum: ["running", "complete", "failed"],
    }).notNull(),
    scheduledAt: integer("scheduled_at").notNull(),
    startedAt: integer("started_at").notNull(),
    completedAt: integer("completed_at"),
    generationId: text("generation_id").references(
      () => screenerSnapshotGenerations.id,
      { onDelete: "set null" },
    ),
    attemptCount: integer("attempt_count").notNull().default(1),
    leaseToken: text("lease_token").notNull(),
    errorMessage: text("error_message"),
  },
  (table) => [
    index("screener_snapshot_daily_runs_status_idx").on(
      table.status,
      table.startedAt,
    ),
    check(
      "screener_snapshot_daily_runs_date_check",
      sql`${table.tradingDate} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
    check(
      "screener_snapshot_daily_runs_attempt_check",
      sql`${table.attemptCount} >= 1`,
    ),
    check(
      "screener_snapshot_daily_runs_status_check",
      sql`${table.status} in ('running', 'complete', 'failed')`,
    ),
    check(
      "screener_snapshot_daily_runs_completion_check",
      sql`(
        (${table.status} = 'running' and ${table.completedAt} is null and ${table.generationId} is null)
        or (${table.status} = 'complete' and ${table.completedAt} is not null)
        or (${table.status} = 'failed' and ${table.completedAt} is not null and ${table.generationId} is null)
      )`,
    ),
  ],
);

export type AnonymousSession = typeof anonymousSessions.$inferSelect;
export type SecurityJournalEntry = typeof securityJournal.$inferSelect;
export type SavedScreener = typeof savedScreeners.$inferSelect;
export type TopMarketCapUniverseMember =
  typeof topMarketCapUniverse.$inferSelect;
export type ScreenerSnapshotGeneration =
  typeof screenerSnapshotGenerations.$inferSelect;
export type ScreenerSnapshotRow = typeof screenerSnapshotRows.$inferSelect;
export type ScreenerSnapshotDailyRun =
  typeof screenerSnapshotDailyRuns.$inferSelect;
