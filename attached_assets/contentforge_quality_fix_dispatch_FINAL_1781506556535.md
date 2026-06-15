# ContentForge — Comprehensive Quality Fix Dispatch (FINAL)

**Repo:** `tr-marketing-os` (Replit)
**Regression targets:**
- Primary: project `821e5c72-0cb7-400e-83f4-77d533b445a8` (Austin app development cost blog)
- Secondary: project `04cc54c1-8aef-4bd3-acc6-0dc3dd2bb4e9` (dog training app development cost blog)

**Source feedback this dispatch absorbs:** two SEO content audits (dog-training piece, Austin piece), three rounds of content-team feedback (Maria, Mahnoor, Rabia), and the dispatcher's six strategic decisions. This is the consolidated, ship-it version — supersedes any earlier draft dispatch.

**Dispatch type:** Single consolidated change. Do not subdivide; most fixes touch the same code paths. Estimated scope: schema + ingestion + DataForSEO wiring + 16 rule bundles + 6 validators + regression on two projects.

---

## What this dispatch fixes

The audited pieces failed on four meta-dimensions:

1. **Wrong proof.** Tool surfaces internal financials (revenue, deal counts, geographic concentration) and per-project dollar figures as authority signal. Reader doesn't want billing data; they want engineering specifics. Proof should come from *what was built*, not *what was billed*.
2. **Wrong structure.** Duplicate H2s, dense prose where lists belong, stats stacked 2–3 per paragraph, no FAQ block, no cost table, no internal/external links.
3. **Wrong substance.** Cost articles missing standard sub-topics (hourly rates, in-house vs. agency, maintenance cost as % of build), local-targeting articles missing genuine local context, LSI clusters retrieved but not used.
4. **Wrong tone.** Brand mentions stacked 14+ times in one piece, CTAs scattered through body, content reads as advertorial — Google's Helpful Content System actively penalizes this.

After this dispatch, regenerating either audited piece must produce a structurally valid, SEO-grounded, asset-validated article that opens with a direct answer and proves expertise through engineering specifics, not dollar amounts.

---

## Phase 0 — Pre-flight checks

Two earlier dispatches may have shipped. Detect state before building.

**Sprint A (brand safety / two-tier ingestion):** check for a `tier` or `confidentiality` field on ingested sources, a citation-grounding helper that verifies external URLs (HTTP 200 + content match), and an output-side guard rejecting named-client-with-exact-dollar combinations. If present, integrate; if absent, build as part of this dispatch.

**Sprint B (input controls):** check for ICP selector with tone modulation, competitor selection UI, funnel-stage selector, keyword-structure inputs. If present, extend with Phase 2; if absent, build.

Report back with what exists and what's missing before continuing.

---

## Phase 1 — Asset ingestion

Three source files become the canonical truth for rules (playbook), testimonials (reviews bank), and link targets (internal linking). They are NOT in the repo yet; this phase sets up the directory, loader, and query helpers. The dispatcher will upload files after Phase 1 ships.

### 1.1 Directory

```
/data/
  playbook.md              # rules — always-on
  reviews_bank.json        # testimonials — retrieval source (83 reviews)
  internal_linking.xlsx    # link targets — retrieval source (113 URLs)
```

### 1.2 Loader module

Create `lib/worker/src/assets/loader.ts`:
- Load all three files at app start.
- Cache parsed structures in memory.
- Watch file mtime; re-load on change without restart.
- Expose typed query helpers (1.3).
- **Fail loud at startup if any file is missing.** Log path, expected format, exit non-zero. ContentForge MUST NOT run without all three.

### 1.3 Query helpers

```typescript
// PLAYBOOK
getPlaybookSection(name: string): string
getBannedPhrases(): string[]                              // Section 3
getDiscardList(): string[]                                // Section 7 + dynamic exclusions
getFunnelDefinition(stage: 'TOFU'|'MOFU'|'BOFU'): string  // Section 6
getICPProfile(icp: 1|2|3|4): ICPProfile                   // Section 2
getCredentialBlock(): string                              // Section 8B summary
getTopicChecklist(contentType: string): string[]          // see 4.16

// REVIEWS BANK
findTestimonials(opts: {
  icp?: number, vertical?: string, costBucket?: string,
  excludeNegative?: boolean,                              // defaults true — Phase 5.4
  limit?: number
}): Review[]
isReviewInBank(name: string, company: string, quote: string): boolean
getNegativeReviewCompanies(): string[]                    // from bank header

// INTERNAL LINKING
findLinkTargets(opts: {
  cluster?: string, vertical?: string, funnel?: 'TOFU'|'MOFU'|'BOFU',
  icp?: number, exclude?: string[], limit?: number
}): LinkTarget[]
isUrlInLinkingFile(url: string): boolean
getAnchorVariations(url: string): string[]
getLinkingRulesForCluster(cluster: string): LinkingRule
```

### 1.4 Parsing notes

- **playbook.md** v2.5: Section 3 banned phrases, Section 5 content rules, Section 6 funnel defs, Section 7 discard list, Section 8B credentials, Section 8C hero testimonials (fallback only — bank is primary).
- **reviews_bank.json**: header has `negative_reviews` array; 83 reviews; 69 with full transcripts; 14 card-level only.
- **internal_linking.xlsx**: four sheets. Master Sitemap (113 URLs, queryable), Linking Rules (precomputed cluster patterns), Anchor Patterns (rotation source). Parse to in-memory JSON at load — do not query xlsx at request time.

---

## Phase 2 — DataForSEO integration

Replaces guessed keywords with grounded data. Insertion point: research stage, before outline.

### 2.1 Credentials + budget

- Env vars: `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` (set in Replit Secrets before dispatch).
- Per-article budget cap: **$1.00 hard, $0.50 soft target.** Halt research stage at hard cap.
- Cache responses keyed by `(endpoint, query)` for 7 days.

### 2.2 Endpoints

| Endpoint | When | Purpose |
|---|---|---|
| Search Volume | After writer submits primary + LSI set | Monthly volume, CPC, competition |
| SERP API (Live, Advanced) | After volume | Live top-10. Feeds competitor teardown, title/H1 phrasing, missing-element detection |
| Keyword Ideas | At outline stage | Expand LSI cluster, surface co-searched topics |
| Ranked Keywords (optional) | When writer toggles "build on existing momentum" | Bias topic toward known-ranking gaps |

### 2.3 SERP-driven content flags

Scan top-10 SERP results for the primary keyword and set required-content flags:

- **`requires_cost_table`**: primary contains "cost"/"price"/"how much"/"pricing" OR ≥3 of top-10 display structured pricing.
- **`requires_timeline_table`**: any top-10 H2 contains "how long"/"timeline"/"phases"/"stages".
- **`requires_regional_comparison`**: any top-10 result discusses geographic rate variation.
- **`requires_competitor_teardown`**: brief names ≥2 competitor products.
- **`requires_hourly_rate_comparison`**: cost-cluster article AND top-10 includes hourly-rate discussion.
- **`requires_team_model_comparison`**: cost-cluster article AND top-10 includes in-house/agency/freelancer comparison.
- **`requires_maintenance_cost_breakdown`**: cost-cluster article AND top-10 includes maintenance-cost-as-% framing.
- **`requires_local_context`**: primary keyword contains a city/region name.

These flags drive Phase 3 schema requirements and Phase 4 rules.

### 2.4 LSI tracking

After Keyword Ideas returns, record `lsi_retrieved`: array of LSI terms with their volumes. After draft, compute `lsi_used_count` and `lsi_coverage_ratio = used / retrieved`. Target ≥60% (see 4.15).

---

## Phase 3 — Output schema (the spine)

Update `REVIEW_TOOL` schema in `artifacts/api-server/src/routes/ai/index.ts`. Use the proven enforcement pattern (required fields, `additionalProperties: false`, length/item caps, sanitization at three layers).

### 3.1 Schema additions

```typescript
{
  // ===== EXISTING =====
  voice_flags: { ... }

  // ===== TITLE / META =====
  title_tag: string                    // ≤60 chars, contains primary keyword
  h1: string                           // contains primary keyword (unique on page)
  meta_description: string             // 150–155 chars, contains primary keyword

  // ===== OPENING (HARD RULE — Phase 4.2) =====
  opening_block: {
    first_100_words: string            // MUST contain primary keyword
    direct_answer: string              // explicit 2–3-sentence answer to query
  }

  // ===== CLOSING REINFORCEMENT (Phase 4.2 extension) =====
  closing_block: {
    summary: string                    // MUST contain exact-match primary keyword
                                       // OR its tightest variant once more
  }

  // ===== STRUCTURE =====
  headings: { h2: string[], h3: string[] }   // all unique within own level
  list_blocks: Array<{                       // see 4.13
    section: string
    type: 'ordered'|'unordered'
    items: string[]
  }>

  // ===== CONDITIONAL TABLES (Phase 2.3 flags) =====
  cost_table?: {
    title: string
    columns: ['Feature', 'Basic', 'Mid-Tier', 'Advanced']
    rows: Array<{ feature: string, basic: string, mid: string, advanced: string }>
    // Cell values use tight-range convention from playbook Section 5
  }
  timeline_table?: {
    phases: Array<{ phase: string, duration: string, deliverables: string }>
  }
  regional_rate_comparison?: {
    rows: Array<{ region: string, hourly_rate: string, notes: string }>
  }
  hourly_rate_comparison?: {                 // NEW
    rows: Array<{ role: string, junior: string, mid: string, senior: string }>
  }
  team_model_comparison?: {                  // NEW
    rows: Array<{
      model: 'In-house'|'Agency'|'Freelancer',
      cost: string, speed: string, quality: string, control: string,
      best_for: string
    }>
  }
  maintenance_cost_breakdown?: {             // NEW
    annual_pct_of_build: string              // e.g. "15%–20%"
    components: Array<{ item: string, share: string }>
  }
  competitor_teardown?: {
    competitors: Array<{
      name: string,
      key_features: string[],
      estimated_build_cost: string,
      what_makes_them_work: string           // NEW — engineering insight, not just listing
    }>
  }

  // ===== CASE STUDIES — THE BIG PIVOT (Phase 4.9) =====
  case_studies_cited: Array<{
    project_name: string
    // PROHIBITED at output layer: contract value, billed amount, deal size
    technical_narrative: string              // 2–3 sentences — feature, integration, architecture
    outcome: string                          // measurable result if available
    in_playbook_or_bank: boolean             // MUST be true to ship
  }>

  // ===== LOCAL CONTEXT (Phase 4.14) =====
  local_entity_grounding?: {                 // required if requires_local_context = true
    city: string
    local_context_sentences: string[]        // 2+ sentences true ONLY of this city
                                             // (tech corridor, local industry mix, etc.)
  }

  // ===== E-E-A-T =====
  author_byline: {
    name: 'By the TekRevol team'             // fixed
    credentials: string                      // from playbook Section 8B
    bio_link: '/about'
  }
  statistics_used: Array<{
    claim: string,
    source_url: string,
    source_name: string,
    year: number,
    verified_live: boolean,                  // HTTP 200 + content match
    flagged_as_stale: boolean                // year < current_year - 2
  }>
  external_authority_citations: Array<{      // NEW — minimum count enforced
    domain: string                           // e.g. 'clutch.co', 'bls.gov', 'statista.com'
    url: string,
    purpose: string                          // why this source supports the claim
  }>

  // ===== ASSET RETRIEVAL (validated against canonical sources) =====
  testimonials_used: Array<{
    reviewer_name: string,
    company: string,
    quote: string,
    source_url: string,
    in_bank: boolean                         // MUST be true to ship
  }>
  internal_links: Array<{
    target_url: string,
    anchor_text: string,
    section: string,
    in_linking_file: boolean                 // MUST be true to ship
  }>

  // ===== FAQ SCHEMA =====
  faq_schema: Array<{                        // 3–5 pairs, 40–60-word answers
    question: string,
    answer: string                           // 40–60 words
  }>

  // ===== CTA =====
  cta_block: {
    placement: 'end_only',
    anchor_text: string,                     // varies per piece — Anchor Patterns sheet
    target_url: '/contact'
  }

  // ===== LSI COVERAGE (Phase 4.15) =====
  lsi_retrieved: string[]
  lsi_used_in_body: string[]
  lsi_coverage_ratio: number                 // target ≥0.60

  // ===== VALIDATION SUMMARY (populated by validators) =====
  validation: {
    brand_mention_ratio: number,
    brand_mention_ratio_threshold: number,
    brand_mention_passes: boolean,
    keyword_density: number,
    keyword_density_passes: boolean,
    citations_all_verified: boolean,
    external_authority_count_passes: boolean,
    no_duplicate_headings: boolean,
    direct_answer_passes: boolean,
    closing_reinforcement_passes: boolean,
    cost_table_present_if_required: boolean,
    timeline_table_present_if_required: boolean,
    regional_comparison_present_if_required: boolean,
    hourly_rate_present_if_required: boolean,
    team_model_present_if_required: boolean,
    maintenance_breakdown_present_if_required: boolean,
    competitor_teardown_present_if_required: boolean,
    local_grounding_present_if_required: boolean,
    list_format_used_where_enumerated: boolean,
    stat_density_passes: boolean,
    repetition_check_passes: boolean,
    case_studies_have_technical_narrative: boolean,
    no_aggregate_financial_data: boolean,    // see 4.10
    no_negative_review_companies: boolean,
    all_testimonials_in_bank: boolean,
    all_links_in_linking_file: boolean,
    all_stats_within_24mo_or_flagged: boolean,
    lsi_coverage_passes: boolean,
    topic_checklist_passes: boolean
  }
}
```

### 3.2 Sanitization

Three layers (same pattern as `voice_flags`): schema rejection at API boundary, `sanitizeOutput()` at insert + onConflictDoUpdate, `safeText()` at display.

---

## Phase 4 — Generation rules (16 bundles)

### 4.1 Brand-mention ratio (funnel-differentiated)

Count branded mentions (TekRevol, "our team", "our work", "our clients", "we", first-person plurals about the business) as ratio to non-branded sentences.

| Funnel | Max ratio | Notes |
|---|---|---|
| TOFU | 1:12 | informational, sparse brand |
| MOFU | 1:8 | audit baseline (cost guides, how-to) |
| BOFU | 1:5 | consideration, brand presence expected |

Exceeds threshold → `validation.brand_mention_passes = false` → block ship. Tunable after first 20 articles.

### 4.2 Direct-answer rule + closing reinforcement (hard)

**Opening:** first 100 words MUST contain primary keyword (exact or close variant) + a 2–3-sentence direct answer to the user's query.

**Closing:** the summary/conclusion or FAQ block MUST contain the exact-match primary keyword at least once more. The audited Austin piece used the phrase in the title, then dissolved into variants for the rest of the body — fix is one more exact-match in the closing block.

Either failure → block ship.

### 4.3 Competitive-completeness rules

Driven by Phase 2.3 SERP flags. If a flag is set, the corresponding schema field is required.

- `requires_cost_table` → `cost_table` required (tight ranges, no exact $ tied to named client)
- `requires_timeline_table` → `timeline_table` required (Phase 1 MVP / Phase 2 Scale / Phase 3 Advanced)
- `requires_regional_comparison` → `regional_rate_comparison` required (US / Eastern Europe / South Asia)
- `requires_hourly_rate_comparison` → `hourly_rate_comparison` required (junior / mid / senior by role)
- `requires_team_model_comparison` → `team_model_comparison` required (in-house / agency / freelancer)
- `requires_maintenance_cost_breakdown` → `maintenance_cost_breakdown` required (annual % of build + components)
- `requires_competitor_teardown` → `competitor_teardown` required with `what_makes_them_work` per competitor

Any required field missing → block ship.

### 4.4 Heading hygiene

H1 unique. No duplicate H2s. No duplicate H3s within parent H2. Valid H1→H2→H3 nesting (no skipped levels). Block ship on duplicates — this is the dog-training piece's most egregious generation bug.

### 4.5 Citation grounding + external authority floor

**Per-stat verification:** every URL in `statistics_used` → HTTP 200 + content match (claim's key phrase or numeric value appears in fetched page text, ±5% tolerance). Failures → claim stripped, `verified_live = false`.

**Per-stat freshness:** every stat must have `year`. If `year < current_year - 2` → set `flagged_as_stale = true`. Flag inline; do not block ship on stat age alone (per dispatcher's freshness policy: flag-not-block on new generation).

**Authority floor (NEW):** every article must have ≥2 entries in `external_authority_citations` pointing to recognized authority domains. Whitelist: clutch.co, goodfirms.co, statista.com, bls.gov, gartner.com, forrester.com, mckinsey.com, hbr.org, techcrunch.com, businessofapps.com, app store stats from apple.com/google.com, market research from sec.gov, plus government/edu (.gov, .edu). Block ship if fewer than 2.

### 4.6 Content-type integrity

CTAs ONLY in the `cta_block` at the end. Body reads as if vendor did not exist. Validator detects CTA-like phrases mid-body ("get a quote," "book a call," "talk to our team") → block ship if more than one CTA block detected.

### 4.7 Author byline + credentials

Fixed: "By the TekRevol team." Credentials pulled from playbook Section 8B. Bio link `/about`. Placement: top of article, under title, before opening block.

### 4.8 Image / visual prompts

For any article with cost/timeline/regional flags, generate visual prompts:

```typescript
visual_prompts: Array<{
  section: string,
  type: 'cost_chart'|'timeline'|'comparison'|'process'|'infographic',
  description: string
}>
```

Cost guides with annotated visuals rank measurably better — currently missed.

### 4.9 Case-study narrative pivot (the big one)

This is the single most impactful behavioral change. Both audits identified it independently.

**What the tool does today:** "We built [X app] for [client] for $87,000."

**What it must do:** "We built [X app], which required real-time multi-device sync over WebSockets and a custom geofencing module integrated with HealthKit. The architectural choice — event-sourcing the activity log instead of a relational schema — let us replay user state on device switch, which became the product's defining feature."

**Hard rules at schema layer:**
- `case_studies_cited[].contract_value` is **not a schema field**. The model cannot emit it.
- `technical_narrative` is required — 2–3 sentences, feature + integration + architectural choice.
- `outcome` is optional but if present must be measurable (% lift, downloads, user count) — never a dollar amount.
- `in_playbook_or_bank` validated: the project must exist in the playbook's named-project list (Section 8B portfolio) or in the reviews bank's company roster. If not, the case study cannot be cited — prevents fabrication.

### 4.10 Aggregate financial suppression (broaden brand safety)

Audit found the tool surfacing total revenue, LTV, deal counts, geographic concentration ("65% of clients in Texas") as primary credibility signal. These are investor-deck content — readers don't want them, and they expose internal BD data.

**Suppressed at output:**
- Total/aggregate revenue figures of any kind.
- LTV, ARPU, deal count, average deal size.
- Geographic concentration percentages of the client base.
- Win rates, conversion rates, retention rates — any internal BD metric.

Detection: regex + LLM classifier scan for patterns ("$X.XM in revenue," "X% of our clients," "we've closed X deals"). Match → strip + flag. `validation.no_aggregate_financial_data = false` if any detected.

### 4.11 Stat density cap

Max **one supporting number per paragraph.** Currently the tool stacks 2–3 stats per paragraph, hurting readability and credibility.

Detection: parse paragraphs, count digit-bearing tokens that read as supporting statistics (not e.g. version numbers, dates, list counts). If > 1 per paragraph → flag the paragraph for revision. Soft validator (flag, don't block).

### 4.12 Repetition detection

Cross-section check: same factoid stated multiple times (e.g. "pod-based delivery," "Phase 2 planning," "IP ownership in writing" each appeared 3+ times verbatim in the Austin piece). Detection: n-gram fingerprint each section; if any 8+ word phrase appears in ≥2 sections → flag for variation. Soft validator.

### 4.13 List formatting requirement

Content that enumerates 3+ items in sequence MUST render as a list (ordered for steps/phases, unordered otherwise). Detection: paragraph contains "first... second... third" OR "three reasons... primarily... additionally..." OR similar enumeration → fail.

The Austin piece's "seven primary factors that drive app development cost" was textbook list content rendered as prose. Lists are the most-extracted format for AI Overviews and PAA.

Generator-side fix: when the model is asked for enumerated content, the prompt at outline stage must specify "render this section as a list." Validator-side: flag enumerated prose for conversion.

### 4.14 Local entity grounding (when location in primary keyword)

If `requires_local_context = true` (primary keyword contains city/region), the article MUST include `local_entity_grounding.local_context_sentences` — at least 2 sentences that could ONLY be true of this city (tech corridor, local industry mix, dominant employer base, regulatory environment, etc.).

"Austin" should not function as a label swapped into a template. The model is fed the city + a brief on local industry/tech context, retrieved from a small reference doc in `/data/local_context/{city}.md` (the dispatcher may need to seed this for the priority location pages — Austin, Houston, Dallas, Chicago, LA — based on existing location-page content).

Block ship if location keyword is set and no local grounding present.

### 4.15 LSI coverage check

After Keyword Ideas returns at outline stage, compute target LSI set. After draft, compute `lsi_coverage_ratio = lsi_used_in_body.length / lsi_retrieved.length`. Target ≥ **0.60**. Below target → flag for revision. Soft validator.

The Austin piece retrieved "average cost to build an app," "app developer hourly rate," "app development quote" — none appeared in the body. Coverage was effectively ~0%.

### 4.16 Topic-coverage checklist by content type

Per-content-type required sub-topics, retrieved via `getTopicChecklist(contentType)`:

**Cost guide** (primary contains cost/price/how-much):
- Cost ranges by app type or tier
- Cost drivers (features, complexity, team)
- Regional/hourly rate variation
- Team model comparison (in-house vs. agency vs. freelancer)
- Maintenance cost (% of build)
- Timeline by phase
- What's typically excluded from quoted prices

**Comparison guide** (primary contains "vs"/"versus"/"or"):
- Feature-by-feature comparison table
- Cost comparison
- Use-case fit per option
- Migration/switching cost
- Author's recommendation (with caveat)

**How-to guide** (primary contains "how to"/"guide to"):
- Prerequisites
- Step-by-step (numbered list)
- Common pitfalls
- Tools/resources
- Expected outcome

If a required sub-topic is missing → flag. For cost guides this is a block-ship validator (the Austin piece missing hourly rates + team model comparison + maintenance cost is exactly what this catches).

---

## Phase 5 — Validators

Six hard gates run after model output, before draft is shippable. Any failure flips the corresponding `validation.*` flag and surfaces in the review UI.

### 5.1 Testimonial validator (in-bank only)

For each entry in `testimonials_used`: `isReviewInBank(name, company, quote)` must return true. Exact-match on name + company. Quote must appear verbatim in the bank's `quote` or `transcript` for that review. Company MUST NOT appear in `getNegativeReviewCompanies()`. Failure → testimonial stripped, validation fails.

### 5.2 Internal link validator (in-file only)

For each entry in `internal_links`: `isUrlInLinkingFile(target_url)` must return true. Anchor text must come from `getAnchorVariations(url)` OR be a natural variation not appearing elsewhere in the same article. Failure → link stripped, validation fails.

### 5.3 Citation URL validator (live + content match)

For each entry in `statistics_used` AND `external_authority_citations`: fetch URL, require HTTP 200, verify claim's key phrase / numeric value appears in fetched page text (±5% on numbers). Failure → claim stripped, `verified_live = false`, validation fails.

### 5.4 Negative-review exclusion list (dynamic)

Maintained from `reviews_bank.header.negative_reviews`. Currently: Branding Design & Packaging Company, Retail Company. Validator scans full article text + all schema fields for these company names → strip + flag. Also added to playbook's discard list (Section 7) at ingestion so the model is instructed not to emit them at generation time, not just caught at validation.

### 5.5 Aggregate financial suppression (NEW)

Regex + LLM classifier scans full article for patterns matching:
- Total/aggregate revenue ("$Xm total revenue," "we've earned $X")
- Client concentration ("X% of our clients are," "most of our clients in Y")
- Deal metadata ("X deals closed," "average contract value of $Y")
- Internal BD metrics ("win rate," "ARPU," "LTV")

Match → strip from output, `validation.no_aggregate_financial_data = false`, log for human review.

### 5.6 Case-study narrative validator (NEW)

For each entry in `case_studies_cited`:
- `technical_narrative` must be ≥40 words (enforces the 2–3-sentence floor)
- `technical_narrative` must NOT contain dollar amounts (regex `\$[\d,]+`)
- `in_playbook_or_bank` must be true (project name exists in playbook Section 8B portfolio OR bank's company roster)

Failure → case study stripped from output, validation fails.

---

## Phase 6 — Regression test (two projects)

After fix ships, regenerate both pieces through the full pipeline (same writer inputs).

### 6.1 Primary regression: Austin app development cost — project `821e5c72`

| # | Check | Validator field |
|---|---|---|
| 1 | No duplicate H2s/H3s | `validation.no_duplicate_headings` |
| 2 | Primary keyword "app development cost Austin" in title, H1, first 100 words, meta, ≥1 H2, closing block | `direct_answer_passes` + `closing_reinforcement_passes` |
| 3 | Meta description 150–155 chars | field populated |
| 4 | FAQ schema with 3–5 pairs, 40–60-word answers | `faq_schema` populated |
| 5 | Author byline + credentials | `author_byline` populated |
| 6 | Cost table (features × tiers) | `cost_table_present_if_required` |
| 7 | Hourly rate comparison | `hourly_rate_present_if_required` |
| 8 | Team model comparison (in-house / agency / freelancer) | `team_model_present_if_required` |
| 9 | Maintenance cost breakdown (% of build + components) | `maintenance_breakdown_present_if_required` |
| 10 | Local entity grounding — ≥2 Austin-specific sentences | `local_grounding_present_if_required` |
| 11 | "Seven factors" or similar enumerated content as list | `list_format_used_where_enumerated` |
| 12 | Brand mention ratio ≤ 1:8 (MOFU cost guide) | `brand_mention_passes` |
| 13 | No aggregate financial data | `no_aggregate_financial_data` |
| 14 | No per-project dollar figures — every case study has technical_narrative | `case_studies_have_technical_narrative` |
| 15 | Internal links 3–5, all in linking file | `all_links_in_linking_file` |
| 16 | ≥2 external authority citations | `external_authority_count_passes` |
| 17 | All stats verified live + content match | `citations_all_verified` |
| 18 | All stats have year, > 24mo flagged | `all_stats_within_24mo_or_flagged` |
| 19 | LSI coverage ≥ 0.60 | `lsi_coverage_passes` |
| 20 | Topic checklist (cost-guide): all sub-topics present | `topic_checklist_passes` |
| 21 | Stat density ≤ 1/paragraph | `stat_density_passes` |
| 22 | No section-spanning repetition | `repetition_check_passes` |
| 23 | CTA in single closing block, varied anchor | `cta_block.placement = 'end_only'` |
| 24 | No negative-review companies named | `no_negative_review_companies` |

### 6.2 Secondary regression: dog training app cost — project `04cc54c1`

Same 24 checks apply. Specific additional assertions:
- Competitor teardown includes Dogo, Puppr, GoodPup with `what_makes_them_work` per competitor.
- Timeline table present (the dog-training piece's audit specifically called this out).
- Regional rate comparison (US / Eastern Europe / South Asia) — distinct from the Austin piece's local grounding requirement.

All 24 checks must pass on both pieces for the dispatch to be considered complete.

---

## Phase 7 — Architect / validator expectations

Replit Architect has surfaced 4× issues mid-task in prior dispatches (escaped-literal decoding, null-safe filter, divide-by-zero guard, sampling docs). Expect similar here. Two patterns:

1. After completing work, do `git show --stat HEAD` before reporting so the validator sees the actual diff, not a cached prior verdict.
2. If Architect surfaces issues mid-task, treat them as authoritative — fix in-task rather than deferring.

---

## Acceptance criteria (all must be true)

1. Phase 0 report submitted (Sprint A + B status).
2. `/data/` exists, loader module in place, query helpers exported, fail-loud verified.
3. DataForSEO endpoints wired with caching + budget enforcement; spend reportable per article.
4. `REVIEW_TOOL` schema updated with all Phase 3 fields; sanitization at three layers; display renders new fields safely.
5. All 16 generation rule bundles (4.1–4.16) implemented at correct pipeline stages.
6. All 6 validators (5.1–5.6) gate ship; failures surface in review UI with specific reasons.
7. Primary regression (project `821e5c72`) passes all 24 checks.
8. Secondary regression (project `04cc54c1`) passes all 24 checks.
9. `git show --stat HEAD` reflects: schema file, sanitization helpers, display components, loader module, six validators, DataForSEO client, sixteen rule modules, regression fixtures.

---

## Operational notes for the dispatcher

- **Order of operations:** Phase 1 ships first → dispatcher uploads three asset files to `/data/` → dispatcher seeds `/data/local_context/{city}.md` for Austin, Houston, Dallas, Chicago, LA → Phase 2 onward proceeds.
- **DataForSEO Secrets:** `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` must be set in Replit Secrets before Phase 2 starts. Agent halts cleanly if missing.
- **Brand-mention ratios** (1:12 / 1:8 / 1:5) are starting values. Tune after first 20 post-fix articles.
- **Cache TTL** is 7 days on DataForSEO. Adjust if SERP volatility for a topic justifies fresher data.
- **Local context files** for cities other than the priority five can be added incrementally; until they exist, location-keyword articles for those cities are blocked at validation (correct behavior — better to block than ship a templated local article).
- **The negative-review exclusion list** is dynamic. When new negative reviews enter the bank, the loader picks them up on file change — no code update.
- **The single most important behavioral test:** the dog-training piece's audit and the Austin piece's audit independently identified the "what was built, not what was billed" pivot as the biggest content-quality lever. If after this dispatch the regenerated articles still surface per-project dollar figures or aggregate revenue as proof, the dispatch did not actually fix the problem. Validators 5.5 and 5.6 are the hard gates that prevent this; treat them as the highest-priority checks.
