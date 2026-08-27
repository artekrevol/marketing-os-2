---
name: Brand playbook isolation
description: Rules for keeping playbook-derived AI context isolated and stable across brands and versions.
---

Playbook fallbacks and validation rules must be brand-neutral unless they are explicitly derived from the owning brand and pinned playbook version. An explicitly requested playbook version must fail closed when it is missing for that brand; never silently substitute the latest version.

**Why:** A global identity, credential fallback, or latest-version fallback can leak one customer's confidential instructions into another customer's generated content.

**How to apply:** Pass brand and version through every AI route and queued job, include both in prompt-cache identity, and scope every playbook/version query by brand.