# Requirements: MinecraftDevMCP

**Defined:** 2026-04-14
**Core Value:** Claude can browse, search, and navigate decompiled Minecraft source code and dependency sources in real time, enabling accurate Mixin and mod development.

## v1.3 Requirements

Requirements for v1.3 Context Management milestone. Each maps to roadmap phases.

### Source Reading

- [x] **READ-01**: read_source accepts optional startLine and lineCount to return a line range instead of full source
- [x] **READ-02**: read_source with line range requires a specific jar parameter; returns error with jar list when multiple jars match
- [x] **READ-03**: read_member accepts optional linesBefore and linesAfter to include surrounding context around the member
- [x] **READ-04**: Line-range and context-lines output includes metadata (total lines in file, returned range) so agent knows what it's seeing

### Navigation Pagination

- [x] **NAV-01**: find_references accepts limit and offset parameters with total count in response
- [x] **NAV-02**: find_implementations accepts limit and offset parameters with total count in response
- [x] **NAV-03**: find_definition accepts limit and offset parameters with total count in response
- [x] **NAV-04**: All pagination defaults to returning all results (backward compatible) when limit is omitted

### Verbosity Audit

- [x] **VERB-01**: Audit all search and navigation tool outputs with real Minecraft project data to measure response sizes
- [x] **VERB-02**: Reduce default verbosity where safe (no breaking changes to structuredContent shape)
- [x] **VERB-03**: Add compact/verbose mode controls to tools identified as worst offenders in the audit

## Future Requirements

Deferred to future milestones. Tracked but not in current roadmap.

### Navigation Input

- **NAV-05**: FQN-based input for find_references (Class#method() instead of cascading regex)
- **NAV-06**: FQN-based input for find_definition (Class#method() instead of cascading regex)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Silent truncation of results | MCP community consensus against it; agents must see totals and make informed choices |
| Separate summary tools (e.g., find_references_summary) | Each tool definition costs 550-1400 tokens; use parameters on existing tools instead |
| Token estimation / budget parameters | Heuristic (`length / 4`) is unreliable; line counts are concrete and sufficient |
| Changing default output to compact | Would silently degrade agent reasoning; verbose stays default, compact is opt-in |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| READ-01 | Phase 19 | Complete |
| READ-02 | Phase 19 | Complete |
| READ-03 | Phase 20 | Complete |
| READ-04 | Phase 19 | Complete |
| NAV-01 | Phase 21 | Complete |
| NAV-02 | Phase 21 | Complete |
| NAV-03 | Phase 21 | Complete |
| NAV-04 | Phase 21 | Complete |
| VERB-01 | Phase 22 | Complete |
| VERB-02 | Phase 22 | Complete |
| VERB-03 | Phase 22 | Complete |

**Coverage:**
- v1.3 requirements: 11 total
- Mapped to phases: 11
- Unmapped: 0

---
*Requirements defined: 2026-04-14*
*Last updated: 2026-04-14 after roadmap creation*
