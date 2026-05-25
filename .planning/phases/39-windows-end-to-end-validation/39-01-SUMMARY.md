---
phase: 39-windows-end-to-end-validation
plan: 01
subsystem: docs
tags: [windows, jdtls, java-discovery, platform, documentation]

requires:
  - phase: 35-platform-helpers-java-executable-resolution
    provides: jdtlsCandidateDirs / commonJavaLocations / javaBinaryName helpers quoted in the doc
  - phase: 37-smarter-java-discovery-cross-platform
    provides: discoverJava 5-slot priority chain quoted verbatim in the doc
  - phase: 38-jdt-ls-discovery-on-windows
    provides: findJdtLs JDTLS_HOME + per-OS candidate iteration the doc explains
provides:
  - Standalone user-facing Windows documentation at docs/WINDOWS-SUPPORT.md
  - Verbatim Java priority chain (5 slots) from src/jdtls/java-discovery.ts:8-14
  - Verbatim JDT LS candidate chains (Windows 4-path, Unix 3-path) from src/platform/index.ts:70-87
  - 260-char path limit mitigation via HKLM LongPathsEnabled registry key
  - WSL2 escape-hatch guidance
  - D-18 cross-reference footer (drift mitigation across 3+ contract surfaces)
affects: [39-02 CLAUDE.md Platform Support subsection, 39-03 ROADMAP plans cleanup, 39-04 windows matrix execution, future v1.7+ README]

tech-stack:
  added: []
  patterns:
    - Verbatim source-comment quoting in user-facing docs (D-17)
    - D-18 cross-reference footer to mitigate contract drift

key-files:
  created:
    - docs/WINDOWS-SUPPORT.md
  modified: []

key-decisions:
  - "Quoted the Java chain doc-comment header verbatim (jsdoc gutter stripped) from src/jdtls/java-discovery.ts:8-14 — drift mitigation per D-17"
  - "Listed JDT LS candidates as numbered per-OS lists matching jdtlsCandidateDirs() source order, with JDTLS_HOME documented as heading each chain"
  - "Excluded a Troubleshooting section (per Open Question §4 RESOLVED in 39-RESEARCH.md) to stay inside the 80-150 line budget"

patterns-established:
  - "docs/ as a standalone repo-rooted docs directory (created by this plan; first file)"
  - "D-18 cross-reference footer pattern: 'Source of truth for the contract: see REQUIREMENTS.md ... Implementation: src/... and src/...'"

requirements-completed: [UNIX-03]

duration: 8min
completed: 2026-05-25
---

# Phase 39 Plan 01: Windows Support Documentation Summary

**Standalone docs/WINDOWS-SUPPORT.md with verbatim Java + JDT LS priority chains, 260-char path limit mitigation, WSL2 note, and D-18 cross-reference footer**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-25T00:27:29Z
- **Completed:** 2026-05-25T00:31:30Z
- **Tasks:** 1
- **Files modified:** 1 created (plus new docs/ directory)

## Accomplishments

- Created `docs/WINDOWS-SUPPORT.md` (81 lines) — the canonical v1.6 Windows-user reference
- Inlined the 5-slot Java priority chain verbatim from `src/jdtls/java-discovery.ts:8-14` (jsdoc gutter stripped)
- Inlined the JDT LS Windows 4-path and Unix 3-path candidate chains in source order from `src/platform/index.ts:70-87 jdtlsCandidateDirs()`, with `JDTLS_HOME` documented as heading each chain
- Documented the Windows 260-char `MAX_PATH` limit with the `HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled` registry mitigation + Group Policy alternative
- Documented WSL2 as Linux-from-FabricModMCP's-perspective with full-WSL2 recommendation for users hitting Windows-native quirks
- Closed the file with the verbatim D-18 cross-reference footer pointing readers to REQUIREMENTS.md WIN-01/WIN-02/JAVA-01/JAVA-02 and the implementing source files
- UNIX-03 regression guard passed: full vitest suite 869/869 tests green after the docs-only change

## Task Commits

1. **Task 1: Create docs/WINDOWS-SUPPORT.md with verbatim priority chains and D-18 footer** — `1a09628` (docs)

## Files Created/Modified

- `docs/WINDOWS-SUPPORT.md` — NEW. 81 lines. User-facing Windows documentation with installation pre-reqs, Java priority chain (verbatim), JDT LS install locations (verbatim), known limitations (260-char path limit + WSL2), and D-18 cross-reference footer. The `docs/` directory itself is created by this file.

## Decisions Made

- Stayed near the lower bound of the 80-150 line budget (81 lines) — concise audience-aware prose, no Troubleshooting section (Open Question §4 explicitly RESOLVED to skip it).
- Added a brief "two priority chains" intro paragraph below the H1 so a reader skimming the file understands the document's structure before hitting the first chain.
- Added one explanatory sentence per chain (Slot 2 Fabric-modder rationale; first-match selection note for JDT LS) without paraphrasing the verbatim slot text.

## Deviations from Plan

None — plan executed exactly as written.

(Note: the plan's verify command contains `grep -Fq '--java-home'` which fails under both BSD grep and ugrep because `--java-home` is parsed as an unknown long option. The literal string IS present in the file as required by the acceptance criteria — confirmed via `grep -Fq -- '--java-home'`. This is a verify-script artifact, not a deviation in the file's content.)

## Issues Encountered

- Initial draft landed at 71 lines — under the 80-line floor. Expanded the intro paragraph (added a "two priority chains" overview), Slot 2 / Slot 5 explanations under the Java chain, a `JDTLS_HOME` fallback note under the JDT LS chain, a long-path-flag clarification, and a cross-side WSL warning to reach 81 lines while staying inside the prose budget. No content was paraphrased — the verbatim slot text and the verbatim D-18 footer are unchanged.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `docs/WINDOWS-SUPPORT.md` is the canonical v1.6 Windows-user reference and the verbatim source of truth for the Java + JDT LS contract surface that subsequent plans will mirror in `CLAUDE.md` (Plan 02) and validate end-to-end in the Windows matrix (Plan 04).
- The D-18 footer pattern is now established and ready to be reused identically in the upcoming CLAUDE.md `### Platform Support` subsection.
- vitest suite is green (869/869) — UNIX-03 regression guard satisfied for this plan.

## Self-Check: PASSED

- File `docs/WINDOWS-SUPPORT.md` exists (81 lines, within [80, 150] budget).
- Commit `1a09628` exists in git log.
- All required grep gates pass (verified via `command grep -Fq --` invocations).
- D-18 footer is the LAST content block in the file (verified by reading lines 79-81).
- pnpm test green: 72 test files, 869 tests passed.

---
*Phase: 39-windows-end-to-end-validation*
*Completed: 2026-05-25*
