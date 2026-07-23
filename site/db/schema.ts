import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
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
    baselineCapturedAt: integer("baseline_captured_at").notNull(),
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

export const savedScreenerBaselineSymbols = sqliteTable(
  "saved_screener_baseline_symbols",
  {
    screenerId: text("screener_id")
      .notNull()
      .references(() => savedScreeners.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({
      name: "saved_screener_baseline_symbols_pk",
      columns: [table.screenerId, table.symbol],
    }),
    index("saved_screener_baseline_symbol_idx").on(table.symbol),
  ],
);

export type AnonymousSession = typeof anonymousSessions.$inferSelect;
export type SecurityJournalEntry = typeof securityJournal.$inferSelect;
export type SavedScreener = typeof savedScreeners.$inferSelect;
