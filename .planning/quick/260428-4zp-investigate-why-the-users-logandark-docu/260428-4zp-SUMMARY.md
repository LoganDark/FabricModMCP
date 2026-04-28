---
phase: quick-260428-4zp
plan: 01
subsystem: project
tags: [investigation, dependency-resolution, gradle, maven, source-jar]

requires: []
provides:
  - Diagnosis of why dep-source tools cannot list/read auxcommands for the CreatorCore/Claude project
  - Concrete root cause pinned to src/project/source-jar-finder.ts
  - Fix-direction sketch (extend Maven repo discovery beyond ~/.gradle/caches/modules-2)
affects: [next quick task that fixes dependency resolution from local Maven repos]

tech-stack:
  added: []
  patterns:
    - "Investigation pattern: end-to-end repro driver in quick-task directory + on-disk cache reality check + code-path trace"

key-files:
  created:
    - .planning/quick/260428-4zp-investigate-why-the-users-logandark-docu/260428-4zp-FINDINGS.md
    - .planning/quick/260428-4zp-investigate-why-the-users-logandark-docu/repro.ts
  modified: []

key-decisions:
  - "Plan's space-in-path framing was a misread (path is /CreatorCore/Claude, not /CreatorCore/Claude auxcommands); investigation refocused on why the auxcommands dep specifically fails while ~52 sibling deps succeed"
  - "Fix is deferred to a follow-up quick task; this task is investigation-only and does not modify any source under src/"

patterns-established:
  - "Repro scaffolding (repro.ts) lives inside the quick-task directory and is kept (not deleted) because FINDINGS.md references it"

requirements-completed: [INV-260428-4zp-01]

duration: ~10min
completed: 2026-04-28
---

# Phase quick-260428-4zp Plan 01: Investigate auxcommands dep-source failure — Summary

**Root cause: `src/project/source-jar-finder.ts:findSourcesJar` only consults `~/.gradle/caches/modules-2/files-2.1/`, so deps published to a `file://` Maven repo (here `~/maven`) are silently recorded as `available: false` and filtered out of dep-source tool results.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-04-28T10:34:00Z (approx)
- **Completed:** 2026-04-28T10:44:05Z
- **Tasks:** 2
- **Files modified:** 2 (FINDINGS.md created, repro.ts created)

## Accomplishments

- Reproduced the failure end-to-end against `/Users/LoganDark/Documents/Projects/CreatorCore/Claude` via a tsx repro driver — captured `{"id":"claude/net.logandark:auxcommands", "sourcesJarPath": null, "available": false}` while 52 sibling deps resolved successfully.
- Pinned the failure to the exact code path: `gradle-parser.ts` (parses the coord cleanly) → `dependency-discovery.ts:addDependencyEntry` (line 65) → `source-jar-finder.ts:findSourcesJar` (line 14 hardcodes the modules-2 base, line 28 silently swallows ENOENT).
- Verified the on-disk reality: sources jar exists at `~/maven/net/logandark/auxcommands/1.0.0+1.21.11/auxcommands-1.0.0+1.21.11-sources.jar` (13502 bytes) and is absent from `~/.gradle/caches/modules-2/files-2.1/` entirely.
- Corrected the plan's misframing (no space in the path; "Claude" and "AuxCommands" are sibling projects under `CreatorCore/`) and substituted a project-shape comparison for the moot space-in-path test.
- Sketched a fix direction (extend `gradle-parser` to extract `repositories { maven { url = uri("file://...") } }` blocks; have `findSourcesJar` probe each Maven root in standard Maven layout) plus a narrower interim alternative (unconditional `~/maven` and `~/.m2/repository` fallback).

## Task Commits

1. **Task 1: Reproduce + project shape + code-path trace** — `e245605` (docs)
2. **Task 2: Cache check + space-test verdict + diagnosis + fix direction** — `157439d` (docs)

## Files Created/Modified

- `.planning/quick/260428-4zp-investigate-why-the-users-logandark-docu/260428-4zp-FINDINGS.md` — full diagnosis (8 sections: Reproduction, Project Shape on Disk, Code-Path Trace, Cache Reality Check, Space-in-Path Test, Root Cause, Suggested Fix Direction, Out of Scope).
- `.planning/quick/260428-4zp-investigate-why-the-users-logandark-docu/repro.ts` — throwaway tsx driver that loads the Claude project and dumps `dependencyJars`. Kept inside the quick directory because FINDINGS.md references it as the reproduction harness.

## Decisions Made

- The plan was drafted under a misreading of the project path. Rather than execute the "Space-in-Path Test" task literally (against a path with no space), the investigation substituted a project-shape comparison: confirm path/whitespace is innocent, then explain why this dep specifically (out of 54) fails. Per the orchestrator's corrected framing.
- `repro.ts` retained, not deleted, since FINDINGS.md cites it as the reproduction command. It lives only inside the quick directory; nothing under `src/` was touched.

## Deviations from Plan

### Plan-framing correction (not a deviation rule, just a re-scope)

**Plan was drafted under the misreading that the project path was `/Users/LoganDark/Documents/Projects/CreatorCore/Claude auxcommands` (containing a space).** Actual state: the path is `/Users/LoganDark/Documents/Projects/CreatorCore/Claude` (no space) and `AuxCommands` is a separate sibling project that publishes to `~/maven`. The "Space-in-Path Test" task was reframed (per the orchestrator's prompt) as "why does auxcommands specifically fail when other deps succeed?" — same investigation rigor, different framing. Documented explicitly in FINDINGS.md's preamble note and Space-in-Path Test section.

No Rule-1/2/3 auto-fixes triggered. No code under `src/` was modified (this is investigation-only by design).

---

**Total deviations:** 0 auto-fixed; 1 plan-framing correction (handled via orchestrator-supplied corrected target).
**Impact on plan:** None on rigor — all six required FINDINGS sections present with concrete evidence. The "space" investigation became a sanity check rather than the centerpiece.

## Issues Encountered

None during investigation. The repro succeeded on the first run, the on-disk evidence was unambiguous, and the code-path trace pinned exactly one function with one silently-swallowed error.

## User Setup Required

None.

## Next Phase Readiness

- Diagnosis is complete and actionable. A follow-up quick task can open with the prompt "fix `src/project/source-jar-finder.ts` to consult Maven repositories declared in `build.gradle.kts` (and `~/maven` as a useful fallback) in addition to `~/.gradle/caches/modules-2/files-2.1/`" with no further investigation needed.
- The fix touches `src/project/source-jar-finder.ts` (primary), `src/project/gradle-parser.ts` (extract `repositories { ... }` Maven URLs), `src/project/dependency-discovery.ts` (thread Maven roots through, mirror for `findPomInModules2`), and `src/project/types.ts` (extend `GradleConfig` with Maven roots). No tool-layer message changes recommended.

---

## Self-Check: PASSED

- FINDINGS.md exists at `.planning/quick/260428-4zp-investigate-why-the-users-logandark-docu/260428-4zp-FINDINGS.md` (215 lines).
- repro.ts exists at `.planning/quick/260428-4zp-investigate-why-the-users-logandark-docu/repro.ts`.
- Commits `e245605` and `157439d` exist on master.
- All six required FINDINGS sections present (Reproduction, Project Shape on Disk, Code-Path Trace, Cache Reality Check, Space-in-Path Test, Root Cause, Suggested Fix Direction; plus Out of Scope).
- No files under `src/` were modified.

---
*Phase: quick-260428-4zp*
*Completed: 2026-04-28*
