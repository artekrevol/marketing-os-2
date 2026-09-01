---
name: Merge-splice diagnosis
description: How to handle merged files containing fragments from unrelated functions or tests.
---

When a merged file reports many unrelated undefined names across otherwise
stable flows, treat it as possible cross-block splice corruption rather than a
series of independent missing declarations. Compare the affected hunks with the
last coherent parent, restore each complete control-flow block, and then retain
only the narrow intended additions from the merge.

**Why:** Patching undefined identifiers one at a time can make the compiler
green while leaving route semantics, validators, or tests silently incorrect.

**How to apply:** Use the parent diff to identify foreign fragments, restore
whole logical blocks, run package-level checks first, then require the full
workspace typecheck and all test scripts before operational work.