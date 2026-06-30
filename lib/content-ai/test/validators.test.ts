import { describe, it, expect } from "vitest";
import {
  runAllValidators,
  caseStudyNarrative,
  aggregateFinancial,
  brandMention,
  headingHygiene,
  metaLength,
  faqSchema,
  directAnswer,
  keywordPlacement,
  competitiveCompleteness,
  contentTypeIntegrity,
  authorByline,
  listFormatting,
  localGrounding,
  lsiCoverage,
  authorityFloor,
  testimonialsInBank,
  internalLinks,
  confidentiality,
  statsVerifiedLive,
  type ArticleSchema,
  type ValidatorContext,
  type ValidatorDeps,
} from "../src/validators/index.js";

/* ── Fixtures ────────────────────────────────────────────────────────────── */

const okDeps: ValidatorDeps = {
  isReviewInBank: async () => true,
  getConfidentialCompanies: async () => [],
  isUrlInLinkTargets: async () => true,
  getAnchorVariations: async () => [],
  getPlaybookProjectNames: async () => ["Acme Banking App"],
  getReviewsBankProjectNames: async () => ["Globex Portal"],
  fetchUrl: async () => ({ ok: true, status: 200, text: "" }),
};

function ctx(article: ArticleSchema, overrides: Partial<ValidatorContext> = {}): ValidatorContext {
  return {
    article,
    fullText: overrides.fullText ?? "",
    primaryKeyword: overrides.primaryKeyword ?? "mobile app cost",
    funnelStage: overrides.funnelStage ?? "MOFU",
    contentType: overrides.contentType ?? "guide",
    serpSignals: overrides.serpSignals ?? {},
    lsiRetrieved: overrides.lsiRetrieved ?? [],
    currentYear: overrides.currentYear ?? 2026,
    deps: overrides.deps ?? okDeps,
  };
}

const NARRATIVE_40 =
  "We rebuilt the payments service on an event-driven architecture, migrating " +
  "from a monolith to discrete services with idempotent webhooks, retry queues, " +
  "and a reconciliation ledger so the platform could process bursts of traffic " +
  "without dropping a single transaction during peak load windows every day.";

/* ── 5.9 / 6.6 case-study narrative — the priority gate ──────────────────── */

describe("case study narrative (5.9 / 6.6)", () => {
  it("passes a clean, in-portfolio narrative with no dollar amounts", async () => {
    const r = await caseStudyNarrative(
      ctx({ case_studies_cited: [{ project_name: "Acme Banking App", technical_narrative: NARRATIVE_40 }] }),
    );
    expect(r.passes).toBe(true);
  });

  it("strips a case study carrying a contract_value money key", async () => {
    const cs = { project_name: "Acme Banking App", technical_narrative: NARRATIVE_40, contract_value: 250000 } as never;
    const r = await caseStudyNarrative(ctx({ case_studies_cited: [cs] }));
    expect(r.passes).toBe(false);
    expect(r.stripped?.[0]?.detail).toMatch(/contract_value/);
  });

  it("strips a narrative containing a dollar amount", async () => {
    const r = await caseStudyNarrative(
      ctx({ case_studies_cited: [{ project_name: "Acme Banking App", technical_narrative: NARRATIVE_40 + " The deal was worth $250,000." }] }),
    );
    expect(r.passes).toBe(false);
    expect(r.stripped?.[0]?.detail).toMatch(/dollar amount/);
  });

  it("strips a narrative under 40 words", async () => {
    const r = await caseStudyNarrative(
      ctx({ case_studies_cited: [{ project_name: "Acme Banking App", technical_narrative: "We built an app fast." }] }),
    );
    expect(r.passes).toBe(false);
    expect(r.stripped?.[0]?.detail).toMatch(/40 words/);
  });

  it("strips a project not in playbook or reviews bank", async () => {
    const r = await caseStudyNarrative(
      ctx({ case_studies_cited: [{ project_name: "Unknown Co", technical_narrative: NARRATIVE_40 }] }),
    );
    expect(r.passes).toBe(false);
    expect(r.stripped?.[0]?.detail).toMatch(/not in playbook/);
  });

  it("accepts a project from the reviews bank", async () => {
    const r = await caseStudyNarrative(
      ctx({ case_studies_cited: [{ project_name: "Globex Portal", technical_narrative: NARRATIVE_40 }] }),
    );
    expect(r.passes).toBe(true);
  });
});

/* ── 5.10 / 6.5 aggregate financial suppression ──────────────────────────── */

describe("aggregate financial (5.10 / 6.5)", () => {
  it("flags aggregate revenue claims", () => {
    const r = aggregateFinancial(ctx({}, { fullText: "Over the years we've earned $5M in revenue across our clients." }));
    expect(r.passes).toBe(false);
  });
  it("flags BD metrics", () => {
    const r = aggregateFinancial(ctx({}, { fullText: "Our win rate is strong and our average contract value keeps rising." }));
    expect(r.passes).toBe(false);
  });
  it("passes vendor-neutral prose", () => {
    const r = aggregateFinancial(ctx({}, { fullText: "Mobile app development requires careful scoping and testing." }));
    expect(r.passes).toBe(true);
  });
});

/* ── Structural gates ────────────────────────────────────────────────────── */

describe("structural gates", () => {
  it("brand mention ratio fails when over-branded", () => {
    const r = brandMention(ctx({}, { funnelStage: "TOFU", fullText: "We did this. We did that. TekRevol is great. Our team rocks. Our clients love us." }));
    expect(r.passes).toBe(false);
  });

  it("heading hygiene fails on duplicate H2", () => {
    const r = headingHygiene(ctx({}, { fullText: "# Title\n## Costs\nx\n## Costs\ny" }));
    expect(r.passes).toBe(false);
  });

  it("heading hygiene fails without exactly one H1", () => {
    expect(headingHygiene(ctx({}, { fullText: "## A\n## B" })).passes).toBe(false);
    expect(headingHygiene(ctx({}, { fullText: "# A\n# B" })).passes).toBe(false);
  });

  it("meta length enforces 150-155 chars", () => {
    expect(metaLength(ctx({ meta_description: "x".repeat(152) })).passes).toBe(true);
    expect(metaLength(ctx({ meta_description: "short" })).passes).toBe(false);
  });

  it("faq requires 3-5 pairs with 40-60 word answers", () => {
    const ans = Array(50).fill("word").join(" ");
    const faqs = Array(3).fill(0).map((_, i) => ({ question: `Q${i}?`, answer: ans }));
    expect(faqSchema(ctx({ faq_schema: faqs })).passes).toBe(true);
    expect(faqSchema(ctx({ faq_schema: [{ question: "Q?", answer: ans }] })).passes).toBe(false);
  });

  it("direct answer requires 2-3 sentences", () => {
    expect(directAnswer(ctx({ opening_block: { direct_answer: "Mobile app development typically costs between twenty thousand and three hundred thousand dollars in most markets today. The final range depends heavily on feature scope, platform count, and the seniority of the engineering team you hire." } })).passes).toBe(true);
    expect(directAnswer(ctx({ opening_block: { direct_answer: "It depends." } })).passes).toBe(false);
  });

  it("keyword placement fails when keyword missing from required slots", () => {
    const r = keywordPlacement(ctx({ title_tag: "X", h1: "Y", meta_description: "Z", opening_block: { first_100_words: "nothing" } }, { fullText: "# Y\n## section" }));
    expect(r.passes).toBe(false);
  });

  it("competitive completeness fails when a SERP-required table is missing", () => {
    const r = competitiveCompleteness(ctx({}, { serpSignals: { requires_cost_table: true } }));
    expect(r.passes).toBe(false);
  });

  it("content type integrity fails on mid-body CTAs", () => {
    const r = contentTypeIntegrity(ctx({}, { fullText: "Contact us today. Later: get a quote. Also schedule a call now." }));
    expect(r.passes).toBe(false);
  });

  it("author byline requires the TekRevol team byline", () => {
    expect(authorByline(ctx({ author_byline: { name: "By the TekRevol team", credentials: "10y", bio_link: "/about" } })).passes).toBe(true);
    expect(authorByline(ctx({ author_byline: { name: "Jane Doe", credentials: "", bio_link: "/x" } })).passes).toBe(false);
  });

  it("list formatting flags prose enumerations of 3+ items", () => {
    const r = listFormatting(ctx({}, { fullText: "There are factors. First you scope, second you design, third you build the thing." }));
    expect(r.passes).toBe(false);
  });

  it("local grounding fails when required but absent", () => {
    const r = localGrounding(ctx({}, { serpSignals: { requires_local_context: true } }));
    expect(r.passes).toBe(false);
  });

  it("lsi coverage is soft and respects the 0.60 floor", () => {
    expect(lsiCoverage(ctx({ lsi_coverage_ratio: 0.7 })).passes).toBe(true);
    const low = lsiCoverage(ctx({ lsi_coverage_ratio: 0.3 }));
    expect(low.passes).toBe(false);
    expect(low.severity).toBe("soft");
  });

  it("authority floor requires >=2 whitelisted citations", () => {
    expect(authorityFloor(ctx({ external_authority_citations: [{ domain: "statista.com", url: "https://statista.com/x" }, { domain: "bls.gov", url: "https://bls.gov/y" }] })).passes).toBe(true);
    expect(authorityFloor(ctx({ external_authority_citations: [{ domain: "randomblog.com", url: "https://randomblog.com/x" }] })).passes).toBe(false);
  });
});

/* ── Asset / DB-backed gates ─────────────────────────────────────────────── */

describe("asset gates", () => {
  it("testimonials gate strips unverified testimonials", async () => {
    const deps = { ...okDeps, isReviewInBank: async () => false };
    const r = await testimonialsInBank(ctx({ testimonials_used: [{ reviewer_name: "A", company: "B", quote_excerpt: "great" }] }, { deps }));
    expect(r.passes).toBe(false);
  });

  it("testimonials gate strips confidential companies", async () => {
    const deps = { ...okDeps, getConfidentialCompanies: async () => ["SecretCorp"] };
    const r = await testimonialsInBank(ctx({ testimonials_used: [{ reviewer_name: "A", company: "SecretCorp", quote_excerpt: "great" }] }, { deps }));
    expect(r.passes).toBe(false);
  });

  it("internal links require 3-5 verified links", async () => {
    const links = Array(4).fill(0).map((_, i) => ({ target_url: `/p${i}`, anchor_text: "x" }));
    expect((await internalLinks(ctx({ internal_links: links }))).passes).toBe(true);
    const tooFew = await internalLinks(ctx({ internal_links: [{ target_url: "/p", anchor_text: "x" }] }));
    expect(tooFew.passes).toBe(false);
  });

  it("confidentiality firewall catches a confidential name in the body", async () => {
    const deps = { ...okDeps, getConfidentialCompanies: async () => ["SecretCorp"] };
    const r = await confidentiality(ctx({}, { fullText: "We worked with SecretCorp on their platform.", deps }));
    expect(r.passes).toBe(false);
  });
});

/* ── 6.3 citation verification ───────────────────────────────────────────── */

describe("stats verified live (6.3)", () => {
  it("strips a stat whose source is not live", async () => {
    const deps = { ...okDeps, fetchUrl: async () => ({ ok: false, status: 404, text: "" }) };
    const r = await statsVerifiedLive(ctx({ statistics_used: [{ claim: "70% of apps fail", source_url: "https://x.com" }] }, { deps }));
    expect(r.passes).toBe(false);
  });

  it("keeps a stat whose number matches the page within 5%", async () => {
    const deps = { ...okDeps, fetchUrl: async () => ({ ok: true, status: 200, text: "Studies show 70% of apps fail." }) };
    const r = await statsVerifiedLive(ctx({ statistics_used: [{ claim: "70% of apps fail", source_url: "https://x.com" }] }, { deps }));
    expect(r.passes).toBe(true);
  });
});

/* ── Orchestrator end-to-end ─────────────────────────────────────────────── */

describe("runAllValidators", () => {
  it("marks an article unshippable when a hard gate fails", async () => {
    const summary = await runAllValidators(ctx({ case_studies_cited: [{ project_name: "Unknown Co", technical_narrative: NARRATIVE_40 }] }));
    expect(summary.shippable).toBe(false);
    expect(summary.passes.case_study_narrative_passes).toBe(false);
    expect(summary.stripped.length).toBeGreaterThan(0);
  });

  it("aggregates soft flags without blocking ship on them alone", async () => {
    const summary = await runAllValidators(ctx({ lsi_coverage_ratio: 0.2 }));
    expect(summary.softFlags).toContain("lsi_coverage_passes");
  });
});
