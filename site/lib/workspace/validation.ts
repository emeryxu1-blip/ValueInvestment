import { z } from "zod";

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
  })
  .strict();

export const savedScreenerIdSchema = z
  .string()
  .uuid("Saved screener id must be a UUID.");

export type SavedScreenerWrite = z.infer<typeof savedScreenerWriteSchema>;
