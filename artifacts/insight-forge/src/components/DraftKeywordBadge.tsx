/**
 * Cross-module read shown in the project header: surfaces the SEO keyword this
 * draft targets (and its live ranking) by reading from SEO OS. Follows the four
 * dispatch rules — never throws, explicit empty states, always tags the source,
 * and treats staleness as data. When nothing is linked it offers an inline
 * "set it now" affordance that writes the link back into SEO OS.
 */
import { useCallback, useEffect, useState } from "react";
import { Target, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { DataSourceTag } from "@workspace/ui-shared";
import {
  crossModule,
  type CrossLocation,
  type CrossResult,
  type LinkedKeyword,
} from "@/lib/cross-module";

export function DraftKeywordBadge({
  brandId,
  projectId,
  fallbackKeyword,
}: {
  brandId: string;
  projectId: string;
  fallbackKeyword: string | null;
}) {
  const [result, setResult] = useState<CrossResult<LinkedKeyword[]> | null>(null);
  const [loading, setLoading] = useState(true);
  const [setting, setSetting] = useState(false);
  const [draftKw, setDraftKw] = useState(fallbackKeyword ?? "");
  const [locationId, setLocationId] = useState("");
  const [locations, setLocations] = useState<CrossLocation[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await crossModule.keywordsForContent(brandId, projectId);
      setResult(res);
    } catch {
      setResult({ data: [], source: null, reason: "system-error" });
    } finally {
      setLoading(false);
    }
  }, [brandId, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!setting || locations.length > 0) return;
    crossModule
      .listLocations(brandId)
      .then(setLocations)
      .catch(() => setLocations([]));
  }, [setting, brandId, locations.length]);

  const save = async () => {
    const kw = draftKw.trim();
    if (!kw) {
      toast.error("Enter a target keyword.");
      return;
    }
    setSaving(true);
    try {
      await crossModule.attach({
        brandId,
        projectId,
        keywordText: kw,
        locationId: locationId || null,
        isCanonical: true,
      });
      toast.success("Target keyword linked to SEO OS.");
      setSetting(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn’t link keyword.");
    } finally {
      setSaving(false);
    }
  };

  if (loading && !result) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking target keyword…
      </span>
    );
  }
  if (!result) return null;

  const canonical = result.data.find((k) => k.isCanonical) ?? result.data[0] ?? null;

  if (canonical) {
    return (
      <div className="inline-flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-secondary/60">
          <Target className="h-3.5 w-3.5 text-accent" />
          <span className="font-medium">{canonical.keywordText}</span>
          <span className="text-ink-muted">
            {canonical.currentRanking != null ? `· #${canonical.currentRanking}` : "· not ranking yet"}
          </span>
        </span>
        <DataSourceTag source={result.source} reason={result.reason} />
      </div>
    );
  }

  // Rule 1/4: a system error is NOT "no keyword". Distinguish the two so we
  // never tell the user "no target keyword set" when SEO OS was simply
  // unreachable. Offer a retry and still tag the (failed) source.
  if (result.reason === "system-error") {
    return (
      <div className="inline-flex flex-wrap items-center gap-2 text-xs text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <Target className="h-3.5 w-3.5" /> Couldn’t reach SEO OS
        </span>
        <button onClick={() => void load()} className="text-accent hover:underline">
          retry
        </button>
        <DataSourceTag source={result.source} reason={result.reason} />
      </div>
    );
  }

  // Nothing linked yet — explicit empty state + inline "set it now".
  if (!setting) {
    return (
      <div className="inline-flex items-center gap-2 text-xs text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <Target className="h-3.5 w-3.5" /> No target keyword set
        </span>
        <DataSourceTag source={result.source} reason={result.reason} />
        <button
          onClick={() => setSetting(true)}
          className="inline-flex items-center gap-1 text-accent hover:underline"
        >
          <Plus className="h-3 w-3" /> set it now
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={draftKw}
        onChange={(e) => setDraftKw(e.target.value)}
        placeholder="Target keyword"
        className="px-2 py-1 text-xs bg-background border border-rule rounded-sm focus:outline-none focus:ring-2 focus:ring-ring"
        autoFocus
      />
      <select
        value={locationId}
        onChange={(e) => setLocationId(e.target.value)}
        className="px-2 py-1 text-xs bg-background border border-rule rounded-sm"
      >
        <option value="">Any location</option>
        {locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      <button
        onClick={() => void save()}
        disabled={saving}
        className="px-2.5 py-1 text-xs rounded-sm bg-ink text-paper hover:bg-accent disabled:opacity-50 inline-flex items-center gap-1"
      >
        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
        Link
      </button>
      <button
        onClick={() => setSetting(false)}
        className="px-2 py-1 text-xs text-ink-muted hover:text-ink"
      >
        Cancel
      </button>
    </div>
  );
}
