---
name: Telemetry attribution
description: Rules for keeping brand work and global platform telemetry distinct.
---

Brand-work telemetry must carry its owning brand; only genuine platform-health
telemetry may omit it, and those rows must use an explicit global scope marker.
AI usage is always brand-scoped because it feeds cost reporting.

**Why:** A nullable brand ID otherwise lets activity and spend reports silently
mix brands or lose attribution, especially during historical-data backfills.

**How to apply:** When adding a telemetry writer or report, require/propagate
the brand and filter by the authorized brand. For migrations, backfill usage
from its project and fail if any usage row remains unattributable; classify
legacy null-brand platform rows as global.