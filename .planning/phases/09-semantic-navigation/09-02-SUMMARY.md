---
phase: 09-semantic-navigation
plan: 02
subsystem: jdtls
tags: [jdt-ls, lsp, eclipse, ts-lsp-client, workspace, lifecycle]

requires:
  - phase: 09-semantic-navigation (plan 01)
    provides: "JdtLsSession type, URI mapper, context extractor"
provides:
  - "JDT LS workspace extraction (source jars to temp dir with .classpath/.project)"
  - "JDT LS client lifecycle (detect Java, find JDT LS, spawn, initialize, shutdown)"
  - "Integrated JDT LS init on project load, cleanup on unload"
  - "Extended LoadedProject with optional jdtls field"
affects: [09-semantic-navigation plan 03, find-definition, find-references]

tech-stack:
  added: [ts-lsp-client@1.1.1, glob@13.x]
  patterns: [eager-jdtls-init, graceful-degradation-on-missing-java]

key-files:
  created:
    - src/jdtls/workspace.ts
    - src/jdtls/client.ts
    - tests/jdtls/workspace.test.ts
    - tests/jdtls/client.test.ts
  modified:
    - src/jdtls/types.ts
    - src/project/types.ts
    - src/tools/load-project.ts
    - src/tools/unload-project.ts

key-decisions:
  - "ts-lsp-client for LSP communication with JDT LS (minimal, standalone)"
  - "Eager JDT LS init on project load with graceful degradation to available=false"
  - "Source extraction via SourceAdapter abstraction reusing existing jar/fs adapters"
  - "JDT LS readiness detection via language/status notification listener"

patterns-established:
  - "JDT LS per-project lifecycle: extract sources, spawn process, init LSP, shutdown on unload"
  - "Graceful JDT LS degradation: missing Java/JDT LS sets available=false with clear reason"

requirements-completed: [NAV-03]

duration: 4min
completed: 2026-04-13
---

# Phase 9 Plan 02: JDT LS Lifecycle Summary

**JDT LS workspace extraction and process lifecycle with eager init on project load and graceful degradation when Java 21 or JDT LS is unavailable**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-13T13:09:42Z
- **Completed:** 2026-04-13T13:13:53Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Workspace extraction writes all .java files from dependency jars to temp directory with .classpath/.project for Eclipse project recognition
- JDT LS client module detects Java 21+, finds JDT LS installation, spawns JVM with correct args (-Xmx1G, add-modules, etc.), initializes LSP session, and shuts down gracefully
- Project load now eagerly initializes JDT LS (or records clear failure reason), unload shuts down JDT LS and cleans temp files
- 19 new unit tests covering workspace extraction, cleanup, version parsing, Java detection, JDT LS finding

## Task Commits

Each task was committed atomically:

1. **Task 1: Workspace extraction and JDT LS client lifecycle** - `145be09` (feat)
2. **Task 2: Integrate JDT LS lifecycle into project load/unload** - `8f45612` (feat)

## Files Created/Modified
- `src/jdtls/workspace.ts` - Source jar extraction to temp dir, .classpath/.project generation
- `src/jdtls/client.ts` - JDT LS process lifecycle: detect Java, find JDT LS, spawn, init, shutdown
- `src/jdtls/types.ts` - Extended JdtLsSession with client, process, dataDir fields
- `src/project/types.ts` - Added optional jdtls field to LoadedProject
- `src/tools/load-project.ts` - Eager JDT LS init after jar registration
- `src/tools/unload-project.ts` - JDT LS shutdown and temp dir cleanup on unload
- `tests/jdtls/workspace.test.ts` - 10 tests for extraction, cleanup, classpath generation
- `tests/jdtls/client.test.ts` - 9 tests for version parsing, Java detection, JDT LS finding

## Decisions Made
- Used ts-lsp-client (1.1.1) for LSP communication — minimal standalone client, no VS Code dependency
- Eager JDT LS initialization on project load with graceful degradation (available=false + clear failureReason)
- Reused existing SourceAdapter abstraction for source extraction, avoiding duplicate jar reading logic
- JDT LS readiness detected via language/status notification with ServiceReady/Started markers
- Added glob dependency for finding equinox launcher jar in JDT LS plugins directory

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed ts-lsp-client and glob dependencies**
- **Found during:** Task 1
- **Issue:** ts-lsp-client and glob were referenced in tech stack but not yet installed
- **Fix:** Ran pnpm add ts-lsp-client glob
- **Files modified:** package.json, pnpm-lock.yaml
- **Verification:** Imports resolve, tests pass
- **Committed in:** 145be09 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Dependency installation was necessary for the modules to work. No scope creep.

## Issues Encountered
- Pre-existing TypeScript compilation errors (15 errors in tool files due to structuredContent type mismatch with MCP SDK) confirmed as pre-existing — same count before and after changes

## User Setup Required

JDT LS requires external setup (documented in plan frontmatter):
- **Java 21+**: Set JAVA_HOME or add to PATH
- **Eclipse JDT LS**: Download from https://download.eclipse.org/jdtls/milestones/ and set JDTLS_HOME

Without these, projects load successfully but jdtls.available=false with a clear reason.

## Next Phase Readiness
- JDT LS lifecycle is fully integrated — Plan 03 can build find_definition and find_references MCP tools
- URI mapper (Plan 01) + lifecycle (Plan 02) provide everything needed for LSP request/response flow

## Self-Check: PASSED

All 8 created/modified files verified on disk. Both task commits (145be09, 8f45612) verified in git log. 291 tests passing, 0 failures.

---
*Phase: 09-semantic-navigation*
*Completed: 2026-04-13*
