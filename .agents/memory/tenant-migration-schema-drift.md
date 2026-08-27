---
name: Tenant migration schema drift
description: Legacy preview databases may have older QA table shapes than the current Drizzle schema.
---

When a tenant migration adds a relationship to a table whose live shape may lag the Drizzle schema, make the migration additive and preserve legacy rows in a quarantine table before tightening ownership constraints.

**Why:** The development database had zero-row QA overrides with an older column set, so a direct foreign-key migration failed at API startup.

**How to apply:** Inspect live columns before writing tenant migrations, add missing columns safely, quarantine rows that cannot be attributed, and verify the constraint after boot.