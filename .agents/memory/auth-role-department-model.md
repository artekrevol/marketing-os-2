---
name: Auth role/department two-axis model
description: How user_profiles authority (role) and craft (department) are modeled and where each must be enforced.
---

# User authority vs. craft are two orthogonal axes

`user_profiles` carries TWO independent columns, not one:
- **role** = AUTHORITY: `admin | lead | reviewer | member` (default `member`).
- **department** = CRAFT: `writer | editor | strategist | analyst | outreach | engineering | operations` (default `writer`).

`outreach` is a DEPARTMENT, never a role. Anyone treating `writer`/`outreach`
as a role is wrong. Authoritative consts/types live in `@workspace/db`
(`USER_ROLES`, `USER_DEPARTMENTS`, `UserRole`, `UserDepartment`).

**Why:** these were split out of a single overloaded `role` column so a person's
job function (craft) is independent of what they're allowed to do (authority).

## Module gating must be server-enforced, not just client-side

SEO OS entry is gated on `role ∈ {admin, lead, reviewer}` (members → ContentForge).
This gate exists in THREE places that must stay in sync:
- Frontend UX: SEO OS `AppShell` SEO_OS_ROLES + Hub SEO tile gate.
- **Server (authoritative):** `requireSeoRole` middleware mounted on the
  `/api/seo` router in `routes/index.ts`, BEFORE the subrouters.

**Why:** brand-access alone is NOT sufficient to enter SEO — a `member` with
brand access could otherwise call `/api/seo/*` directly. A client-only gate is a
broken-access-control bug.

**How to apply:** the role gate runs before the per-subrouter brand-access guard,
so a member is rejected (403) regardless of brand access. When adding any new
role-gated module, enforce it with a self-contained middleware at the router
mount point (model on `requireSeoRole`/`requireAdmin`), and surface `role` on
`req.auth` (AuthContext) — don't rely on the frontend.
