import { pgTable, uuid, text, timestamp, jsonb, integer, index } from "drizzle-orm/pg-core";

// Sprint 2 — system table (Pattern C, no brand_id). Receives every BullMQ
// job that exhausts its retry budget. Rendered on /admin/system.
export const deadJobsTable = pgTable(
  "dead_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    queueName: text("queue_name").notNull(),
    jobName: text("job_name").notNull(),
    jobId: text("job_id").notNull(),
    payload: jsonb("payload").notNull().default({}),
    failureReason: text("failure_reason").notNull(),
    stack: text("stack"),
    attemptsMade: integer("attempts_made").notNull().default(0),
    failedAt: timestamp("failed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("dead_jobs_failed_at_idx").on(t.failedAt.desc()),
    index("dead_jobs_queue_idx").on(t.queueName, t.failedAt.desc()),
  ],
);

export type DeadJob = typeof deadJobsTable.$inferSelect;
export type InsertDeadJob = typeof deadJobsTable.$inferInsert;
