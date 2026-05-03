/**
 * Project-scoped citation whitelist (client-side mirror of the server-side
 * whitelist used in supabase/functions/draft-section). A citation URL is
 * "verified" when its host matches one of the project's known sources:
 *   - any starred or unstarred proof_point.source_url
 *   - any top_cited_sources.url or suggested_authority_sources.url_or_topic
 *     from research_briefs.ai_citation_landscape
 *   - the project's own company_domain
 *
 * Deliberately excluded: benchmark_url and competitor_url. Those are
 * research inputs (read for landscape analysis), not citation sources.
 * Citing a competitor inside our own article is off-brand by default.
 *
 * Match is by HOST (not exact URL) so deep links into a whitelisted domain
 * still verify. Anything else is rendered as "unverified" — keeping fake
 * URLs visually distinct without removing them from the prose.
 */
export type CitationStatus = "verified" | "unverified";

export function normalizeHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    if (!/^https?:$/.test(url.protocol)) return null;
    return url.host.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export interface WhitelistInputs {
  proofs?: Array<{ source_url?: string | null }> | null;
  briefLandscape?: {
    top_cited_sources?: Array<{ url?: string | null }>;
    suggested_authority_sources?: Array<{ url_or_topic?: string | null }>;
  } | null;
  project?: {
    company_domain?: string | null;
  } | null;
}

export function buildWhitelistHosts(inputs: WhitelistInputs): Set<string> {
  const hosts = new Set<string>();
  const add = (u: string | null | undefined) => {
    const h = normalizeHost(u);
    if (h) hosts.add(h);
  };
  for (const p of inputs.proofs || []) add(p?.source_url || undefined);
  const ls = inputs.briefLandscape;
  for (const s of ls?.top_cited_sources || []) add(s?.url || undefined);
  for (const s of ls?.suggested_authority_sources || []) add(s?.url_or_topic || undefined);
  // benchmark_url / competitor_url intentionally excluded — see file header.
  if (inputs.project?.company_domain) add(`https://${inputs.project.company_domain}`);
  return hosts;
}

export function citationStatus(url: string, hosts: Set<string>): CitationStatus {
  const h = normalizeHost(url);
  return h && hosts.has(h) ? "verified" : "unverified";
}