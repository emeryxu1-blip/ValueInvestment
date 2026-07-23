import { z } from "zod";

const symbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(24)
  .regex(/^[A-Z0-9.-]+$/, "Symbol contains unsupported characters.");

const filterValueSchema = z.union([
  z.string().max(200),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().trim().min(1).max(80)).max(20),
]);

export const savedScreenerFilterSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    category: z.enum([
      "Universe",
      "Valuation",
      "Momentum",
      "Quality",
      "Growth",
    ]),
    label: z.string().trim().min(1).max(200),
    shortLabel: z.string().trim().min(1).max(120),
    field: z.string().trim().min(1).max(80),
    operator: z.enum([
      "eq",
      "neq",
      "gt",
      "gte",
      "lt",
      "lte",
      "in",
      "not_in",
    ]),
    value: filterValueSchema,
    available: z.boolean().optional(),
    unavailableReason: z.string().trim().max(240).optional(),
  })
  .strict();

const savedColumnSchema = z.enum([
  "price",
  "changePercent",
  "marketCap",
  "fairValue",
  "mispricing",
  "pe",
  "revenueGrowth",
]);

const savedSortSchema = z.enum([
  "company",
  "symbol",
  "price",
  "changePercent",
  "marketCap",
  "fairValue",
  "mispricing",
  "pe",
  "revenueGrowth",
]);

export const journalWriteSchema = z
  .object({
    note: z.string().max(20_000).default(""),
    sentiment: z.enum(["bear", "neutral", "bull"]).default("neutral"),
    watchPrice: z.number().finite().positive().max(1_000_000_000_000).nullable().default(null),
  })
  .strict();

export const savedScreenerWriteSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    filters: z.array(savedScreenerFilterSchema).max(40),
    columns: z
      .array(savedColumnSchema)
      .min(1)
      .max(7)
      .refine((columns) => new Set(columns).size === columns.length, {
        message: "Columns must be unique.",
      }),
    sortKey: savedSortSchema,
    sortOrder: z.enum(["asc", "desc"]),
    symbols: z
      .array(symbolSchema)
      .max(1_000)
      .transform((symbols) => [...new Set(symbols)]),
  })
  .strict();

export const savedScreenerIdSchema = z
  .string()
  .uuid("Saved screener id must be a UUID.");

export type JournalWrite = z.infer<typeof journalWriteSchema>;
export type SavedScreenerWrite = z.infer<typeof savedScreenerWriteSchema>;
