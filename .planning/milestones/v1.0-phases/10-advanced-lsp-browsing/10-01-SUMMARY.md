---
phase: 10-advanced-lsp-browsing
plan: 01
subsystem: api
tags: [lsp, jdtls, documentSymbol, symbolKind, mcp-tool]

requires:
  - phase: 09-semantic-navigation
    provides: JDT LS client lifecycle, URI mapper, LSP tool patterns
provides:
  - endpoint field on JdtLsSession for raw LSP calls
  - SYMBOL_KIND_NAME mapping for all Phase 10 tools
  - Enhanced JDT LS capabilities (documentSymbol, hover, implementation, typeHierarchy, workspace/symbol)
  - list_members MCP tool for tree-structured class browsing
affects: [10-advanced-lsp-browsing]

tech-stack:
  added: []
  patterns: [documentSymbol-based class member listing, SymbolKind numeric-to-string mapping]

key-files:
  created:
    - src/jdtls/symbol-kind.ts
    - src/tools/list-members.ts
    - tests/tools/list-members.test.ts
  modified:
    - src/jdtls/types.ts
    - src/jdtls/client.ts
    - src/tools/load-project.ts
    - src/tools/index.ts

key-decisions:
  - "Defensive SymbolInformation[] fallback in case JDT LS ignores hierarchicalDocumentSymbolSupport"
  - "didClose in try/finally for cleanup consistency with find_definition pattern"

patterns-established:
  - "DocumentSymbol transform: 0-based LSP positions to 1-based human-readable with recursive children"
  - "SYMBOL_KIND_NAME shared mapping reusable by all Phase 10 tools"

requirements-completed: [ALSB-01]

duration: 4min
completed: 2026-04-13
---

# Phase 10 Plan 01: JDT LS Infrastructure + list_members Summary

**JDT LS endpoint storage, Phase 10 capabilities declaration, SymbolKind mapping, and list_members tool for tree-structured class member browsing**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-13T14:34:56Z
- **Completed:** 2026-04-13T14:39:30Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Added endpoint field to JdtLsSession for raw LSP calls needed by Phase 10 tools (type_hierarchy, find_implementations, search_symbols)
- Declared all Phase 10 LSP capabilities in JDT LS initialize (documentSymbol, hover, implementation, typeHierarchy, workspace/symbol)
- Created SYMBOL_KIND_NAME mapping (26 LSP SymbolKind values) shared by all Phase 10 tools
- Implemented list_members tool with hierarchical DocumentSymbol tree transformation, 1-based ranges, deprecated flag, and defensive SymbolInformation fallback

## Task Commits

Each task was committed atomically:

1. **Task 1: JDT LS infrastructure** - `8987928` (feat)
2. **Task 2: list_members tool (TDD RED)** - `e792d82` (test)
3. **Task 2: list_members tool (TDD GREEN)** - `755fa84` (feat)

## Files Created/Modified
- `src/jdtls/types.ts` - Added JSONRPCEndpoint import and endpoint field to JdtLsSession
- `src/jdtls/client.ts` - Enhanced capabilities for Phase 10 LSP features
- `src/jdtls/symbol-kind.ts` - LSP SymbolKind numeric-to-string mapping (26 entries)
- `src/tools/load-project.ts` - Stores endpoint on project.jdtls during load
- `src/tools/list-members.ts` - list_members MCP tool implementation
- `src/tools/index.ts` - Registered list_members tool
- `tests/tools/list-members.test.ts` - 5 test cases for list_members

## Decisions Made
- Defensive SymbolInformation[] fallback: if JDT LS returns flat SymbolInformation instead of hierarchical DocumentSymbol, map to flat members with no children
- didClose in try/finally: consistent with find_definition cleanup pattern

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Endpoint field and capabilities ready for get_symbol_info, type_hierarchy, find_implementations, search_symbols tools
- SYMBOL_KIND_NAME mapping available for reuse in search_symbols and type_hierarchy
- list_members tool tested and registered

---
*Phase: 10-advanced-lsp-browsing*
*Completed: 2026-04-13*
