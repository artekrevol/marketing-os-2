/**
 * Deterministic JSON-LD generator for export.
 *
 * Produces three schema blocks aligned with what Stage 1's research brief
 * already targets (`recommended_schema_types` typically includes
 * "FAQPage", "Article", "Organization"):
 *
 *   1. FAQPage  — built from `atomic_question_map[].liftable_paragraph`
 *                 items paired with the matching atomic chunk in the draft.
 *                 Falls back to the section that "owns" the question when a
 *                 standalone chunk can't be located.
 *   2. Article  — uses `outline.h1`, `outline.meta_description`, word count,
 *                 author, datePublished, and a NESTED Organization for
 *                 `publisher` (Google Rich Results requires publisher with
 *                 a `name` and `logo` ImageObject — we ship both).
 *   3. Organization — standalone publisher block, useful when the export is
 *                     dropped onto a non-article page or used as sitewide
 *                     markup.
 *
 * Determinism: same inputs → byte-identical output. We never include
 * `Date.now()` and we sort question entries by their order in the
 * atomic_question_map so re-exporting yields the same JSON.
 */

const DEFAULT_AUTHOR = "TekRevol Editorial Team";
const DEFAULT_PUBLISHER_NAME = "TekRevol";
const DEFAULT_PUBLISHER_DOMAIN = "tekrevol.com";
const DEFAULT_PUBLISHER_LOGO = "https://tekrevol.com/logo.png";

export interface SchemaInputs {
  /** Stitched final draft (markdown) — used to look up answer paragraphs by atomic question. */
  stitched: string;
  outline: { h1?: string | null; meta_description?: string | null; sections?: any[] | null };
  /** research_briefs.atomic_question_map */
  atomicQuestions?: Array<{
    question: string;
    liftable_paragraph?: boolean;
    suggested_location?: string;
    requires_citation?: boolean;
  }> | null;
  drafts?: Array<{ section_id: string; section_heading?: string | null; content?: string | null }>;
  project: {
    topic: string;
    url?: string | null;
    company_domain?: string | null;
    keyword?: string | null;
  };
  wordCount?: number;
  /** Override author (defaults to "TekRevol Editorial Team"). */
  author?: string;
  /** ISO date — defaults to today (YYYY-MM-DD). */
  datePublished?: string;
}

export interface SchemaBlock {
  type: string;
  jsonld: Record<string, any>;
}

/** Slugify the topic for canonical URL fallback. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

/** Date in YYYY-MM-DD form (UTC) — used for filename and datePublished. */
export function isoDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Try to find the paragraph in the stitched draft that "answers" an atomic
 * question. Strategy: look for the question text (case-insensitive) inside
 * any draft.content; lift the paragraph that directly follows. If we can't
 * find a direct match, fall back to the first paragraph of the section
 * named in `suggested_location`.
 */
function findAnswer(
  question: string,
  drafts: SchemaInputs["drafts"],
  suggested?: string,
): string | null {
  if (!drafts || drafts.length === 0) return null;
  const q = question.toLowerCase().replace(/\?+$/, "");

  for (const d of drafts) {
    if (!d.content) continue;
    const lower = d.content.toLowerCase();
    const idx = lower.indexOf(q);
    if (idx >= 0) {
      // Take from the end of the question line to the next blank line.
      const after = d.content.slice(idx);
      const newline = after.indexOf("\n");
      const rest = newline >= 0 ? after.slice(newline + 1) : after;
      const para = rest.split(/\n{2,}/)[0]?.trim();
      if (para) return stripCitations(para);
    }
  }

  if (suggested) {
    const target = drafts.find(
      (d) => (d.section_heading || "").toLowerCase().includes(suggested.toLowerCase()),
    );
    if (target?.content) {
      const para = target.content.split(/\n{2,}/)[0]?.trim();
      if (para) return stripCitations(para);
    }
  }
  return null;
}

/** Strip `[anchor](url)` markdown so JSON-LD answers read as clean prose. */
function stripCitations(s: string): string {
  return s.replace(/\[([^\]]+)\]\(https?:\/\/[^\)\s]+\)/g, "$1");
}

function buildOrganizationJsonLd(domain: string, name: string, logo: string): Record<string, any> {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name,
    url: `https://${domain}`,
    logo: {
      "@type": "ImageObject",
      url: logo,
    },
  };
}

function buildFAQPage(inputs: SchemaInputs): SchemaBlock | null {
  const liftable = (inputs.atomicQuestions || []).filter((q) => q.liftable_paragraph);
  if (liftable.length === 0) return null;

  const mainEntity = liftable
    .map((q) => {
      const answer = findAnswer(q.question, inputs.drafts, q.suggested_location);
      if (!answer) return null;
      return {
        "@type": "Question",
        name: q.question,
        acceptedAnswer: { "@type": "Answer", text: answer },
      };
    })
    .filter(Boolean);

  if (mainEntity.length === 0) return null;
  return {
    type: "FAQPage",
    jsonld: {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity,
    },
  };
}

function buildArticle(inputs: SchemaInputs): SchemaBlock {
  const domain = inputs.project.company_domain || DEFAULT_PUBLISHER_DOMAIN;
  const slug = inputs.project.url || slugify(inputs.project.topic);
  const datePublished = inputs.datePublished || isoDate();
  const author = inputs.author || DEFAULT_AUTHOR;

  return {
    type: "Article",
    jsonld: {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: inputs.outline.h1 || inputs.project.topic,
      description: inputs.outline.meta_description || "",
      author: { "@type": "Person", name: author },
      publisher: buildOrganizationJsonLd(domain, DEFAULT_PUBLISHER_NAME, DEFAULT_PUBLISHER_LOGO),
      datePublished,
      dateModified: datePublished,
      mainEntityOfPage: {
        "@type": "WebPage",
        "@id": `https://${domain}/${slug.replace(/^\//, "")}`,
      },
      wordCount: inputs.wordCount || 0,
      ...(inputs.project.keyword ? { keywords: inputs.project.keyword } : {}),
    },
  };
}

function buildOrganization(inputs: SchemaInputs): SchemaBlock {
  const domain = inputs.project.company_domain || DEFAULT_PUBLISHER_DOMAIN;
  return {
    type: "Organization",
    jsonld: buildOrganizationJsonLd(domain, DEFAULT_PUBLISHER_NAME, DEFAULT_PUBLISHER_LOGO),
  };
}

/** Build the full export schema set. Returns blocks in stable order. */
export function buildExportSchemas(inputs: SchemaInputs): SchemaBlock[] {
  const out: SchemaBlock[] = [];
  const faq = buildFAQPage(inputs);
  if (faq) out.push(faq);
  out.push(buildArticle(inputs));
  out.push(buildOrganization(inputs));
  return out;
}

/** Filename helper — `{slug}-{YYYY-MM-DD}.{ext}` */
export function exportFilename(topic: string, ext: string, date: Date = new Date()): string {
  return `${slugify(topic)}-${isoDate(date)}.${ext}`;
}