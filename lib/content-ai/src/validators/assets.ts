/**
 * Asset / DB-backed validators (Phase 6 anti-fabrication gates 6.1, 6.2, 6.4).
 * All DB access is via injected {@link ValidatorDeps} so these stay unit-testable
 * and so confidentiality (6.4) can be loaded FRESH on every call by the caller.
 */
import type { CheckResult, StrippedItem, ValidatorContext } from "./types.js";
import { normName, stripMarkdown } from "./text-utils.js";

/* 6.1 / matrix #?? — every testimonial must exist in the reviews bank AND not be
 * from a confidential company — HARD */
export async function testimonialsInBank(ctx: ValidatorContext): Promise<CheckResult> {
  const k = "all_testimonials_in_bank";
  const used = ctx.article.testimonials_used || [];
  const stripped: StrippedItem[] = [];
  const confidential = new Set((await ctx.deps.getConfidentialCompanies()).map(normName));

  for (const t of used) {
    const inBank = await ctx.deps.isReviewInBank(
      t.reviewer_name || "",
      t.company || "",
      t.quote_excerpt || "",
    );
    if (!inBank) {
      stripped.push({ entityType: "testimonial", detail: `not in reviews bank: ${t.reviewer_name} / ${t.company}`, value: t });
      continue;
    }
    if (confidential.has(normName(t.company || ""))) {
      stripped.push({ entityType: "testimonial", detail: `company is confidential: ${t.company}`, value: t });
    }
  }
  return stripped.length === 0
    ? { key: k, passes: true, severity: "hard", reason: `${used.length} testimonial(s) verified in bank.` }
    : { key: k, passes: false, severity: "hard", reason: `${stripped.length} testimonial(s) stripped (unverified or confidential).`, stripped };
}

/* 6.2 / matrix #15 — internal links: 3–5 count, each url in link_targets, anchor
 * an approved variation — HARD */
export async function internalLinks(ctx: ValidatorContext): Promise<CheckResult> {
  const k = "all_links_in_link_targets";
  const links = ctx.article.internal_links || [];
  const stripped: StrippedItem[] = [];

  for (const l of links) {
    const inTargets = await ctx.deps.isUrlInLinkTargets(l.target_url || "");
    if (!inTargets) {
      stripped.push({ entityType: "internal_link", detail: `url not an active link target: ${l.target_url}`, value: l });
      continue;
    }
    const variations = (await ctx.deps.getAnchorVariations(l.target_url || "")).map((s) => s.trim().toLowerCase());
    const anchor = (l.anchor_text || "").trim().toLowerCase();
    if (variations.length > 0 && anchor && !variations.includes(anchor)) {
      stripped.push({ entityType: "internal_link", detail: `anchor "${l.anchor_text}" not an approved variation for ${l.target_url}`, value: l });
    }
  }
  const kept = links.length - stripped.length;
  const countOk = kept >= 3 && kept <= 5;
  if (stripped.length === 0 && countOk)
    return { key: k, passes: true, severity: "hard", reason: `${kept} internal links, all verified.` };
  const reasons: string[] = [];
  if (stripped.length) reasons.push(`${stripped.length} link(s) stripped`);
  if (!countOk) reasons.push(`kept count ${kept} outside 3–5`);
  return { key: k, passes: false, severity: "hard", reason: reasons.join("; "), stripped };
}

/* 6.4 / matrix #24 — confidentiality firewall: no confidential company name may
 * appear ANYWHERE in the article or schema string fields. Loads fresh. — HARD */
export async function confidentiality(ctx: ValidatorContext): Promise<CheckResult> {
  const k = "no_confidential_companies";
  const companies = (await ctx.deps.getConfidentialCompanies()).filter((c) => c.trim().length >= 3);
  if (companies.length === 0)
    return { key: k, passes: true, severity: "hard", reason: "No confidential companies on file." };

  const haystacks: string[] = [stripMarkdown(ctx.fullText)];
  // Include schema string fields so a name can't hide in structured output.
  const walk = (v: unknown) => {
    if (typeof v === "string") haystacks.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v as object).forEach(walk);
  };
  walk(ctx.article);
  const hay = haystacks.join("\n").toLowerCase();

  const stripped: StrippedItem[] = [];
  for (const company of companies) {
    const needle = company.trim().toLowerCase();
    const re = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(hay))
      stripped.push({ entityType: "confidential_company", detail: `confidential company referenced: ${company}`, value: company });
  }
  return stripped.length === 0
    ? { key: k, passes: true, severity: "hard", reason: `No confidential company names present (checked ${companies.length}).` }
    : { key: k, passes: false, severity: "hard", reason: `${stripped.length} confidential company name(s) present — must be removed.`, stripped };
}
