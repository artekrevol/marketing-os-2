import app from "./app";
import { logger } from "./lib/logger";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import bcrypt from "bcryptjs";

/**
 * Idempotent boot-time migrations — safe to run on every start.
 */
async function runBootMigrations(): Promise<void> {
  try {
    await db.execute(
      sql`ALTER TABLE playbook ALTER COLUMN brand_id DROP NOT NULL`,
    );
    logger.info("boot-migration: playbook.brand_id is now nullable");
  } catch (err: unknown) {
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

  try {
    await db.execute(
      sql`ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS password_hash TEXT`,
    );
    logger.info("boot-migration: user_profiles.password_hash column ensured");
  } catch (err: unknown) {
    logger.warn({ err }, "boot-migration: user_profiles.password_hash — unexpected error (non-fatal)");
  }

  const adminPassword = process.env["ADMIN_PASSWORD"];
  const seedEmails = (process.env["SEED_ADMIN_EMAILS"] ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (adminPassword && seedEmails.length > 0) {
    const hash = await bcrypt.hash(adminPassword, 12);
    for (const email of seedEmails) {
      try {
        const existing = await db.execute(
          sql`SELECT user_id FROM user_profiles WHERE email = ${email} LIMIT 1`,
        );
        if (existing.rows.length > 0) {
          const userId = (existing.rows[0] as { user_id: string }).user_id;
          await db.execute(
            sql`UPDATE user_profiles SET password_hash = ${hash}, role = 'admin', updated_at = now() WHERE user_id = ${userId}`,
          );
          logger.info(`boot-migration: seeded admin password for ${email} (existing user)`);
        } else {
          const userId = `local:${email}`;
          await db.execute(
            sql`INSERT INTO user_profiles (user_id, email, role, brand_access, password_hash, created_at, updated_at)
                VALUES (${userId}, ${email}, 'admin', '{}', ${hash}, now(), now())
                ON CONFLICT (user_id) DO UPDATE SET password_hash = ${hash}, role = 'admin', updated_at = now()`,
          );
          logger.info(`boot-migration: seeded new admin user for ${email}`);
        }
      } catch (err: unknown) {
        logger.warn({ err, email }, "boot-migration: failed to seed admin password (non-fatal)");
      }
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
