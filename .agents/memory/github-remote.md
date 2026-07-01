---
name: GitHub remote for this project
description: Which GitHub repo GH_PUSH_TOKEN can actually push to, and the trap of the "official" name.
---
The GitHub push destination for this project is **`artekrevol/marketing-os-2`**, NOT `artekrevol/marketing-os`.

- `artekrevol/marketing-os` returns **404 — it does not exist**. Any push there fails with a misleading `403 Write access to repository not granted`.
- `GH_PUSH_TOKEN` authenticates as user `artekrevol` and has push + admin on `marketing-os-2` (confirmed via `GET /repos/...` → `permissions.push=true`).

**Why:** Docs/task descriptions may still reference the old `marketing-os` name. A 403 on push usually looks like a permission problem but here it means the repo name is wrong / nonexistent.

**How to apply:** Before pushing, if you get a 403, hit `https://api.github.com/repos/artekrevol/<name>` with the token to confirm the repo exists and `permissions.push` is true. Use `marketing-os-2` as origin.
