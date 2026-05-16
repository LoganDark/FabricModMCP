---
status: partial
phase: 37-smarter-java-discovery-cross-platform
source: [37-VERIFICATION.md]
started: 2026-05-16T06:25:00Z
updated: 2026-05-16T14:05:00Z
resolution: "Developer ruled CR-01 in-scope on 2026-05-16; converted to gap-closure plan 37-05. Gap closed and re-verified 2026-05-16T07:21:00Z — all 15 automated must-haves pass. Test #2 below remains pending: end-to-end CR-01 workflow validation against real JDT LS + Java + mod project."
---

## Current Test

Test #2 (end-to-end CR-01 workflow validation) — awaiting human testing.

## Tests

### 1. Workspace re-sync after JDT LS rescue (CR-01) — design-decision record
expected: Real navigation results — after `add_fabric_mod` rescues a degraded JDT LS session, a subsequent `find_definition` against any class in the newly-added mod's sources should jump to the correct file. Currently the response reports `jdtlsAvailable: true` but the new JDT LS session has an empty `.classpath` because `syncFabricModToWorkspace` runs against the old degraded session (no-op when `available === false`), then `retryDegradedJdtLsSessions` replaces the session with a fresh empty one.

**Repro:** start the server with no Java on PATH, then install Java 21+, then call `add_fabric_mod` against a project that had no projectRoot at startup. Attempt `find_definition` against any class from the mod's sources.

**Why human:** Sits outside JAVA-01..05 (those are strictly about discovery); requires real JDT LS + Java install + Minecraft mod to observe; plan must_haves do not mandate post-rescue workspace sync.

**Decision required:**
- Accept as known limitation (phase met JAVA-NN contract; document as follow-up)
- Require a follow-up plan to wire `syncFabricModToWorkspace` into `retryDegradedJdtLsSessions`
- Override the gap with `overrides:` frontmatter

result: issues — Developer ruled CR-01 IN-SCOPE for Phase 37 on 2026-05-16. The retry hook's user-visible promise (Java install unlocks degraded JDT LS for navigation) is not delivered without workspace re-sync after rescue. Converted to gap closure — completed via plan 37-05 (commits a6db728, 687a986, 7c3381e). Re-verifier confirmed all 15 automated must-haves pass on 2026-05-16T07:21:00Z.

### 2. End-to-End Workspace Re-Sync After JDT LS Rescue (CR-01)
expected: Start the MCP server with no Java on PATH and no `JAVA_HOME` set so the default project initializes with `available: false`. Install Java 21+. Call `add_fabric_mod` against the project. After the call succeeds (`jdtlsAvailable: true` in the response), call `find_definition` against any class in the newly-added mod's sources. The definition should jump to the correct file. The new code in `retryDegradedJdtLsSessions` (`src/jdtls/startup.ts:167-181`) iterates fabric-mod children and calls `syncFabricModToWorkspace(child, newSession, jarReader)` for each, so the rescued session's `.classpath` is populated before the function returns. No second `refresh_project` call should be required.

**Why human:** Requires a real JDT LS installation, a real Java 21+ runtime, and a real Minecraft mod project with source jars present in the Gradle cache. Unit tests (Test 1 in Task 2 of plan 37-05) assert that `syncFabricModToWorkspace` is called exactly twice (once per fabric-mod child, never for study-jar children) with the correct `newSession` and `jarReader` references — but cannot verify that JDT LS actually indexes the workspace and returns non-empty definition results.

result: [pending]

## Summary

total: 2
passed: 0
issues: 1
pending: 1
skipped: 0
blocked: 0

## Gaps

- CR-01 (design-decision record) → resolved via gap-closure plan 37-05; verifier confirmed all automated must-haves pass on 2026-05-16T07:21:00Z.
- CR-01 (end-to-end workflow validation) → pending human verification — see Test #2.
