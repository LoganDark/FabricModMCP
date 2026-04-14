# Feature Landscape

**Domain:** Symbol resolution and structured member inspection for Minecraft mod development MCP server
**Researched:** 2026-04-14

## Table Stakes

Features the user explicitly requires or that are expected for methods/fields to be "first-class citizens."

| Feature | Why Expected | Complexity | Dependencies | Notes |
|---------|--------------|------------|--------------|-------|
| search_symbols returns methods | The tool description already claims it finds "methods, fields, classes, constructors" but currently only returns types. Broken promise. | Low | JDT LS `java.symbols.includeSourceMethodDeclarations` setting | Add setting to initializationOptions in `client.ts`. One-line config change plus test updates. |
| search_symbols results include container class | When methods are returned, users need to know which class they belong to. JDT LS already provides `containerName` on SymbolInformation. | Low | Enabled method declarations | Already in the LSP response; just needs to be included in the transformed output (currently captured but not surfaced well). |
| FQN scheme for methods: `Class;method()` | Unambiguous identification of methods, needed for future Mixin target specs and for passing method references between tools. | Medium | None (convention definition) | Must handle overloads. The semicolon separator avoids collision with Java's dot notation. Parentheses distinguish methods from fields. |
| FQN scheme for fields: `Class;field:` | Same rationale as methods. Colon suffix distinguishes fields from methods. | Low | None (convention definition) | Simpler than methods -- no overload disambiguation needed. |
| Structured method representation with typed parameters | `list_members` currently returns `detail: string` (raw signature text from JDT LS). Methods need structured `parameters: [{name, type: ClassReference}]` and `returnType: ClassReference`. | High | ClassReference type (exists), JDT LS documentSymbol response parsing | This is the core complexity. JDT LS `detail` field contains the signature as a string; parsing it into structured types requires understanding Java signature syntax. |
| Structured field representation with typed value | Fields need `type: ClassReference` extracted from `detail`. | Medium | ClassReference type (exists) | Simpler than methods -- just one type to extract, not a parameter list. |
| Method/field inspection via get_symbol_info | Currently works -- cascading regex can target any symbol position, and hover returns type info. | Low (already works) | None | Already functional. The "parity" gap is discoverability, not capability. |
| Method/field inspection via find_definition | Same -- already works when you can provide patterns. | Low (already works) | None | Already functional for methods/fields. |
| Method/field inspection via find_references | Same pattern. | Low (already works) | None | Already functional. |

## Differentiators

Features that go beyond table stakes and provide real workflow improvement.

| Feature | Value Proposition | Complexity | Dependencies | Notes |
|---------|-------------------|------------|--------------|-------|
| FQN-based member navigation (accept FQN instead of class+patterns) | Instead of `class: "MinecraftClient", patterns: ["void tick\\(", "tick"]`, accept `MinecraftClient;tick()` and auto-resolve the position. Massive UX improvement -- search_symbols returns FQNs, user passes them directly to inspection tools. | High | FQN scheme, member position resolution | This is the key differentiator for "inspection parity." Without it, the workflow is: search -> get result -> manually construct class+patterns. With it: search -> pass FQN -> done. |
| Overload disambiguation in FQN scheme | `Class;method(int,String)` to distinguish overloaded methods. Matches Mixin target descriptor conventions. | Medium | FQN scheme | Important for Minecraft where overloads are common. Start with simple type names; full JVM descriptors later. |
| ClassReference enrichment with jar provenance | ClassReferences in method params/return types could include which jar contains the type's source. | Low | ClassReference type | Useful for navigation: "this method returns a `BlockState` -- where is that defined?" |
| search_symbols with FQN in results | Return member FQN (`MinecraftClient;tick()`) directly in search results so Claude can immediately pass it to other tools. | Low | FQN scheme | Transforms search from "informational" to "actionable." |
| Member search across specific jars | search_symbols currently searches the entire JDT LS workspace. Filtering by jar scope would reduce noise. | Medium | JDT LS workspace/symbol limitations | JDT LS workspace/symbol has no built-in jar filtering. Would need post-filtering by URI mapping. |

## Anti-Features

Features to explicitly NOT build in this milestone.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Mixin target validation | Conflates symbol resolution with Mixin-specific semantics. v2 concern. | Build the FQN scheme cleanly so Mixin tooling can consume it later. |
| Automatic Mixin descriptor generation | Generating `Lnet/minecraft/client/MinecraftClient;tick()V` JVM descriptors from FQNs. Useful but scope creep. | FQN scheme should be designed to be convertible to JVM descriptors, but don't build the converter yet. |
| Field value inspection (runtime values) | This is a read-only source analysis server, not a debugger. | get_symbol_info already provides type information from hover. |
| Full Java signature parsing library | Building a complete Java type signature parser (generics, wildcards, arrays, etc.) is a rabbit hole. | Parse what JDT LS gives us pragmatically. Handle common cases (simple types, parameterized types, arrays). Fall back to raw string for exotic signatures. |
| Workspace-wide field search | JDT LS `includeSourceMethodDeclarations` only adds methods, NOT fields, to workspace/symbol results. There is no `includeSourceFieldDeclarations` setting in JDT LS. Building custom field indexing is out of scope. | Fields are discoverable via `list_members` on a known class. Document this limitation clearly in the search_symbols tool description. |
| Changing existing tool required params | Adding new tools or optional params is fine. Changing required params on existing tools breaks Claude's learned patterns. | Add new optional parameters (e.g., `member` FQN param) alongside existing `class`+`patterns` params. |

## Feature Dependencies

```
Enable includeSourceMethodDeclarations ──> search_symbols returns methods
                                              │
Define FQN scheme ──────────────────────────> FQN in search results
                                              │
Structured member types ─────────────────> ClassReference for params/returns
    │                                         │
    └── Signature string parsing              │
                                              v
                                    FQN-based member navigation (differentiator)
                                              │
                                              v
                                    Inspection parity complete
```

Key ordering:
1. FQN scheme definition (convention) -- no code dependency, but everything else references it
2. `includeSourceMethodDeclarations` setting -- trivial, unblocks method search
3. Structured member types with ClassReference -- the hard part, needed for rich results
4. FQN in search/list_members results -- wiring, depends on 1+3
5. FQN-based navigation (optional differentiator) -- depends on 1+2+3+4

## Critical Limitation: Fields NOT Searchable via workspace/symbol

JDT LS provides exactly two `java.symbols.*` settings:
- `includeSourceMethodDeclarations` (enables methods in workspace/symbol)
- `includeGeneratedCode` (enables Lombok-generated symbols in documentSymbol)

There is **no** `includeSourceFieldDeclarations` setting. This is a deliberate JDT LS design choice for performance reasons -- the Java type index used by workspace/symbol does not index fields.

**Impact on the milestone**: The search_symbols tool will return types + methods but NOT fields. Fields remain discoverable only through `list_members` (which uses documentSymbol on a specific class). This is an inherent JDT LS limitation, not something we can fix.

**Mitigation**: Update the search_symbols tool description to accurately state what it can find. Consider adding a note to search results when kind="field" is requested, explaining fields must be found via list_members.

## MVP Recommendation

Prioritize:
1. **FQN scheme definition** -- Convention only, zero code. Must be decided first because it appears in every other feature's output format. Design it to be forward-compatible with JVM descriptors (for future Mixin support).
2. **Enable `includeSourceMethodDeclarations`** -- One setting addition to `client.ts` initializationOptions. Instantly fixes the "search_symbols only returns types" issue. Test that methods appear in results.
3. **Structured member types** -- Extend or replace `TransformedSymbol` with new `StructuredMethod`/`StructuredField` types using `ClassReference` for parameter types and return types. Parse JDT LS `detail` strings. This is where most engineering effort goes.
4. **FQN in tool outputs** -- Wire the FQN scheme into search_symbols results and list_members results. Makes search results actionable.

Defer:
- **FQN-based member navigation** (accept member FQN in inspection tools): High value but high complexity. Can be a follow-up within v1.2 or deferred to v1.3. Table-stakes features are useful without it -- Claude can still use class+patterns for inspection.
- **Overload disambiguation with parameter types**: Start with simple `Class;method()` and add parameter-based disambiguation only when overloads are actually encountered.

## Complexity Budget

| Feature | Estimated Effort | Risk |
|---------|-----------------|------|
| FQN scheme definition | Hours | Low -- convention, not code |
| Enable method declarations setting | Hours | Low -- config change |
| Signature string parsing | Days | Medium -- JDT LS detail format varies |
| Structured member types | Days | Medium -- type design + parsing |
| FQN wiring in outputs | Hours | Low -- mechanical |
| FQN-based navigation (differentiator) | Days | High -- new resolution path |

## Key Design Decisions to Make

1. **FQN separator**: The milestone context specifies `;` (e.g., `SomeClass;method()`). This avoids ambiguity with Java's `.` and `$`. Full examples: `net.minecraft.client.MinecraftClient;tick()`, `net.minecraft.client.MinecraftClient;worldRenderer:`.

2. **Overload handling**: Start with `Class;method()` (no params in parens). If the method name is unambiguous within the class, this suffices. For overloads, extend to `Class;method(BlockPos,BlockState)` using simple type names. Full JVM descriptors (`(Lnet/minecraft/util/math/BlockPos;)V`) are a Mixin concern for later.

3. **ClassReference for primitives**: `int`, `void`, `boolean` are not classes. For primitives: `{name: "int", fqn: "int", kind: "primitive"}`. For arrays: `{name: "int[]", fqn: "int[]", kind: "array"}`.

4. **Generics in ClassReference**: `List<String>` -- start simple with raw type only (`{name: "List", fqn: "java.util.List", kind: "class"}`). Add `typeArguments` if JDT LS detail parsing makes it tractable.

5. **Where structured types live**: Create separate types (`StructuredMethod`, `StructuredField`) rather than extending `TransformedSymbol`. The current `TransformedSymbol` is generic LSP output; structured types are domain-specific enrichment.

## Sources

- [nvim-jdtls Discussion #676 - Workspace symbols beyond class](https://github.com/mfussenegger/nvim-jdtls/discussions/676) -- Confirms `java.symbols.includeSourceMethodDeclarations` enables methods in workspace/symbol. No equivalent for fields. MEDIUM confidence.
- [Eclipse JDT LS Preferences.java](https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/main/org.eclipse.jdt.ls.core/src/org/eclipse/jdt/ls/core/internal/preferences/Preferences.java) -- Only two `java.symbols.*` settings exist: `includeSourceMethodDeclarations` and `includeGeneratedCode`. No field equivalent. HIGH confidence.
- [LSP Specification 3.17 - workspace/symbol](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/) -- SymbolInformation includes `containerName` field. HIGH confidence.
- [Fabric Wiki - @Inject](https://wiki.fabricmc.net/tutorial:mixin_injects) -- Mixin method target format uses JVM descriptors: `Lpackage/Class;method(params)returnType`. HIGH confidence.
- [SpongePowered Mixin - Obfuscation](https://github.com/SpongePowered/Mixin/wiki/Introduction-to-Mixins---Obfuscation-and-Mixins) -- Mixin descriptor conventions for method/field targeting. HIGH confidence.
