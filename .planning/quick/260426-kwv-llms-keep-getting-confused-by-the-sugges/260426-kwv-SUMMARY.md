---
phase: quick-260426-kwv
plan: 01
subsystem: tools
tags: [mcp, response-envelope, suggestions, llm-ux]

# Dependency graph
requires: []
provides:
  - refresh_project response envelope without dependency-download suggestion
  - refresh_project_members response envelope without dependency-download suggestion
  - JAR_NO_SOURCES error envelope without download suggestion
affects: [tool response shape, LLM tool-use prompts]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Suggestions field is omitted entirely (not empty array) when no suggestion applies"

key-files:
  created: []
  modified:
    - src/tools/refresh-project.ts
    - src/tools/refresh-project-members.ts
    - src/tools/read-jar-entry.ts

key-decisions:
  - "Drop suggestions field entirely from refresh tool envelopes rather than emit empty array — keeps shape clean for clients"
  - "Preserved Minecraft genSources suggestion in loader.ts unchanged (different concern: Loom-managed sources jar regeneration vs. dependency download)"
  - "Left descriptions.ts mentions of downloadSources untouched — documentation, not LLM-confusing suggestion strings"

patterns-established:
  - "Suggestions in error envelopes should be actionable and unambiguous; omit when prior heuristics misled the LLM"

requirements-completed: [QUICK-260426-KWV-01]

# Metrics
duration: ~2min
completed: 2026-04-26
---

# Quick Task 260426-kwv: Drop downloadSources suggestion from MCP responses Summary

**Removed three `./gradlew downloadSources` suggestion strings from MCP tool envelopes (refresh_project, refresh_project_members, read_jar_entry JAR_NO_SOURCES) while preserving the unrelated Minecraft `genSources` suggestion in loader.ts.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-26T22:06:14Z
- **Completed:** 2026-04-26T22:08:00Z (approx)
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- `refresh_project` envelope no longer carries a `suggestions` field nor mentions `downloadSources`
- `refresh_project_members` envelope no longer carries a `suggestions` field nor mentions `downloadSources`
- `read_jar_entry`'s `JAR_NO_SOURCES` error returned by `returnError` no longer passes a 4th-argument suggestion array
- Minecraft `genSources` warning (loader.ts:93) and SOURCES_JAR_NOT_FOUND DomainError suggestions (loader.ts:179) verified intact byte-for-byte

## Task Commits

1. **Task 1: Remove dependency-download suggestion from refresh_project and refresh_project_members** — `9963ab8` (fix)
2. **Task 2: Remove download suggestion from read_jar_entry JAR_NO_SOURCES error** — `c195fa6` (fix)

## Files Created/Modified
- `src/tools/refresh-project.ts` — Deleted local `suggestions` block (lines 132–137 in pre-edit) and the `suggestions,` field in the `makeSuccess` envelope
- `src/tools/refresh-project-members.ts` — Deleted local `suggestions` block (lines 170–175 in pre-edit) and the `suggestions,` field in the `makeSuccess` envelope
- `src/tools/read-jar-entry.ts` — Dropped 4th argument (suggestions array) from the `JAR_NO_SOURCES` `returnError(...)` call

## Verification

- `pnpm exec tsc --noEmit` — passes (no errors)
- `pnpm test` — all 65 test files / 708 tests pass
- `rg "downloadSources" src/tools/refresh-project.ts src/tools/refresh-project-members.ts src/tools/read-jar-entry.ts` — 0 matches
- `rg "Run \./gradlew genSources" src/project/loader.ts` — finds line 93 (warning) and line 179 (suggestion) — preserved
- `rg "downloadSources" src/tools/` — only matches in `descriptions.ts` (intentionally preserved as user-facing documentation, not envelope suggestions)

## Decisions Made
- See `key-decisions` in frontmatter. Most significantly: omit the `suggestions` field entirely when no suggestion applies, rather than emitting `suggestions: []`.

## Deviations from Plan

None — plan executed exactly as written. No tests required updating (planning correctly identified that no tests asserted on the removed strings).

## Issues Encountered
None.

## User Setup Required
None — no external configuration required.

## Next Phase Readiness
- Quick task complete and verified.
- No follow-up needed. Future LLM clients should no longer be nudged toward spurious `./gradlew downloadSources` invocations.

## Self-Check: PASSED

- `src/tools/refresh-project.ts` — modified, no `downloadSources` or `suggestions` references — FOUND
- `src/tools/refresh-project-members.ts` — modified, no `downloadSources` or `suggestions` references — FOUND
- `src/tools/read-jar-entry.ts` — modified, no `downloadSources` references — FOUND
- Commit `9963ab8` — FOUND in `git log`
- Commit `c195fa6` — FOUND in `git log`
- `src/project/loader.ts` — `Run ./gradlew genSources` references at lines 93 and 179 — PRESERVED

---
*Quick task: 260426-kwv*
*Completed: 2026-04-26*
