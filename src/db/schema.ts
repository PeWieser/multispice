import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const edaProjects = pgTable(
  "eda_projects",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    document: jsonb("document").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("eda_projects_updated_at_idx").on(table.updatedAt)],
);
