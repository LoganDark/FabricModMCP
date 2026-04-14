# Requirements: MinecraftDevMCP

**Defined:** 2026-04-14
**Core Value:** Claude can browse, search, and navigate decompiled Minecraft source code and dependency sources in real time, enabling accurate Mixin and mod development.

## v1.2 Requirements

Requirements for v1.2 Symbol Resolution. Each maps to roadmap phases.

### Method Search

- [ ] **SRCH-01**: search_symbols returns method results from JDT LS workspace/symbol
- [ ] **SRCH-02**: Readiness probe query changed to avoid result explosion with method declarations enabled
- [ ] **SRCH-03**: search_symbols results include member FQN (`Class;method()` format)
- [ ] **SRCH-04**: search_symbols tool description accurately documents it finds types and methods, not fields

### Structured Member Types

- [ ] **TYPE-01**: MemberReference domain type with ClassReference for parameter types and return type
- [ ] **TYPE-02**: Detail string parser converts JDT LS detail strings into structured MemberReference with graceful degradation
- [ ] **TYPE-03**: list_members output enriched with structured MemberReference types

## Future Requirements

Deferred to v1.3+. Tracked but not in current roadmap.

### Member Navigation

- **NAV-01**: Member FQN scheme (`Class;method()`, `Class;field:`) accepted as input to inspection tools
- **NAV-02**: FQN-based navigation — accept member FQN in get_symbol_info, find_references, find_definition, etc.

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Field search via workspace/symbol | JDT LS has no `includeSourceFieldDeclarations` setting — hard limitation |
| FQN-based tool input (v1.2) | Deferred to v1.3 — define the scheme now, accept as input later |
| Generics in ClassReference | Start simple; add typeArguments later if needed |
| Hover-based type parsing | Detail string parser from documentSymbol is more reliable than hover markdown |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SRCH-01 | — | Pending |
| SRCH-02 | — | Pending |
| SRCH-03 | — | Pending |
| SRCH-04 | — | Pending |
| TYPE-01 | — | Pending |
| TYPE-02 | — | Pending |
| TYPE-03 | — | Pending |

**Coverage:**
- v1.2 requirements: 7 total
- Mapped to phases: 0
- Unmapped: 7 ⚠️

---
*Requirements defined: 2026-04-14*
*Last updated: 2026-04-14 after initial definition*
