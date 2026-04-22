---
phase: quick-260421-qah
plan: 01
subsystem: tools
tags: [mcp, error-handling, ux]

provides:
  - "EMPTY_WORKSPACE error code for browsing tools on empty projects"
  - "Improved NO_PROJECTS_LOADED message with restart guidance"
  - "requireDependencies helper in tool-helpers.ts"
affects: [tools, browsing]

tech-stack:
  added: []
  patterns: [requireDependencies guard pattern after resolveProjectSafely]

key-files:
  created: []
  modified:
    - src/tools/tool-helpers.ts
    - src/state/project-store.ts
    - src/tools/list-packages.ts
    - src/tools/list-classes.ts
    - src/tools/search-classes.ts
    - src/tools/read-source.ts
    - src/tools/locate-in-source.ts
    - src/tools/list-members.ts
    - src/tools/read-member.ts
    - src/tools/find-definition.ts
    - src/tools/find-references.ts
    - src/tools/find-implementations.ts
    - src/tools/get-symbol-info.ts
    - src/tools/get-member-info.ts
    - src/tools/search-symbols.ts
    - src/tools/type-hierarchy.ts
    - tests/tools/list-packages.test.ts

key-decisions:
  - "Added requireDependencies as a null-returning guard (consistent with resolveProjectSafely pattern)"
  - "Also added NO_SOURCES_AVAILABLE check for edge case where children exist but no jars are available"

patterns-established:
  - "requireDependencies guard: call after resolveProjectSafely, before JDT LS checks, early-return on non-null"

requirements-completed: []

duration: 4min
completed: 2026-04-21
---

# Quick Task 260421-qah: Improve Empty Workspace Error Messages Summary

**EMPTY_WORKSPACE and NO_SOURCES_AVAILABLE error codes with actionable LLM guidance for all 14 browsing tools**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-22T01:59:17Z
- **Completed:** 2026-04-22T02:03:24Z
- **Tasks:** 3
- **Files modified:** 17

## Accomplishments
- Added requireDependencies helper that detects empty projects (no children) and projects with no available sources
- Updated NO_PROJECTS_LOADED error message to explain MCP server restart behavior and guide to create_project + add_fabric_mod/add_study_jar
- All 14 browsing tools now return EMPTY_WORKSPACE with clear guidance instead of confusing "not found" / "0 results" responses
- New test validates the EMPTY_WORKSPACE error path

## Task Commits

Each task was committed atomically:

1. **Task 1: Add empty-workspace detection helper and improve NO_PROJECTS_LOADED message** - `0d90769` (feat)
2. **Task 2: Add requireDependencies checks to all browsing tools** - `0a296f2` (feat)
3. **Task 3: Add test for empty workspace error path** - `6b6fe8c` (test)

## Files Created/Modified
- `src/tools/tool-helpers.ts` - Added requireDependencies() guard function
- `src/state/project-store.ts` - Improved NO_PROJECTS_LOADED error message and suggestions
- `src/tools/list-packages.ts` through `src/tools/type-hierarchy.ts` - Added requireDependencies check (14 files)
- `tests/tools/list-packages.test.ts` - Added EMPTY_WORKSPACE error test case

## Decisions Made
- Used null-returning guard pattern (consistent with resolveProjectSafely) rather than throwing DomainError
- Added secondary NO_SOURCES_AVAILABLE check for edge case where children exist but have no available source jars
- Included get_member_info in the check list per plan specification

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Error messages now explicitly guide LLMs to the correct recovery action
- Pattern is established for any future browsing tools to use requireDependencies

---
*Quick task: 260421-qah*
*Completed: 2026-04-21*
