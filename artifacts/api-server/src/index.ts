import app from "./app";
import { logger } from "./lib/logger";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Apply pending Drizzle migrations from `lib/db/drizzle/`.
 * Uses IF NOT EXISTS DDL so re-running against an already-migrated DB
 * (e.g. the dev DB where Ahrefs tables were created via raw SQL) is safe.
 * The migrator tracks applied migrations in `__drizzle_migrations`.
 */
async function runMigrations(): Promise<void> {
  // Resolve path from the compiled dist/ directory up to lib/db/drizzle/
  const migrationsFolder = path.join(__dirname, "../../../lib/db/drizzle");
  try {
    await migrate(db, { migrationsFolder });
    logger.info("boot-migrations: all pending migrations applied");
  } catch (err: unknown) {
    logger.error({ err }, "boot-migrations: failed to apply migrations");
    throw err;
  }
}

/**
 * Boot-time schema bootstrap — narrow, idempotent safety net.
 *
 * Handles the two objects that must exist BEFORE Drizzle migrations can run
 * (the session table is used by express-session; password_hash is needed for
 * the very first admin login which the migration runner itself may trigger).
 */
async function bootstrapSchema(): Promise<void> {
  try {
    await db.execute(
      sql`ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS password_hash text`,
    );
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "session" (
        "sid"    varchar      NOT NULL,
        "sess"   json         NOT NULL,
        "expire" timestamp(6) NOT NULL,
        CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
      )
    `);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire")`,
    );
    logger.info("boot-schema: session table + password_hash column ensured");
  } catch (err: unknown) {
    logger.error({ err }, "boot-schema: failed to ensure required objects");
    throw err;
  }
}

/**
 * Boot-time cleanup — removes known bad data idempotently.
 * Safe to run on every boot; all operations are guarded so re-running is a no-op.
 */
async function runBootCleanup(): Promise<void> {
  try {
    // Remove competitor pages captured from the orphan keyword "marketing os smoke"
    // (list_id IS NULL) which produced tobacco-industry SERP results. Idempotent.
    const pages = await db.execute(sql`
      DELETE FROM competitor_pages
      WHERE keyword_id IN (
        SELECT id FROM keywords
        WHERE keyword_text = 'marketing os smoke'
          AND list_id IS NULL
      )
    `);
    const kw = await db.execute(sql`
      DELETE FROM keywords
      WHERE keyword_text = 'marketing os smoke'
        AND list_id IS NULL
    `);
    const deletedPages = pages.rowCount ?? 0;
    const deletedKw = kw.rowCount ?? 0;
    if (deletedPages > 0 || deletedKw > 0) {
      logger.info(
        { deletedPages, deletedKw },
        "boot-cleanup: removed tobacco-keyword data",
      );
    }
  } catch (err: unknown) {
    // Non-fatal — log and continue. The quality guard on the worker prevents re-ingestion.
    logger.warn({ err }, "boot-cleanup: failed (non-fatal)");
  }
}

/**
 * Boot-time data seeding (admin users, baseline brands, default QA checks).
 * Schema is owned by Drizzle — schema patches belong in proper migrations,
 * not here. The narrow exception is `bootstrapSchema()` above.
 */
async function runBootSeeds(): Promise<void> {
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

  // Seed the four baseline brand tenants. UUIDs match dev so cross-environment
  // data references stay stable. ON CONFLICT keeps this idempotent — manual
  // edits to brand rows in production are preserved on subsequent boots.
  const SEED_BRANDS: Array<{
    id: string;
    slug: string;
    name: string;
    primaryDomain: string;
  }> = [
    { id: "2d10bb54-ba9a-4444-8a18-a262bca9b2bc", slug: "tekrevol", name: "TekRevol", primaryDomain: "tekrevol.com" },
    { id: "cb798bf3-9fbf-40db-a36a-0806a02205ab", slug: "claimshield", name: "ClaimShield", primaryDomain: "claimshield.io" },
    { id: "932fc5fa-de80-4d52-8512-1aa908b8d98a", slug: "reverto", name: "Reverto", primaryDomain: "reverto.com" },
    { id: "3a976040-dc9b-47eb-b9d8-4deb8aef2d1b", slug: "censusflow", name: "CensusFlow", primaryDomain: "censusflow.com" },
  ];

  const DEFAULT_THRESHOLDS = JSON.stringify({
    originality_min: 0.7,
    reading_grade_target: 9,
  });

  let seededBrandCount = 0;
  for (const b of SEED_BRANDS) {
    try {
      const result = await db.execute(
        sql`INSERT INTO brands (id, slug, name, primary_domain, voice_profile, thresholds, created_at, updated_at)
            VALUES (${b.id}::uuid, ${b.slug}, ${b.name}, ${b.primaryDomain}, '{}'::jsonb, ${DEFAULT_THRESHOLDS}::jsonb, now(), now())
            ON CONFLICT (id) DO NOTHING`,
      );
      if (result.rowCount && result.rowCount > 0) {
        seededBrandCount++;
        logger.info(`boot-migration: seeded brand ${b.slug}`);
      }
    } catch (err: unknown) {
      logger.warn({ err, brand: b.slug }, "boot-migration: failed to seed brand (non-fatal)");
    }
  }
  if (seededBrandCount === 0) {
    logger.info("boot-migration: all seed brands already present");
  }

  // Grant every seeded admin email full access to all seed brands, but only
  // if their brand_access is currently empty — never clobber a manual grant.
  if (seedEmails.length > 0) {
    // Build a Postgres array literal: '{uuid1,uuid2,...}'. UUIDs come from a
    // hard-coded allowlist above, so direct interpolation is safe here.
    const allBrandsLiteral = `{${SEED_BRANDS.map((b) => b.id).join(",")}}`;
    for (const email of seedEmails) {
      try {
        const result = await db.execute(
          sql`UPDATE user_profiles
              SET brand_access = ${allBrandsLiteral}::uuid[], updated_at = now()
              WHERE email = ${email}
                AND (brand_access IS NULL OR cardinality(brand_access) = 0)`,
        );
        if (result.rowCount && result.rowCount > 0) {
          logger.info(`boot-migration: granted full brand access to ${email}`);
        }
      } catch (err: unknown) {
        logger.warn({ err, email }, "boot-migration: failed to grant brand access (non-fatal)");
      }
    }
  }

  // Seed the default Quality-Gate checks for any brand that has none. Every
  // brand needs these 4 rows for the Quality Gate workflow to evaluate drafts.
  const DEFAULT_QA_CHECKS: Array<{
    name: string;
    severity: "hard" | "warn";
    threshold: number;
  }> = [
    { name: "originality", severity: "hard", threshold: 0.7 },
    { name: "brief_compliance", severity: "hard", threshold: 0.75 },
    { name: "brand_voice", severity: "warn", threshold: 0.6 },
    { name: "reading_level", severity: "warn", threshold: 9.0 },
  ];

  try {
    const brandRows = await db.execute(
      sql`SELECT id::text AS id FROM brands
          WHERE id NOT IN (SELECT DISTINCT brand_id FROM qa_check_definitions WHERE brand_id IS NOT NULL)`,
    );
    for (const row of brandRows.rows as Array<{ id: string }>) {
      for (const c of DEFAULT_QA_CHECKS) {
        try {
          await db.execute(
            sql`INSERT INTO qa_check_definitions (brand_id, check_name, severity, enabled, threshold, config, created_at, updated_at)
                VALUES (${row.id}::uuid, ${c.name}, ${c.severity}, true, ${c.threshold}, '{}'::jsonb, now(), now())`,
          );
        } catch (err: unknown) {
          logger.warn({ err, brandId: row.id, check: c.name }, "boot-migration: failed to seed qa check (non-fatal)");
        }
      }
      logger.info(`boot-migration: seeded default QA checks for brand ${row.id}`);
    }
  } catch (err: unknown) {
    logger.warn({ err }, "boot-migration: failed to seed QA checks (non-fatal)");
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

await bootstrapSchema();
await runMigrations();
await runBootCleanup();
await runBootSeeds();

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

/* Long-running AI routes (final-stitch with rewrite passes + live stat
 * verification) can exceed Node's 5-minute default request timeout.
 * Raise it to 15 minutes. */
server.requestTimeout = 900_000;
server.headersTimeout = 910_000;

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
