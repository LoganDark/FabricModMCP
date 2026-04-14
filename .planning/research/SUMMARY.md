# Project Research Summary

**Project:** MinecraftDevMCP v1.2 — Symbol Resolution
**Domain:** Java LSP-based MCP server for Minecraft mod development
**Researched:** 2026-04-14
**Confidence:** HIGH

## Executive Summary

MinecraftDevMCP v1.2 is a targeted enhancement to an existing, working MCP server that adds method and field first-class citizenship to the symbol resolution layer. The core pattern is surgical: one JDT LS initialization setting unlock (`java.symbols.includeSourceMethodDeclarations: true`) enables method search, and the remaining work is type system enrichment and wiring. No new dependencies are required. The existing stack (TypeScript 6.0.2, MCP SDK 1.29.x, ts-lsp-client, Zod 4.x, node-stream-zip) is fully sufficient for this milestone.

The recommended approach is build-order-sensitive: define the member FQN scheme as a convention first (zero code, guides everything), then enable method declarations in JDT LS (one config line, validates that method search works before investing in parsing), then build the member-parser domain module with exhaustive unit tests, then wire structured types into tool outputs, and finally integrate FQN-based navigation into inspection tools. This ordering de-risks the highest-complexity piece (detail string parsing) by validating the foundation first.

The principal risk is the JDT LS `workspace/symbol` result explosion: enabling method declarations can return tens of thousands of symbols for broad queries, and the existing readiness probe (`waitForWorkspaceSync`) uses `'*'` which would blow up under the new setting. The probe query must be changed to a no-match sentinel before enabling the setting. The second major risk is hover/detail string parsing fragility — complex generics, varargs, and annotations will defeat naive regex. Graceful degradation (returning `kind: "unresolved"` ClassReferences) is the correct strategy; crashing on exotic signatures is not acceptable.

## Key Findings

### Recommended Stack

The v1.2 milestone requires zero new dependencies. The only external-facing change is a one-line addition to `jdtls/client.ts` initializationOptions to add `symbols.includeSourceMethodDeclarations: true`. All new type definitions (`MethodReference`, `FieldReference`, `MemberReference`, `ParameterInfo`, `ParsedMemberFqn`) are pure TypeScript interfaces added to `browsing/types.ts`. The member FQN parsing and detail string parsing logic lives in pure TypeScript modules with no I/O, making them straightforwardly testable.

**Core technologies (unchanged):**
- TypeScript 6.0.2 / Node.js 22 LTS: primary language and runtime — no change
- @modelcontextprotocol/sdk ^1.29.0: MCP server implementation — no change
- Zod ^4.3.6: will be needed for new structured output type schemas — already installed
- ts-lsp-client ^1.1.1: handles all LSP communication including the new method symbol results — no change
- Eclipse JDT LS (latest milestone): one initialization setting change unlocks method search — config only

**Key immovable constraint:** JDT LS has NO `includeSourceFieldDeclarations` setting. Fields are permanently unavailable via `workspace/symbol`. Fields are only discoverable via `textDocument/documentSymbol` (`list_members`). This is a deliberate JDT LS design decision and cannot be worked around.

### Expected Features

See `.planning/research/FEATURES.md` for full detail.

**Must have (table stakes):**
- `search_symbols` actually returns methods — tool description already claims this, currently broken
- `search_symbols` results include the owning class (`containerName`) for method results
- Member FQN scheme: `Class;method()` for methods, `Class;field:` for fields — unambiguous identifiers
- Structured method representation: `parameters: ParameterInfo[]`, `returnType: ClassReference`
- Structured field representation: `type: ClassReference`
- `list_members` output includes `memberFqn` on every method and field result

**Should have (differentiators):**
- FQN-based member navigation: pass `MinecraftClient;tick()` directly to `get_symbol_info` instead of constructing class+patterns manually — closes the "inspection parity" gap
- `search_symbols` results include the member FQN directly, making results immediately actionable (feed output of search into inspection tools without manual translation)
- Overload disambiguation via simple parameter type names when necessary: `Class;method(BlockPos,int)`

**Defer (v2+):**
- Mixin target validation (uses FQN scheme but is a separate semantic concern)
- JVM descriptor generation (`Lnet/minecraft/client/MinecraftClient;tick()V`) — design FQN scheme to be convertible but do not build the converter now
- Workspace-wide field search — JDT LS limitation means this requires custom indexing, out of scope
- Full Java signature parsing with generics, wildcards, and type bounds — pragmatic parsing with graceful degradation is sufficient

### Architecture Approach

The architecture is additive and surgical. No existing tools are replaced; they are extended. One new domain module (`browsing/member-parser.ts`) handles detail-string-to-structured-types parsing and import map extraction in isolation, keeping tool files thin. The FQN parser utility goes in `tool-helpers.ts`. All new types go in `browsing/types.ts` as a separate union (`MemberReference = MethodReference | FieldReference`) that does NOT overload the existing `ClassReference` type. `TransformedSymbol` gains optional structured fields for backward compatibility.

**Major components (new or modified):**
1. `browsing/member-parser.ts` (NEW) — parses JDT LS `detail` strings into structured `ParameterInfo`/`ClassReference` types; extracts import maps from source text
2. `browsing/types.ts` (MODIFIED) — adds `MethodReference`, `FieldReference`, `MemberReference`, `ParameterInfo`, `ParsedMemberFqn`; extends `TransformedSymbol` with optional structured fields
3. `jdtls/client.ts` (MODIFIED) — one setting addition to initializationOptions
4. `tools/search-symbols.ts` (MODIFIED) — adds `memberFqn` to method/constructor results; normalizes `containerName` semantics
5. `tools/list-members.ts` (MODIFIED) — uses member-parser to add structured types and `memberFqn` to all member output
6. `tools/get-symbol-info.ts` (MODIFIED) — accepts member FQN, auto-generates cascading regex patterns
7. `tools/tool-helpers.ts` (MODIFIED) — adds `parseMemberFqn()`, `generateMemberPatterns()`

### Critical Pitfalls

1. **Fields are not in workspace/symbol** — `includeSourceMethodDeclarations` adds methods only. `kind: 'field'` searches via `search_symbols` will return empty. Must be documented clearly; fields require `list_members` on a known class. Do not attempt to fix this by building a custom field index.

2. **Result count explosion + broken readiness probe** — enabling method declarations causes `workspace/symbol` with `'*'` to return potentially 300,000+ results. The `waitForWorkspaceSync` probe currently uses `{ query: '*' }` (confirmed in `workspace-sync.ts:85`). Change this probe to a no-match sentinel string BEFORE enabling the setting. Monitor response times; broad queries like `get` may need minimum-length enforcement.

3. **Detail string parsing fragility** — JDT LS `documentSymbol` detail strings are formatted for humans, not machines. Complex generics (`RegistryKey<Registry<T>>`), varargs (`String...`), annotations (`@Nullable`), and inner type references will break naive regex. Use a balanced-bracket tokenizer for angle brackets. Accept `kind: "unresolved"` ClassReferences rather than crashing or returning wrong FQNs.

4. **Method overloads make FQN non-unique** — `SomeClass;method()` matches ALL overloads. Design this as intentional: the FQN is a "family reference" that returns all overloads. Support an optional extended form `Class;method(ParamType)` for disambiguation when needed. Minecraft has heavily overloaded APIs (e.g., `Registry;get()`) — this will arise.

5. **containerName semantics differ by symbol kind** — For type symbols, `containerName` is the package name. For method symbols, `containerName` is the declaring class name (NOT the FQN). The existing `search_symbols` transform passes `containerName` through as-is. Normalize or add a separate `declaringClass` field for method results to avoid mixing semantics.

## Implications for Roadmap

Based on research, the natural build order is dictated by dependency chains: FQN convention before code, config before parsing, parsing before wiring, wiring before navigation.

### Phase 1: Enable Method Declarations + search_symbols Enrichment

**Rationale:** The single highest-visibility fix with the lowest risk. One config line unlocks method search. This validates that JDT LS responds as expected with methods before investing in the parsing layer. Each subsequent phase builds on knowledge gained here.
**Delivers:** `search_symbols` returns actual methods with `memberFqn` in results. The broken tool promise (tool description claims methods, returns only types) is fulfilled.
**Addresses:** Table stakes — method search, containerName in results, FQN in search output
**Avoids:** Pitfall 2 (change readiness probe before enabling setting), Pitfall 8 (set in initializationOptions at init time, not via dynamic config change), Pitfall 5 (normalize containerName semantics for method vs type results)
**Research flag:** Standard patterns. Straightforward config change and transform wiring. No phase research needed.

### Phase 2: Member Parser Domain Module

**Rationale:** Pure domain logic with no I/O dependency. Can be built and tested exhaustively before touching any tool. This is the foundation that Phase 3 and Phase 4 depend on.
**Delivers:** `browsing/member-parser.ts` with `parseDetail()` and `extractImportMap()`. New types in `browsing/types.ts`: `MethodReference`, `FieldReference`, `MemberReference`, `ParameterInfo`.
**Addresses:** Structured member representations, ClassReference enrichment with resolved FQNs from import maps
**Avoids:** Pitfall 3 (use tokenizer for balanced brackets, not regex), Pitfall 7 (import map extraction for FQN resolution from source files), Pitfall 9 (new MemberReference types, ClassReference left unchanged)
**Research flag:** Needs real JDT LS detail string samples from a live Minecraft workspace to write correct unit tests. Capture actual fixture data (methods with generics, varargs, annotations, inner class types) before writing the parser. Mock fixtures will miss edge cases that cause production failures.

### Phase 3: Enrich list_members Output

**Rationale:** Wires the member-parser (Phase 2) into the first tool output. `list_members` already reads full source files (import maps are available) and already receives DocumentSymbol detail strings. This is the natural integration point and validates the member-parser against real data.
**Delivers:** `list_members` returns `memberFqn`, `parameters: ParameterInfo[]`, `returnType: ClassReference`, `fieldType: ClassReference` on all member results. Tool output is now structured and actionable.
**Addresses:** Structured method/field representation in `list_members`; `memberFqn` in field results (the only path to field FQNs, since workspace/symbol cannot return fields)
**Avoids:** Pitfall 3 (use parser from Phase 2, not ad-hoc regex), Pitfall 10 (reuse existing position conversion utilities, do not reimplement)
**Research flag:** Standard patterns. The integration is mechanical wiring of Phase 2 output into the existing tool transform. No novel patterns required.

### Phase 4: Member FQN Navigation + Inspection Parity

**Rationale:** Closes the full workflow loop. After Phase 1, search returns FQNs. After Phase 3, `list_members` returns FQNs. This phase makes inspection tools accept those FQNs directly, eliminating the manual step of deconstructing search results to construct inspection calls.
**Delivers:** `get_symbol_info` (and optionally `find_definition`) accepts `Class;method()` as direct input, auto-generates cascading regex patterns. `tool-helpers.ts` gains `parseMemberFqn()` and `generateMemberPatterns()`. All tool descriptions updated to document the FQN scheme.
**Addresses:** FQN-based member navigation (key differentiator), inspection parity
**Avoids:** Pitfall 4 (FQN resolves to all overloads, patterns disambiguate when needed), Pitfall 11 (inner class `$` separator handling), Anti-pattern 1 from ARCHITECTURE.md (extend existing tools, do not add new parallel tools)
**Research flag:** Auto-generated regex patterns need validation against real Minecraft source for correctness before shipping. Capture test cases specifically with overloaded methods and inner classes.

### Phase Ordering Rationale

- Phase 1 before Phase 2: validate the JDT LS config change produces real method results before building the parsing infrastructure that depends on those results.
- Phase 2 before Phase 3: the member-parser is a pure domain module — test it exhaustively in isolation before wiring it into tools where bugs are harder to diagnose.
- Phase 3 before Phase 4: `list_members` FQN output validates the FQN scheme in practice before teaching inspection tools to accept FQNs as input.
- Each phase is independently shippable and delivers visible improvement. No phase creates infrastructure that is only useful in a later phase.

### Research Flags

Phases needing deeper research or real-world validation during planning:
- **Phase 2:** Capture real JDT LS detail string samples from a live Minecraft workspace before writing the parser. The ARCHITECTURE.md documents the expected format (`"(BlockPos, int) : BlockState"`) derived from reading JDT LS source, but live verification against complex Minecraft types is essential.
- **Phase 4:** Test auto-generated regex patterns against methods with overloads in actual Minecraft source before considering the implementation complete. The pattern generation logic needs real-world validation.

Phases with standard patterns (no phase research needed):
- **Phase 1:** Config change plus LSP response wiring. JDT LS behavior is well-documented and confirmed from source.
- **Phase 3:** Mechanical wiring of Phase 2 output into the existing tool transform. Follows established domain-tool separation patterns.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Zero new dependencies. All existing stack components verified against current codebase. JDT LS setting confirmed against Preferences.java source and multiple community sources. |
| Features | HIGH | Table stakes directly derived from existing tool description gaps (search_symbols claims methods but returns only types). JDT LS field limitation confirmed from source code, not just documentation. |
| Architecture | HIGH | Component modifications are precisely scoped to existing files. Build order derived from actual dependency chains. Patterns (extend vs replace, domain vs tool separation) match existing codebase conventions. |
| Pitfalls | HIGH | Critical pitfalls verified against JDT LS source, open issues, and existing codebase code paths. The readiness probe pitfall is confirmed by reading workspace-sync.ts line 85. |

**Overall confidence:** HIGH

### Gaps to Address

- **Actual JDT LS detail string format for methods:** The ARCHITECTURE.md documents the expected format (`"(BlockPos, int) : BlockState"`) derived from reading JDT LS source code. Live verification against real Minecraft source in a running JDT LS is needed before writing the Phase 2 parser.
- **containerName value for method symbols (MEDIUM confidence):** PITFALLS.md flags that `containerName` may be the simple class name rather than the FQN for method results. Verify against real output during Phase 1 implementation before writing the Phase 1 transform.
- **Performance of method declarations setting on Minecraft workspace:** JDT LS issue #2075 documents slowdowns. The Minecraft sources jar has ~6,600 classes. Actual query latency after enabling the setting must be measured during Phase 1 before declaring it complete.

## Sources

### Primary (HIGH confidence)
- [JDT LS Preferences.java](https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/main/org.eclipse.jdt.ls.core/src/org/eclipse/jdt/ls/core/internal/preferences/Preferences.java) — `includeSourceMethodDeclarations` setting definition; confirmed no field equivalent exists
- [DocumentSymbolHandler source](https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/master/org.eclipse.jdt.ls.core/src/org/eclipse/jdt/ls/core/internal/handlers/DocumentSymbolHandler.java) — detail string format for methods, fields, constructors
- [JDT LS Issue #2075](https://github.com/eclipse-jdtls/eclipse.jdt.ls/issues/2075) — workspace/symbol performance with large result sets
- [JDT LS Issue #1712](https://github.com/eclipse-jdtls/eclipse.jdt.ls/issues/1712) — partial results behavior for workspace/symbol
- [LSP 3.17 Specification](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/) — SymbolInformation type, containerName semantics
- Codebase: `src/jdtls/client.ts`, `src/tools/search-symbols.ts`, `src/tools/list-members.ts`, `src/tools/get-symbol-info.ts`, `src/jdtls/workspace-sync.ts`, `src/browsing/types.ts`, `tests/tools/search-symbols.test.ts`

### Secondary (MEDIUM confidence)
- [nvim-jdtls Discussion #676](https://github.com/mfussenegger/nvim-jdtls/discussions/676) — community confirmation of method-only scope for `includeSourceMethodDeclarations`; no field equivalent
- [LSP-jdtls Sublime settings](https://github.com/sublimelsp/LSP-jdtls/blob/main/LSP-jdtls.sublime-settings) — confirms setting path
- [Neovim Discourse: workspace symbols](https://neovim.discourse.group/t/telescope-lsp-dynamic-workspace-symbols-for-nvim-jdtls-is-not-giving-methods/5032) — additional community confirmation
- [emacs-lsp/lsp-java](https://emacs-lsp.github.io/lsp-java/) — additional JDT LS settings reference

### Tertiary (used for design rationale)
- [Fabric Wiki - @Inject](https://wiki.fabricmc.net/tutorial:mixin_injects) — Mixin descriptor conventions; informs forward-compatible FQN scheme design
- [SpongePowered Mixin - Obfuscation](https://github.com/SpongePowered/Mixin/wiki/Introduction-to-Mixins---Obfuscation-and-Mixins) — Mixin method/field targeting conventions

---
*Research completed: 2026-04-14*
*Ready for roadmap: yes*
