# Requirements: MinecraftDevMCP

**Defined:** 2026-04-14
**Core Value:** Claude can browse, search, and navigate decompiled Minecraft source code and dependency sources in real time, enabling accurate Mixin and mod development.

## v1.3 Requirements

Requirements for v1.3 Context Management milestone. Each maps to roadmap phases.

### Source Reading

- [ ] **READ-01**: read_source accepts optional startLine and lineCount to return a line range instead of full source
- [ ] **READ-02**: read_source with line range requires a specific jar parameter; returns error with jar list when multiple jars match
- [ ] **READ-03**: read_member accepts optional linesBefore and linesAfter to include surrounding context around the member
- [ ] **READ-04**: Line-range and context-lines output includes metadata (total lines in file, returned range) so agent knows what it's seeing

### Navigation Pagination

- [ ] **NAV-01**: find_references accepts limit and offset parameters with total count in response
- [ ] **NAV-02**: find_implementations accepts limit and offset parameters with total count in response
- [ ] **NAV-03**: find_definition accepts limit and offset parameters with total count in response
- [ ] **NAV-04**: All pagination defaults to returning all results (backward compatible) when limit is omitted

### Verbosity Audit

- [ ] **VERB-01**: Audit all search and navigation tool outputs with real Minecraft project data to measure response sizes
- [ ] **VERB-02**: Reduce default verbosity where safe (no breaking changes to structuredContent shape)
- [ ] **VERB-03**: Add compact/verbose mode controls to tools identified as worst offenders in the audit

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
| READ-01 | — | Pending |
| READ-02 | — | Pending |
| READ-03 | — | Pending |
| READ-04 | — | Pending |
| NAV-01 | — | Pending |
| NAV-02 | — | Pending |
| NAV-03 | — | Pending |
| NAV-04 | — | Pending |
| VERB-01 | — | Pending |
| VERB-02 | — | Pending |
| VERB-03 | — | Pending |

**Coverage:**
- v1.3 requirements: 11 total
- Mapped to phases: 0
- Unmapped: 11 ⚠️

---
*Requirements defined: 2026-04-14*
*Last updated: 2026-04-14 after initial definition*
