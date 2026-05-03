/**
 * Citation-aware export renderers (Markdown / HTML / Plain text).
 *
 * The stitched draft in `draft_scores.final_draft` is Markdown with inline
 * `[anchor](url)` citations. Stage 3 (`draft-section`) already strips
 * non-whitelisted URLs server-side, but a draft produced before that
 * enforcement landed — or one that slipped through — may still contain
 * unverified URLs. We re-apply the same whitelist client-side at export
 * time so what ships matches what the citations panel shows as "verified".
 *
 * Policy for unverified citations (per Sprint 1 spec):
 *   - Markdown: keep the anchor text, drop the URL  →  `anchor text`
 *   - HTML: keep the anchor text inside a <span class="unverified-citation">
 *     so a publisher can audit / restyle later, but no <a href> ships.
 *   - Plain text: anchor text only, no URL.
 *
 * Verified citations are preserved as proper links (Markdown / HTML) or
 * "anchor (url)" (plain text, so a Google Docs paste keeps the source).
 */
import { citationStatus, type CitationStatus } from "./citationWhitelist";

const CITE_RE = /\[([^\]]+)\]\((https?:\/\/[^\)\s]+)\)/g;

function transformCitations(
  text: string,
  whitelist: Set<string>,
  onVerified: (anchor: string, url: string) => string,
  onUnverified: (anchor: string, url: string) => string,
): string {
  return text.replace(CITE_RE, (_m, anchor: string, url: string) => {
    const status: CitationStatus = citationStatus(url, whitelist);
    return status === "verified" ? onVerified(anchor, url) : onUnverified(anchor, url);
  });
}

/** Markdown export: verified cites stay as-is, unverified collapse to plain text. */
export function toMarkdown(stitched: string, whitelist: Set<string>): string {
  return transformCitations(
    stitched,
    whitelist,
    (a, u) => `[${a}](${u})`,
    (a) => a,
  );
}

/**
 * HTML export: convert markdown headings, paragraphs, and citations into a
 * minimal, paste-ready HTML body. Verified cites become <a> tags; unverified
 * cites become <span class="unverified-citation"> so a CMS audit can spot them.
 */
export function toHtml(stitched: string, whitelist: Set<string>): string {
  // Inline citation transform happens BEFORE block-level transforms so the
 // `[..](..)` pattern doesn't get split across <p> boundaries.
  const withCites = transformCitations(
    stitched,
    whitelist,
    (a, u) => `<a href="${escapeAttr(u)}" rel="noopener">${escapeHtml(a)}</a>`,
    (a) => `<span class="unverified-citation">${escapeHtml(a)}</span>`,
  );

  // Block-level: split on blank lines, then promote heading lines.
  const blocks = withCites.split(/\n{2,}/).map((block) => {
    const trimmed = block.trim();
    if (!trimmed) return "";
    const h1 = trimmed.match(/^# (.+)$/);
    if (h1) return `<h1>${escapeHtmlPreservingTags(h1[1])}</h1>`;
    const h2 = trimmed.match(/^## (.+)$/);
    if (h2) return `<h2>${escapeHtmlPreservingTags(h2[1])}</h2>`;
    const h3 = trimmed.match(/^### (.+)$/);
    if (h3) return `<h3>${escapeHtmlPreservingTags(h3[1])}</h3>`;
    return `<p>${escapeHtmlPreservingTags(trimmed).replace(/\n/g, "<br />")}</p>`;
  });
  return blocks.filter(Boolean).join("\n");
}

/** Plain text export: strip markdown markers, keep verified URLs in parens. */
export function toPlainText(stitched: string, whitelist: Set<string>): string {
  let out = transformCitations(
    stitched,
    whitelist,
    (a, u) => `${a} (${u})`,
    (a) => a,
  );
  // Drop heading hashes
  out = out.replace(/^#{1,6}\s+/gm, "");
  return out;
}

/**
 * Wrap an HTML body and a set of JSON-LD blocks into a complete document
 * suitable for download. Schema blocks go in <head>; the title/meta come
 * from the project so Google Rich Results validation has everything it needs.
 */
export function buildHtmlDocument(opts: {
  title: string;
  description: string;
  bodyHtml: string;
  schemas: any[];
  lang?: string;
}): string {
  const schemaTags = opts.schemas
    .map((s) => `<script type="application/ld+json">\n${JSON.stringify(s, null, 2)}\n</script>`)
    .join("\n");
  return `<!doctype html>
<html lang="${opts.lang || "en"}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(opts.title)}</title>
<meta name="description" content="${escapeAttr(opts.description)}" />
${schemaTags}
</head>
<body>
${opts.bodyHtml}
</body>
</html>`;
}

// --- helpers ----------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

/**
 * Like `escapeHtml`, but leaves already-emitted citation tags
 * (<a ...>...</a> and <span class="unverified-citation">...</span>) intact.
 * The citation transform runs first, so by the time we reach block-level
 * promotion the only HTML in the string is from our own emitter.
 */
function escapeHtmlPreservingTags(s: string): string {
  // Split out our emitted tags, escape everything else, then rejoin.
  const TAG_RE = /(<a [^>]+>[\s\S]*?<\/a>|<span class="unverified-citation">[\s\S]*?<\/span>)/g;
  return s
    .split(TAG_RE)
    .map((chunk, i) => (i % 2 === 1 ? chunk : escapeHtml(chunk)))
    .join("");
}