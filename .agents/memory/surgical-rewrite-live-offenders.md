---
name: Surgical rewrite live-offender recompute
description: Why paragraph-level repair passes in final-stitch must recompute offenders from live text, not plan-time snapshots.
---

# Surgical rewrite: recompute offenders from live text

In the final-stitch route, multiple "nets" repair the stitched article one paragraph at a time (repetition net, density net, etc.). Each planned fix captures the offending paragraph's exact text at plan time and later applies it via `stitched.replace(capturedPara, out)`, guarded by `if (!stitched.includes(capturedPara)) continue;`.

**The trap:** a single paragraph can be an offender for MORE THAN ONE net (e.g. the intro paragraph was both a repetition offender and a stat-density offender). Fixes are applied in array order — repetition first. Once the repetition fix mutates `stitched`, the later density fix's captured snapshot no longer exists verbatim, so it hits the silent `continue` no-op and never runs. Symptom in logs: `planned:2 applied:1 densityLeft:1` with NO skip-warning (the `continue` is silent).

**The rule:** any paragraph-level repair that can target a paragraph another net already touched must recompute its offenders from the LIVE `stitched` at apply time, not from a plan-time snapshot. The working pattern is a dedicated follow-up loop, hard-capped (≈6 rounds), that each round re-finds the first live offending paragraph, rewrites it, and applies only if all invariants hold AND the metric strictly improves (`countDensityOffenders(candidate) < countDensityOffenders(stitched)`) — strict improvement is what makes the bounded loop safe from infinite retries.

**Why:** Cut B Blog #1 (`stat_density` check) kept failing on one intro paragraph despite the density net being present, purely because the repetition net ran first and invalidated the snapshot.

**How to apply:** when adding or debugging a new per-paragraph net in final-stitch, never trust plan-time captured paragraph text if an earlier net may have edited it; recompute against current `stitched`. Watch `requestTimeout` (900_000ms in api-server index.ts) — these repair loops are serial Sonnet calls (~minutes each), so keep round caps small.
