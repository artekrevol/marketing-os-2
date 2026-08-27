---
name: Playbook live-schema compatibility
description: Compatibility note for real database playbook isolation tests and foreign-key cleanup.
---

The live database may lag the current Drizzle schema: playbook foreign keys can lack the declared cascading delete behavior. Real-data tests should delete playbook sections and playbook rows explicitly before deleting fixture brands.

**Why:** A test teardown that assumes the current schema's cascade can fail after all assertions pass and leave fixture data behind.

**How to apply:** Keep fixture cleanup ordered from child rows to parent rows, and treat schema synchronization as separate migration work.