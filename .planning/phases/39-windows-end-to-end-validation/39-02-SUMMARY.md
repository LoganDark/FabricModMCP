---
phase: 39
plan: 02
subsystem: docs
tags: [windows-support, claude-md, platform-support, priority-chain, drift-mitigation]
dependency_graph:
  requires:
    - "Phases 35-38 implementations (Java discovery chain, JDT LS discovery, platform helpers) shipped"
    - "src/jdtls/java-discovery.ts:8-14 doc-comment header (source of truth for Java chain)"
    - "src/platform/index.ts:70-87 jdtlsCandidateDirs() body (source of truth for JDT LS chain)"
  provides:
    - "CLAUDE.md ### Platform Support — session-context-loaded priority chain reference for every future Claude instance working on FabricModMCP"
  affects:
    - "All future Claude sessions on this project — adds ~36 lines to loaded session context per D-16's accepted cost"
tech_stack:
  added: []
  patterns:
    - "Verbatim source quoting + D-18 cross-reference footer (drift mitigation across multiple surfaces)"
    - "Sibling H3 subsection inside ## Technology Stack — bold-prose intro lines (no ####), matching surrounding subsections"
key_files:
  created: []
  modified:
    - "CLAUDE.md (+34 lines — new ### Platform Support subsection inside ## Technology Stack)"
decisions:
  - "Used bold-prose intro lines (`**Windows:**` / `**Linux / macOS:**`) instead of `####` sub-subsection headers per 39-PATTERNS.md recommendation, matching sibling-subsection style"
  - "Quoted Java priority chain text verbatim from src/jdtls/java-discovery.ts:8-14 (5 slots) to match docs/WINDOWS-SUPPORT.md byte-for-byte"
  - "Quoted JDT LS chain text verbatim from src/platform/index.ts:70-87 (Windows 4 paths, Linux/macOS 3 paths) with JDTLS_HOME documented as heading each OS chain"
  - "D-18 footer placed at end of subsection BEFORE ### Supporting Libraries — identical wording to docs/WINDOWS-SUPPORT.md so the two surfaces stay consistent"
metrics:
  duration_minutes: 5
  completed_date: "2026-05-25"
  tasks_completed: 1
  files_changed: 1
  lines_added: 34
  lines_removed: 0
  tests_pass: 869
---

# Phase 39 Plan 02: Add ### Platform Support Subsection to CLAUDE.md Summary

Inserted a new `### Platform Support` H3 subsection into `CLAUDE.md` inside the existing `## Technology Stack` block (between `### Build & Development` and `### Supporting Libraries`), inlining the full Java discovery priority chain and JDT LS install location chains verbatim from source-of-truth files, with the D-18 cross-reference footer pointing to REQUIREMENTS.md and the implementing source files.

## Goal Achievement

Every observable truth from the plan's `must_haves` block is satisfied:

| Truth | Status | Evidence |
|-------|--------|----------|
| `CLAUDE.md` contains a new `### Platform Support` subsection inside `## Technology Stack` (NOT top-level `## Platform Support`) | ✓ | `grep -nE '^### Platform Support$' CLAUDE.md` returns line 71; awk-bounded grep inside `## Technology Stack` confirms placement (`INSIDE_TECH_STACK_OK`) |
| Inserted between `### Build & Development` and `### Supporting Libraries` | ✓ | Visual inspection confirms; H3 header order: Build & Development → Platform Support → Supporting Libraries |
| Inlines Java priority chain VERBATIM (5 slots) from `src/jdtls/java-discovery.ts:8-14` | ✓ | All 5 slots present verbatim; `grep -F` succeeds for `--java-home`, `org.gradle.java.home`, `commonJavaLocations` |
| Inlines JDT LS install chains VERBATIM (Windows 4 paths, Linux/macOS 3 paths) with `JDTLS_HOME` documented as heading each OS chain | ✓ | `grep -F` succeeds for `JDTLS_HOME`, `%LOCALAPPDATA%\jdtls`, `%ProgramFiles%\jdtls`, `%USERPROFILE%\jdtls`, `%LOCALAPPDATA%\nvim-data\mason\packages\jdtls`, `~/.local/share/jdtls`, `/usr/local/share/jdtls`, `~/jdtls` |
| Ends with D-18 footer text exactly matching `docs/WINDOWS-SUPPORT.md` | ✓ | `grep -F` succeeds for `REQUIREMENTS.md WIN-01/WIN-02/JAVA-01/JAVA-02` AND `` `src/jdtls/java-discovery.ts` (Java) and `src/jdtls/client.ts` `findJdtLs` (JDT LS) `` |
| All 8 existing sibling H3 subsections remain UNCHANGED | ✓ | `grep -cE '^### (Language & Runtime\|MCP Framework\|Schema Validation\|Jar/ZIP File Reading\|Java Language Server Integration\|Gradle Project Parsing\|Build & Development\|Supporting Libraries)$' CLAUDE.md` returns `8` |
| Full vitest suite still passes (UNIX-03 regression guard) | ✓ | `pnpm test -- run` exits 0 — `Test Files 72 passed (72), Tests 869 passed (869)` |

## Inserted Subsection Contents

The new subsection (lines 71-104 of CLAUDE.md, 34 lines) contains:

1. `### Platform Support` H3 header (3 hashes, sibling-level).
2. One-paragraph prose intro stating FabricModMCP runs on Linux, macOS, native Windows, and WSL2; the MCP server runs as a Node 22+ process; JDT LS spawns on Java 21+; the chains below are authoritative.
3. Bold-prose label `**Java Discovery Priority Chain**` plus a numbered list (1-5) verbatim from `src/jdtls/java-discovery.ts:8-14`.
4. Bold-prose label `**JDT LS Install Locations (probed in priority order)**` plus a one-sentence intro about `JDTLS_HOME` heading each OS list, followed by bold-prose labels `**Windows:**` / `**Linux / macOS:**` each with a numbered candidate list from `src/platform/index.ts:70-87`.
5. Verbatim D-18 cross-reference footer (two lines).

## Surrounding-Subsection Preservation

The 8 existing sibling H3 subsections of `## Technology Stack` are unchanged:

- `### Language & Runtime` (line 23)
- `### MCP Framework` (line 28)
- `### Schema Validation` (line 32)
- `### Jar/ZIP File Reading` (line 36)
- `### Java Language Server Integration` (line 47)
- `### Gradle Project Parsing` (line 53)
- `### Build & Development` (line 64)
- `### Supporting Libraries` (line 105 — shifted from line 71 by the +34-line insertion, but content byte-identical)

Header-count regression check returns exactly 8, matching the pre-edit count.

## Cross-Surface Consistency with docs/WINDOWS-SUPPORT.md

The verbatim quotes match `docs/WINDOWS-SUPPORT.md` (Plan 01's output):

- Java chain text matches `docs/WINDOWS-SUPPORT.md:18-25` byte-for-byte (5 slots, same indentation, same backticks around code fragments).
- JDT LS Windows chain matches `docs/WINDOWS-SUPPORT.md:37-40` (4 paths in source order).
- JDT LS Linux/macOS chain matches `docs/WINDOWS-SUPPORT.md:50-52` (3 paths in source order).
- D-18 footer text matches `docs/WINDOWS-SUPPORT.md:80-81` exactly (two lines, identical wording).

The two surfaces will stay consistent because both quote the same source-of-truth files (`src/jdtls/java-discovery.ts:8-14` and `src/platform/index.ts:70-87`). Any future refactor that changes the chain must update those source files first, and the D-18 footer points readers back to the implementation.

## Deviations from Plan

None — plan executed exactly as written. Specifically:

- No `####` sub-subsection headers were added (used bold-prose intro lines `**Java Discovery Priority Chain**`, `**JDT LS Install Locations ...**`, `**Windows:**`, `**Linux / macOS:**` per 39-PATTERNS.md recommendation).
- No content was removed from CLAUDE.md.
- No surrounding subsections were modified.
- No additional commits required.

## Verification Commands Run

```
grep -nE '^### Platform Support$' CLAUDE.md
# 71:### Platform Support

awk '/^## Technology Stack$/,/^## Alternatives Considered$/' CLAUDE.md | grep -qE '^### Platform Support$'
# Exit 0 (INSIDE_TECH_STACK_OK)

grep -F -- --java-home CLAUDE.md      # OK
grep -F org.gradle.java.home CLAUDE.md  # OK
grep -F commonJavaLocations CLAUDE.md   # OK
grep -F JDTLS_HOME CLAUDE.md            # OK
grep -F '%LOCALAPPDATA%\jdtls' CLAUDE.md     # OK
grep -F '%LOCALAPPDATA%\nvim-data\mason\packages\jdtls' CLAUDE.md  # OK
grep -F '%ProgramFiles%\jdtls' CLAUDE.md     # OK
grep -F '%USERPROFILE%\jdtls' CLAUDE.md      # OK
grep -F '~/.local/share/jdtls' CLAUDE.md     # OK
grep -F '/usr/local/share/jdtls' CLAUDE.md   # OK
grep -F '~/jdtls' CLAUDE.md                  # OK
grep -F 'REQUIREMENTS.md WIN-01/WIN-02/JAVA-01/JAVA-02' CLAUDE.md  # OK
grep -F '`src/jdtls/java-discovery.ts` (Java) and `src/jdtls/client.ts` `findJdtLs` (JDT LS)' CLAUDE.md  # OK

grep -cE '^### (Language & Runtime|MCP Framework|Schema Validation|Jar/ZIP File Reading|Java Language Server Integration|Gradle Project Parsing|Build & Development|Supporting Libraries)$' CLAUDE.md
# 8 (sibling regression check OK)

pnpm test -- run
# Test Files  72 passed (72)
# Tests       869 passed (869)
```

All gates green.

## Commits

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Insert ### Platform Support subsection into CLAUDE.md ## Technology Stack | e1f0245 | CLAUDE.md |

## Self-Check: PASSED

- CLAUDE.md exists and contains `### Platform Support` at line 71: FOUND
- Commit `e1f0245` exists in git log: FOUND
- All 16 grep gates pass; sibling H3 count = 8; vitest suite green (869/869)
