---
status: resolved
phase: 37-smarter-java-discovery-cross-platform
source: [37-VERIFICATION.md]
started: 2026-05-16T06:25:00Z
updated: 2026-05-16T06:30:00Z
resolution: "Developer ruled CR-01 in-scope on 2026-05-16; converted to gap-closure plan via 37-VERIFICATION.md status gaps_found."
---

## Current Test

[awaiting human testing]

## Tests

### 1. Workspace re-sync after JDT LS rescue (CR-01)
expected: Real navigation results — after `add_fabric_mod` rescues a degraded JDT LS session, a subsequent `find_definition` against any class in the newly-added mod's sources should jump to the correct file. Currently the response reports `jdtlsAvailable: true` but the new JDT LS session has an empty `.classpath` because `syncFabricModToWorkspace` runs against the old degraded session (no-op when `available === false`), then `retryDegradedJdtLsSessions` replaces the session with a fresh empty one.

**Repro:** start the server with no Java on PATH, then install Java 21+, then call `add_fabric_mod` against a project that had no projectRoot at startup. Attempt `find_definition` against any class from the mod's sources.

**Why human:** Sits outside JAVA-01..05 (those are strictly about discovery); requires real JDT LS + Java install + Minecraft mod to observe; plan must_haves do not mandate post-rescue workspace sync.

**Decision required:**
- Accept as known limitation (phase met JAVA-NN contract; document as follow-up)
- Require a follow-up plan to wire `syncFabricModToWorkspace` into `retryDegradedJdtLsSessions`
- Override the gap with `overrides:` frontmatter

result: issues — Developer ruled CR-01 IN-SCOPE for Phase 37 on 2026-05-16. The retry hook's user-visible promise (Java install unlocks degraded JDT LS for navigation) is not delivered without workspace re-sync after rescue. Converted to gap closure — see 37-VERIFICATION.md `gaps[0]` and the upcoming gap-closure plan from `/gsd:plan-phase 37 --gaps`.

## Summary

total: 1
passed: 0
issues: 1
pending: 0
skipped: 0
blocked: 0

## Gaps

- CR-01 → tracked as `gaps[0]` in 37-VERIFICATION.md; gap-closure plan pending via `/gsd:plan-phase 37 --gaps`
