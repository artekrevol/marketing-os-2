import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, integer, jsonb, numeric, index } from "drizzle-orm/pg-core";
import { brandsTable } from "./brands";
import { locationsTable } from "./seo";

export const projectsTable = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brandsTable.id, { onDelete: "restrict" }),
    topic: text("topic").notNull(),
    // Nullable during the content-type transition (Phase 1.5). Old rows that
    // had 'blog' (not in the typed enum) were nulled at migration time.
    // Intake now sets this explicitly; auto-inference remains as a fallback.
    // CHECK constraint: NULL or one of the 8 typed values (enforced in DB).
    contentType: text("content_type"),
    mode: text("mode").notNull().default("research"),
    status: text("status").notNull().default("draft"),
    currentStage: integer("current_stage").notNull().default(0),
    // `url` is the PLANNED relative slug (e.g. "/blog/<slug>") set once at
    // creation and used for schema export. It exists pre-publish and never
    // changes. Do NOT confuse it with `publishedUrl` below.
    url: text("url"),
    // `keyword` doubles as the article's primary SEO TARGET keyword — the
    // Shared Data Layer reuses this column (there is intentionally no
    // separate `target_keyword_text`). Cross-module reads and the
    // publish-link worker read `keyword` as the target.
    keyword: text("keyword"),
    keywordCluster: jsonb("keyword_cluster"),
    funnelStage: text("funnel_stage"),
    pod: text("pod"),
    companyDomain: text("company_domain"),
    competitorUrl: text("competitor_url"),
    benchmarkUrl: text("benchmark_url"),
    playbookVersion: integer("playbook_version"),
    aiProposedBrief: jsonb("ai_proposed_brief"),
    briefConfirmedAt: timestamp("brief_confirmed_at", { withTimezone: true }),
    briefError: text("brief_error"),
    userNotes: text("user_notes"),
    userOverrides: jsonb("user_overrides"),
    icps: integer("icps").array(),
    writerId: text("writer_id"),
    createdBy: text("created_by"),
    // --- Quality Fix Dispatch v2 (Phase 3) ---
    // SERP-driven required-content flags computed after the SERP Live
    // Advanced call (Phase 3.1). Shape: { requires_cost_table: boolean, ... }.
    serpSignals: jsonb("serp_signals"),
    // LSI terms (with search volumes) returned by Keyword Ideas (Phase 3.2).
    // Shape: Array<{ term: string, volume: number }>.
    lsiRetrieved: jsonb("lsi_retrieved"),
    // LSI terms actually found in the drafted body, computed at final-stitch.
    // Shape: string[].
    lsiUsed: jsonb("lsi_used"),
    // used / retrieved (Phase 3.2 / Rule 5.15). Target >= 0.60.
    lsiCoverageRatio: numeric("lsi_coverage_ratio"),
    // --- Shared Data Layer: cross-module SEO targeting + publish ---
    // The SEO location this article's primary keyword is tracked against.
    // Required at Intake when "Track this keyword in SEO OS" is checked;
    // nullable for legacy/non-tracked projects.
    targetLocationId: uuid("target_location_id").references(
      () => locationsTable.id,
      { onDelete: "set null" },
    ),
    // `publishedUrl` is the CONFIRMED LIVE url of the article and is the
    // cross-module source of truth for content<->keyword links. This is
    // DISTINCT from `url` above: `url` is the planned relative slug set at
    // creation (pre-publish, immutable); `publishedUrl` is set only when
    // the article actually goes live.
    publishedUrl: text("published_url"),
    // Publish trigger: when `publishedAt` transitions null -> non-null the
    // content.publish-link-keyword worker fires. `url` is irrelevant to
    // this trigger.
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Cross-module lookup by the article's primary (target) keyword.
    index("projects_keyword_idx")
      .on(t.brandId, t.keyword)
      .where(sql`keyword is not null`),
  ],
);

export type Project = typeof projectsTable.$inferSelect;
