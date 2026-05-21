import app from "./app";
import { logger } from "./lib/logger";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent boot-time migrations — safe to run on every start.
 * Used for schema fixes that Drizzle Kit's publish diff won't apply
 * automatically (e.g. dropping a NOT NULL constraint).
 */
async function runBootMigrations(): Promise<void> {
  try {
    // Make brand_id nullable on playbook (was erroneously NOT NULL in prod,
    // preventing upload since the playbook is a global company-level document).
    await db.execute(
      sql`ALTER TABLE playbook ALTER COLUMN brand_id DROP NOT NULL`,
    );
    logger.info("boot-migration: playbook.brand_id is now nullable");
  } catch (err: unknown) {
    // Column may not exist yet or already nullable — both are fine.
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("does not exist") && !msg.includes("already")) {
      logger.warn({ err }, "boot-migration: playbook.brand_id — unexpected error (non-fatal)");
    }
  }
  try {
    await db.execute(
      sql`ALTER TABLE playbook_sections ALTER COLUMN brand_id DROP NOT NULL`,
    );
    logger.info("boot-migration: playbook_sections.brand_id is now nullable");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("does not exist") && !msg.includes("already")) {
      logger.warn({ err }, "boot-migration: playbook_sections.brand_id — unexpected error (non-fatal)");
    }
  }
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

await runBootMigrations();

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

// In production the embedded BullMQ workers start alongside the HTTP server
// in the same process — no separate worker process or extra port needed.
// In development the `lib/worker: BullMQ Worker` workflow runs standalone
// so we skip embedding to avoid the pino thread-stream/ESM conflict that
// arises when two pino instances compete for the same worker-file paths.
if (process.env["NODE_ENV"] === "production") {
  import("@workspace/worker/embedded")
    .then(({ startEmbeddedWorkers }) => startEmbeddedWorkers())
    .then((handle) => {
      const shutdown = async (signal: string): Promise<void> => {
        logger.info({ signal }, "server: shutdown initiated");
        server.close();
        await handle.close();
        logger.info("server: shutdown complete");
        process.exit(0);
      };
      process.on("SIGTERM", () => void shutdown("SIGTERM"));
      process.on("SIGINT", () => void shutdown("SIGINT"));
    })
    .catch((err) => {
      logger.error(
        { err },
        "embedded-worker: failed to start — AI jobs will not be processed",
      );
    });
} else {
  const shutdown = (signal: string): void => {
    logger.info({ signal }, "server: shutdown initiated");
    server.close();
    logger.info("server: shutdown complete");
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
