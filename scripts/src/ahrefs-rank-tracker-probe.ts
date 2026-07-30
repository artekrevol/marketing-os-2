/**
 * Probe script: discover the correct base URL and shape for Ahrefs Rank Tracker endpoints.
 *
 * Tests:
 *   1. Base-URL discovery — which prefix returns 200?
 *   2. /management/projects — get TekRevol project_id
 *   3. /management/project-keywords?project_id=<id> — configured keyword list (~454)
 *   4. /rank-tracker/overview?project_id=<id>&date=<today>&device=desktop — live rank data
 */

const API_KEY = process.env.AHREFS_API_KEY!;
if (!API_KEY) throw new Error("AHREFS_API_KEY is not set");

const TODAY = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

async function probe(url: string, label: string): Promise<{ status: number; body: any }> {
  console.log(`\n→ [${label}] GET ${url}`);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 500);
  }
  console.log(`  HTTP ${res.status}`);
  return { status: res.status, body };
}

function pp(obj: any, maxDepth = 3): void {
  console.log(JSON.stringify(obj, null, 2).split("\n").slice(0, 80).join("\n"));
}

// ─────────────────────────────────────────────
// Step 1 — Base URL discovery
// ─────────────────────────────────────────────

async function discoverBaseUrl(): Promise<string | null> {
  console.log("\n═══════════════════════════════════════════");
  console.log("STEP 1 — Base URL discovery");
  console.log("═══════════════════════════════════════════");

  const candidates = [
    // No-prefix variants
    "https://api.ahrefs.com/management/projects",
    // v3 prefix (previously 404 on rank-tracker but let's confirm management)
    "https://api.ahrefs.com/v3/management/projects",
    // v4 just in case
    "https://api.ahrefs.com/v4/management/projects",
    // Direct rank-tracker with no prefix
    "https://api.ahrefs.com/rank-tracker/overview",
    // v3 rank-tracker (previously 404 — confirm)
    "https://api.ahrefs.com/v3/rank-tracker/overview",
  ];

  const results = await Promise.all(
    candidates.map((url) => probe(url, url.replace("https://api.ahrefs.com", "")))
  );

  console.log("\n─── Base URL summary ───");
  candidates.forEach((url, i) => {
    const r = results[i];
    const path = url.replace("https://api.ahrefs.com", "");
    console.log(`  ${r.status === 200 ? "✓" : r.status === 400 ? "?" : "✗"}  ${r.status}  ${path}`);
  });

  // Determine management base URL
  const mgmtIdx = [0, 1, 2].find((i) => results[i].status === 200 || results[i].status === 400);
  if (mgmtIdx === undefined) {
    console.log("\n✗ No management/projects endpoint returned 200 or 400. Printing first error body:");
    pp(results[0].body);
    return null;
  }

  const workingBase = ["https://api.ahrefs.com", "https://api.ahrefs.com/v3", "https://api.ahrefs.com/v4"][mgmtIdx];
  console.log(`\n✓ Management base URL appears to be: ${workingBase}`);

  // Also print bodies for any 200/400 to understand shape
  results.forEach((r, i) => {
    if (r.status === 200 || r.status === 400) {
      console.log(`\n  Body for [${candidates[i].replace("https://api.ahrefs.com", "")}]:`);
      pp(r.body);
    }
  });

  return workingBase;
}

// ─────────────────────────────────────────────
// Step 2 — List projects
// ─────────────────────────────────────────────

async function listProjects(base: string): Promise<string | null> {
  console.log("\n═══════════════════════════════════════════");
  console.log("STEP 2 — /management/projects");
  console.log("═══════════════════════════════════════════");

  const { status, body } = await probe(`${base}/management/projects`, "management/projects");
  console.log(`HTTP ${status}`);
  pp(body);

  if (status !== 200) {
    // Try with a select param in case it requires one
    const { status: s2, body: b2 } = await probe(
      `${base}/management/projects?select=id,title,url`,
      "management/projects?select=..."
    );
    console.log(`HTTP ${s2}`);
    pp(b2);
    if (s2 !== 200) return null;
    pp(b2);
    const projects: any[] = b2?.projects ?? b2?.data ?? (Array.isArray(b2) ? b2 : []);
    return findTekRevolProject(projects);
  }

  const projects: any[] = body?.projects ?? body?.data ?? (Array.isArray(body) ? body : []);
  console.log(`\nTotal projects returned: ${projects.length}`);
  projects.forEach((p: any, i: number) => {
    console.log(`  [${i}] id=${p.id ?? p.project_id} title="${p.title ?? p.name}" url="${p.url ?? p.domain ?? ""}"`);
  });

  return findTekRevolProject(projects);
}

function findTekRevolProject(projects: any[]): string | null {
  const tek = projects.find(
    (p: any) =>
      (p.url ?? p.domain ?? "").toLowerCase().includes("tekrevol") ||
      (p.title ?? p.name ?? "").toLowerCase().includes("tekrevol")
  );
  if (tek) {
    const id = tek.id ?? tek.project_id;
    console.log(`\n✓ TekRevol project found: id=${id}`);
    return String(id);
  }
  console.log("\n? TekRevol project not found by name — using first project id for shape exploration");
  if (projects.length > 0) {
    const id = projects[0].id ?? projects[0].project_id;
    console.log(`  Using project: id=${id} title="${projects[0].title ?? projects[0].name}"`);
    return String(id);
  }
  return null;
}

// ─────────────────────────────────────────────
// Step 3 — Keyword list
// ─────────────────────────────────────────────

async function listKeywords(base: string, projectId: string): Promise<void> {
  console.log("\n═══════════════════════════════════════════");
  console.log("STEP 3 — /management/project-keywords");
  console.log("═══════════════════════════════════════════");

  const url = `${base}/management/project-keywords?project_id=${projectId}`;
  const { status, body } = await probe(url, "management/project-keywords");
  console.log(`HTTP ${status}`);

  if (status !== 200) {
    // Try alternate param names
    const alts = [
      `${base}/management/project-keywords?id=${projectId}`,
      `${base}/management/keywords?project_id=${projectId}`,
    ];
    for (const alt of alts) {
      const { status: s, body: b } = await probe(alt, alt.replace(`${base}/`, ""));
      if (s === 200) {
        console.log("✓ Alternate URL worked:", alt);
        pp(b);
        return;
      }
    }
    console.log("All keyword-list attempts failed. Last body:");
    pp(body);
    return;
  }

  // Shape analysis
  const rows: any[] = body?.keywords ?? body?.data ?? (Array.isArray(body) ? body : []);
  console.log(`\nKeyword rows returned: ${rows.length}`);
  if (rows.length > 0) {
    console.log("\nTop-level response keys:", Object.keys(body));
    console.log("First keyword object keys:", Object.keys(rows[0]));
    console.log("\nFirst 5 keywords:");
    rows.slice(0, 5).forEach((k: any, i: number) => {
      console.log(`  [${i}]`, JSON.stringify(k));
    });
  }

  // Pagination check
  const meta = body?.meta ?? body?.pagination ?? body?.page_info ?? null;
  if (meta) {
    console.log("\nPagination meta:", JSON.stringify(meta));
  } else {
    console.log("\nNo pagination metadata key found in response root.");
    console.log("Response root keys:", Object.keys(body));
  }
}

// ─────────────────────────────────────────────
// Step 4 — Rank overview
// ─────────────────────────────────────────────

async function rankOverview(base: string, projectId: string): Promise<void> {
  console.log("\n═══════════════════════════════════════════");
  console.log("STEP 4 — /rank-tracker/overview");
  console.log("═══════════════════════════════════════════");

  // Determine rank-tracker base: might differ from management base
  // Try both no-prefix and the management base
  const rankBases = [
    "https://api.ahrefs.com",
    base,
  ].filter((v, i, a) => a.indexOf(v) === i); // deduplicate

  let workingRankBase: string | null = null;

  for (const rb of rankBases) {
    const url = `${rb}/rank-tracker/overview?project_id=${projectId}&date=${TODAY}&device=desktop`;
    const { status, body } = await probe(url, `rank-tracker/overview [base=${rb}]`);
    if (status === 200 || status === 400) {
      console.log(`✓ Rank-tracker responds at base: ${rb} (HTTP ${status})`);
      pp(body);
      workingRankBase = rb;
      break;
    }
    console.log(`  HTTP ${status} — trying next base`);
    pp(body);
  }

  if (!workingRankBase) {
    // Final attempt: maybe it needs select param
    const url = `https://api.ahrefs.com/rank-tracker/overview?project_id=${projectId}&date=${TODAY}&device=desktop&select=keyword,position,volume,traffic`;
    const { status, body } = await probe(url, "rank-tracker/overview?select=...");
    console.log(`HTTP ${status}`);
    pp(body);
    return;
  }

  // Full shape probe with explicit select to force data
  const selectUrl = `${workingRankBase}/rank-tracker/overview?project_id=${projectId}&date=${TODAY}&device=desktop&select=keyword,position,volume,traffic,best_position_diff,country`;
  const { status: s2, body: b2 } = await probe(selectUrl, "rank-tracker/overview?select=keyword,position,...");
  console.log(`HTTP ${s2}`);
  pp(b2);

  const rows: any[] = b2?.keywords ?? b2?.data ?? b2?.positions ?? (Array.isArray(b2) ? b2 : []);
  if (rows.length > 0) {
    console.log(`\nRank rows returned: ${rows.length}`);
    console.log("First row keys:", Object.keys(rows[0]));
    console.log("\nFirst 5 rows:");
    rows.slice(0, 5).forEach((r: any, i: number) => {
      console.log(`  [${i}]`, JSON.stringify(r));
    });

    // Nullable position check (Lost keywords)
    const lost = rows.filter((r: any) => r.position == null || r.position === 0);
    console.log(`\nKeywords with null/0 position (Lost): ${lost.length}`);
    if (lost.length > 0) {
      console.log("  Example Lost row:", JSON.stringify(lost[0]));
    }
  }

  // Pagination check
  const meta = b2?.meta ?? b2?.pagination ?? null;
  console.log("\nPagination meta:", meta ? JSON.stringify(meta) : "none");
}

// ─────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────

(async () => {
  try {
    const base = await discoverBaseUrl();
    if (!base) {
      console.error("\n✗ Could not determine working base URL. Stopping.");
      process.exit(1);
    }

    const projectId = await listProjects(base);
    if (!projectId) {
      console.error("\n✗ Could not determine TekRevol project ID. Stopping.");
      process.exit(1);
    }

    await listKeywords(base, projectId);
    await rankOverview(base, projectId);

    console.log("\n═══════════════════════════════════════════");
    console.log("PROBE COMPLETE");
    console.log("═══════════════════════════════════════════");
  } catch (err) {
    console.error("Fatal:", err);
    process.exit(1);
  }
})();
