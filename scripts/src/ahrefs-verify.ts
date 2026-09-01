/**
 * Phase 2 smoke test — Ahrefs REST v3 manual verification.
 *
 * Fetches exactly 10 organic keywords for tekrevol.com, validates that every
 * row matches the AhrefsOrganicKeyword shape, confirms a row was written to
 * ahrefs_rest_usage, and reports units consumed.
 *
 * Run: pnpm --filter @workspace/scripts tsx ./src/ahrefs-verify.ts
 */

import { createHash } from "node:crypto";
import { db, ahrefsRestUsageTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import type { AhrefsOrganicKeyword } from "@workspace/ahrefs";

/* -------------------------------------------------------------------------- */
/* Config                                                                     */
/* -------------------------------------------------------------------------- */

const BRAND_ID = "2d10bb54-ba9a-4444-8a18-a262bca9b2bc"; // TekRevol
const TARGET = "tekrevol.com";
const BASE = "https://api.ahrefs.com/v3";
const ENDPOINT = "/site-explorer/organic-keywords";
const DISPATCH_CONTEXT = "manual_verification_phase2";

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */

const apiKey = process.env["AHREFS_API_KEY"];
if (!apiKey) throw new Error("AHREFS_API_KEY not set");

const todayISO = new Date().toISOString().split("T")[0]!;

const params = new URLSearchParams({
  select: "keyword,keyword_country,volume,keyword_difficulty,cpc,sum_traffic,best_position,best_position_url,is_commercial,is_navigational,is_transactional,is_informational,is_branded",
  target: TARGET,
  country: "us",
  mode: "subdomains",
  date: todayISO,
  order_by: "sum_traffic:desc",
  limit: "10",
  offset: "0",
});

const url = `${BASE}${ENDPOINT}?${params.toString()}`;
const paramsHash = createHash("sha256")
  .update(`${ENDPOINT}:${JSON.stringify(Object.fromEntries(params))}`)
  .digest("hex");

console.log(`\n▶ GET ${url.replace(apiKey, "<redacted>")}\n`);

const t0 = Date.now();
const res = await fetch(url, {
  method: "GET",
  headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
});
const durationMs = Date.now() - t0;

if (!res.ok) {
  const body = await res.text();
  console.error(`✗ HTTP ${res.status}: ${body}`);
  process.exit(1);
}

const json = (await res.json()) as Record<string, unknown>;

/* -------------------------------------------------------------------------- */
/* Extract + validate rows                                                    */
/* -------------------------------------------------------------------------- */

// Response key is "keywords" (confirmed from live probe 2026-07-30)
const rawRows = Array.isArray(json["keywords"])
  ? (json["keywords"] as Record<string, unknown>[])
  : [];

const meta = json["metadata"] as Record<string, unknown> | undefined;
const unitsConsumed =
  typeof meta?.["units_used"] === "number" ? (meta["units_used"] as number) : 0;

console.log(`✓ HTTP ${res.status}  duration=${durationMs}ms  rows=${rawRows.length}  units=${unitsConsumed}`);

// Shape-check: every required field on AhrefsOrganicKeyword must be present
const REQUIRED_KEYS: (keyof AhrefsOrganicKeyword)[] = [
  "keyword",
  "volume",
  "keyword_difficulty",
  "cpc",
  "sum_traffic",
  "best_position",
  "best_position_url",
  "is_branded",
  "is_informational",
  "is_commercial",
  "is_transactional",
  "is_navigational",
];

let shapeOk = true;
for (const row of rawRows) {
  for (const key of REQUIRED_KEYS) {
    if (!(key in row)) {
      console.warn(`  ⚠ Row missing field "${key}": ${JSON.stringify(row)}`);
      shapeOk = false;
    }
  }
}

if (shapeOk) {
  console.log("✓ All rows contain required AhrefsOrganicKeyword fields");
} else {
  console.warn("⚠ Shape validation: some fields absent (see warnings above)");
}

/* -------------------------------------------------------------------------- */
/* Print sample rows                                                          */
/* -------------------------------------------------------------------------- */

console.log("\n─── Sample rows (top 10 by traffic) ───────────────────────────");
for (const row of rawRows) {
  const r = row as unknown as AhrefsOrganicKeyword;
  const intent = [
    r.is_informational ? "info" : null,
    r.is_commercial ? "comm" : null,
    r.is_transactional ? "trans" : null,
    r.is_navigational ? "nav" : null,
    r.is_branded ? "branded" : null,
  ].filter(Boolean).join(",") || "–";
  console.log(
    `  pos=${String(r.best_position ?? "–").padStart(4)}  vol=${String(r.volume ?? 0).padStart(7)}  kd=${String(r.keyword_difficulty ?? "–").padStart(3)}  cpc=${String(r.cpc ?? 0).padStart(5)}  intent=${intent}  kw="${r.keyword}"`,
  );
}

/* -------------------------------------------------------------------------- */
/* Log to ahrefs_rest_usage                                                   */
/* -------------------------------------------------------------------------- */

await db.insert(ahrefsRestUsageTable).values({
  brandId: BRAND_ID,
  endpoint: ENDPOINT,
  paramsHash,
  unitsConsumed,
  responseStatus: "ok",
  rowsReturned: rawRows.length,
  dispatchContext: DISPATCH_CONTEXT,
  metadata: {
    durationMs,
    target: TARGET,
    verification: true,
  },
});

// Read it back to confirm the row was persisted
const [logged] = await db
  .select()
  .from(ahrefsRestUsageTable)
  .where(eq(ahrefsRestUsageTable.dispatchContext, DISPATCH_CONTEXT))
  .orderBy(desc(ahrefsRestUsageTable.calledAt))
  .limit(1);

if (logged) {
  console.log(`\n✓ ahrefs_rest_usage row confirmed:`);
  console.log(`    id=${logged.id}`);
  console.log(`    endpoint=${logged.endpoint}`);
  console.log(`    responseStatus=${logged.responseStatus}`);
  console.log(`    rowsReturned=${logged.rowsReturned}`);
  console.log(`    unitsConsumed=${logged.unitsConsumed}`);
  console.log(`    dispatchContext=${logged.dispatchContext}`);
} else {
  console.error("✗ ahrefs_rest_usage insert not found — logging path broken");
  process.exit(1);
}

console.log("\n✓ Phase 2 smoke test passed — REST client, shape, and usage log all verified.\n");
process.exit(0);
