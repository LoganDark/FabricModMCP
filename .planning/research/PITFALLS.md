# Domain Pitfalls

**Domain:** Adding method/field search and structured member types to existing JDT LS-based MCP tool server
**Researched:** 2026-04-14
**Confidence:** HIGH (pitfalls verified against codebase implementation and JDT LS source/issues)

## Critical Pitfalls

Mistakes that cause rewrites or major issues.

### Pitfall 1: `includeSourceMethodDeclarations` Does Not Include Fields

**What goes wrong:** Enabling `java.symbols.includeSourceMethodDeclarations` in JDT LS initializationOptions adds method declarations to `workspace/symbol` results, but fields and constants are NOT included. The setting name says "method declarations" and that is exactly what it does -- methods only. Code that assumes "enable this setting and we get all symbol types" will silently return zero results for field searches via `workspace/symbol`.

**Why it happens:** The JDT LS `WorkspaceSymbolHandler` uses Eclipse JDT's Java search engine with `IJavaSearchConstants.METHOD` when this flag is on, not `IJavaSearchConstants.FIELD`. Field search in `workspace/symbol` is simply not implemented.

**Consequences:** The `search_symbols` tool with `kind: 'field'` filter would return empty results even when the setting is enabled, making field search appear broken. Users would lose trust in the tool.

**Prevention:** Do NOT rely on `workspace/symbol` for field search. Use `textDocument/documentSymbol` (already working in `list_members`) to find fields within a known class. For cross-workspace field search, implement a two-step approach: (1) `workspace/symbol` to find types, (2) `textDocument/documentSymbol` on candidate classes to find fields. Alternatively, use the existing `search_classes` + `list_members` pipeline. Document this limitation clearly in tool descriptions.

**Detection:** Test field search against real JDT LS (not mocks) early. If `search_symbols` with `kind: 'field'` returns zero results on a Minecraft sources workspace, this pitfall has bitten.

**Confidence:** HIGH -- verified from JDT LS Preferences.java source and nvim-jdtls community discussion.

### Pitfall 2: Result Count Explosion After Enabling Method Declarations

**What goes wrong:** With `includeSourceMethodDeclarations: false` (current default), `workspace/symbol` for a broad query like `'*'` or `'get'` returns only type-level symbols (~6,600 classes in Minecraft). With it enabled, the same query now returns types PLUS every method matching the pattern across all source files. Minecraft has thousands of classes with many methods each -- a query like `get` could match tens of thousands of methods.

**Why it happens:** The probe-based readiness detection in `waitForWorkspaceSync` queries `workspace/symbol` with `{ query: '*' }` and checks for an array response. With methods included, this probe query returns a massively larger result set, wasting memory and CPU on every workspace sync operation. Regular search queries also balloon.

**Consequences:** (1) Memory pressure from enormous result arrays. (2) Slower `workspace/symbol` responses (~10s reported in JDT LS issue #2075 for large workspaces with classFileContentsSupport). (3) The pagination in `search_symbols` does client-side slicing of the full result array (line 89 of search-symbols.ts), meaning JDT LS still sends ALL results and the server holds them all in memory before slicing. (4) Workspace sync probes become expensive.

**Prevention:**
- Change the readiness probe query from `'*'` to a narrow probe like `'__mcpProbe__'` (something unlikely to match anything) -- the point is testing responsiveness, not results.
- Consider whether `workspace/symbol` queries need server-side result limits. JDT LS does not support server-side pagination for `workspace/symbol` (no `partialResults` in current protocol usage). Client-side pagination after receiving all results is the only option.
- Use specific, narrow queries. Educate tool descriptions that broad queries are expensive.
- Monitor memory: track result array sizes in debug logging.

**Detection:** After enabling the setting, run `workspace/symbol` with `{ query: 'get' }` and measure response time and result count. If response > 3s or results > 5,000, mitigation is needed.

**Confidence:** HIGH -- JDT LS issue #2075 documents this exact performance problem. The current `waitForWorkspaceSync` probe using `'*'` is directly in `workspace-sync.ts:85`.

### Pitfall 3: Parsing Hover Markdown for Structured Types Is Fragile

**What goes wrong:** JDT LS `textDocument/hover` returns markdown strings, not structured type data. To build `ClassReference` types for method parameters and return types, you must parse markdown like:

```
public void tick(MinecraftClient client, List<Entity> entities)
```

Parsing this with regex to extract `MinecraftClient` as a `ClassReference` with FQN `net.minecraft.client.MinecraftClient` is fragile because: (1) generics create nested angle brackets (`Map<String, List<Integer>>`), (2) array types (`int[]`, `Entity[]`), (3) varargs (`String...`), (4) annotations on parameters (`@Nullable Entity`), (5) type bounds (`<T extends Comparable<T>>`), (6) inner class references (`MinecraftClient.Options`), (7) the hover format varies by JDT LS version.

**Why it happens:** LSP hover is designed for human display, not machine parsing. There is no LSP request that returns structured parameter/return type information with FQNs. `textDocument/signatureHelp` exists but is for active typing, not inspection.

**Consequences:** Brittle regex parsing leads to incorrect ClassReferences, missed generic type parameters, or crashes on unexpected hover format. Every JDT LS update could break the parser.

**Prevention:**
- Use `textDocument/documentSymbol` to get method `detail` fields (which contain the return type) as a simpler starting point.
- For parameter types, hover on the method name gets the full signature. Parse conservatively: extract the signature from the Java code block, then use a proper tokenizer (not regex) that handles balanced angle brackets.
- Accept that some complex generic signatures will not resolve to full ClassReferences. Return the raw type string when resolution fails rather than crashing.
- Test against real Minecraft source methods with complex signatures (e.g., `RegistryKey<Registry<T>>`, `CompletableFuture<Optional<...>>`).
- Consider `textDocument/hover` on individual parameter names to get their fully-qualified types one at a time, rather than parsing the full signature.

**Detection:** Unit tests with complex generic signatures. If ClassReference extraction produces wrong FQNs or misses generics, the parser is too fragile.

**Confidence:** HIGH -- the current `get_symbol_info` tool already shows hover returns raw markdown (line 117 of `get-symbol-info.ts`). This is an inherent LSP limitation.

### Pitfall 4: Method Overloads Make Name-Only FQNs Ambiguous

**What goes wrong:** The planned FQN scheme `Class;method()` intentionally omits parameter types for simplicity. But Java methods are heavily overloaded -- Minecraft has many classes with 3-5+ overloads of the same method name (e.g., `Registry;get()` could match `get(Identifier)`, `get(RegistryKey)`, `get(int)`). When a tool takes `SomeClass;method()` as input, which overload does it refer to?

**Why it happens:** The design decision to omit signatures trades precision for usability. Full Java method signatures are verbose and error-prone to type (`(Lnet/minecraft/util/Identifier;)Lnet/minecraft/block/Block;`).

**Consequences:** (1) Ambiguous FQN references -- `SomeClass;method()` matches multiple symbols. (2) Tools that accept an FQN must decide: return all overloads? Pick one? Error? (3) If "return all" is chosen, downstream consumers must handle arrays where they expected a single result.

**Prevention:**
- Design the FQN scheme to be intentionally multi-match: `Class;method()` returns ALL overloads of that method. This is actually useful -- "show me all versions of tick()" is a common workflow.
- If disambiguation is needed, support an optional extended form like `Class;method(ParamType, ParamType)` with simple (unqualified) type names.
- `list_members` already returns all methods with their `detail` field showing return types. The workflow is: search broadly with FQN, refine by inspecting the list.
- Document clearly that `Class;method()` is a "family" reference, not a unique identifier.

**Detection:** Test FQN resolution against a class with known overloads (e.g., any Minecraft class with multiple `register()` or `create()` methods). If the system errors instead of returning all overloads, the design is wrong.

**Confidence:** HIGH -- Minecraft codebase is heavily overloaded. This is guaranteed to arise.

## Moderate Pitfalls

### Pitfall 5: `workspace/symbol` Name Format Changes Between Types and Methods

**What goes wrong:** For type symbols, JDT LS `workspace/symbol` returns `name: "MinecraftClient"` with `containerName: "net.minecraft.client"`. For method symbols (when enabled), it returns `name: "tick"` with `containerName: "MinecraftClient"`. The `containerName` semantics differ: for types it is the package, for methods it is the declaring class name (not FQN). The current `search_symbols` tool passes `containerName` through as-is (line 99), which means the same field means different things depending on symbol kind.

**Prevention:** Transform the results to normalize `containerName`. For method/field results, resolve the declaring class FQN by combining `containerName` with the file URI path. Or add a `declaringClass` field to method/field results that always contains the FQN, separate from `containerName`.

**Detection:** Compare `containerName` values for class vs method results in the same `search_symbols` response.

**Confidence:** MEDIUM -- based on workspace/symbol LSP spec behavior; needs verification with real JDT LS output.

### Pitfall 6: Test Mocks Hide Real JDT LS Behavior

**What goes wrong:** All current `search_symbols` tests use `mockEndpointSend` that returns `SAMPLE_SYMBOLS` -- a hand-crafted array. The tests verify pagination, filtering, and error handling, but NOT the actual shape of JDT LS responses. When `includeSourceMethodDeclarations` is enabled, the real response format might differ in subtle ways (e.g., method `name` might include parentheses, `containerName` might be structured differently, `tags` array might have different values).

**Why it happens:** Integration tests against a real JDT LS require Java 21+, a running JDT LS process, and extracted workspace files -- heavy setup that was deferred.

**Consequences:** Tests pass but production breaks. The existing tests would not have caught the `containerName` semantic difference (Pitfall 5) or the field-search gap (Pitfall 1).

**Prevention:**
- Capture real JDT LS responses for Minecraft workspace symbols (types AND methods) and use those as test fixtures. Run JDT LS once, save the raw JSON, use it in tests.
- Add at least one integration test that spins up real JDT LS and verifies the response shape.
- Snapshot the response format so that JDT LS upgrades that change it are caught.

**Detection:** If a test fixture's `name`, `kind`, `containerName`, or `location` fields don't match what real JDT LS returns, integration will fail.

**Confidence:** HIGH -- the test file at `tests/tools/search-symbols.test.ts` clearly shows all mocked fixtures.

### Pitfall 7: ClassReference Resolution Requires FQN but Hover Only Gives Simple Names

**What goes wrong:** To build a `ClassReference` with `{ name: "Entity", fqn: "net.minecraft.entity.Entity", kind: "class" }`, you need the FQN. But hover markdown only shows simple names in method signatures (e.g., `void tick(Entity entity)`). Resolving `Entity` to its FQN requires either: (1) parsing imports from the source file, (2) hovering on the parameter itself to get the FQN, or (3) using `textDocument/definition` on the type reference.

**Why it happens:** Java source files use simple names after import statements. The hover display mirrors source-level conventions.

**Prevention:**
- Use `textDocument/hover` on the type name within the source (not the method signature) to get the fully-qualified type.
- Alternatively, scan the imports at the top of the source file to build a simple-name-to-FQN map. This handles most cases but misses star imports (`import net.minecraft.entity.*`).
- For types in the same package, no import exists -- fall back to `textDocument/definition` on the type reference.
- Accept that FQN resolution is a best-effort operation. Return `fqn: null` when resolution fails rather than guessing.

**Detection:** If ClassReferences have `fqn: null` for common Minecraft types that should be resolvable, the resolution strategy needs improvement.

**Confidence:** MEDIUM -- this is an inherent LSP limitation but the specific behavior needs verification with real hover output.

### Pitfall 8: Changing `initializationOptions` Requires JDT LS Restart

**What goes wrong:** The `includeSourceMethodDeclarations` setting is sent during `initialize` (see `client.ts:220`). Changing it after startup requires either: (1) a `workspace/didChangeConfiguration` notification (which JDT LS may or may not honor for this specific setting), or (2) a full JDT LS restart. If the setting is added to `initializationOptions.settings.java.symbols` and JDT LS does not pick it up at runtime, methods will not appear.

**Why it happens:** LSP settings can be static (initialize-time only) or dynamic (changeable at runtime). Not all JDT LS settings support dynamic change.

**Consequences:** If the setting does not take effect, methods silently do not appear in workspace/symbol results, and debugging why is non-obvious.

**Prevention:** Set `includeSourceMethodDeclarations: true` in the `initializationOptions.settings` block during `startJdtLs()` in `client.ts`. This is the safest approach -- it takes effect before any queries. Verify by querying `workspace/symbol` with a known method name immediately after initialization and checking the response includes method-kind results.

**Detection:** After adding the setting, call `workspace/symbol` with `{ query: 'main' }` or a known method name. If no method-kind results appear, the setting is not taking effect.

**Confidence:** HIGH -- the initialization path is clearly in `client.ts:200-232`.

### Pitfall 9: Extending ClassReference Without Breaking Existing Consumers

**What goes wrong:** The existing `ClassReference` type in `browsing/types.ts` has `{ name, fqn, kind }`. Adding method/field member types may require extending this or creating parallel types. If the same `ClassReference` type is reused for member types with additional fields (e.g., `returnType`, `parameters`), existing code that only expects `name/fqn/kind` may break or silently ignore new fields.

**Prevention:**
- Create new types for members (`MethodReference`, `FieldReference`) rather than overloading `ClassReference`.
- Keep `ClassReference` for what it is: a reference to a class/interface/enum. Use it AS a field within the new member types (e.g., `MethodReference.returnType: ClassReference`).
- Ensure new types are additive, not breaking. The `type-hierarchy.ts` tool and `list-classes.ts` tool already use `ClassReference` -- they must continue working unchanged.

**Detection:** Run existing tests after type changes. If any test that uses `ClassReference` fails, the extension was breaking.

**Confidence:** HIGH -- `ClassReference` is used in type-hierarchy and list-classes outputs.

## Minor Pitfalls

### Pitfall 10: Off-by-One Errors in Position Conversion

**What goes wrong:** LSP uses 0-based line/column positions. The codebase already converts to 1-based (seen in `list-members.ts:17-28` and `search-symbols.ts:103-104`). Adding new code paths for method/field inspection risks introducing inconsistent conversions -- some paths 1-based, some 0-based.

**Prevention:** Centralize position conversion in a single utility function. The `transformSymbol` function in `list-members.ts` already does this. Reuse it or extract it to a shared module rather than reimplementing.

**Detection:** If tool output shows line 0 or line numbers that are 1 off from the source, a conversion is wrong.

**Confidence:** HIGH -- defensive concern based on existing pattern.

### Pitfall 11: Inner Class Methods in FQN Scheme

**What goes wrong:** Inner classes use `$` separator in the codebase (e.g., `MinecraftClient$Options`). The FQN scheme `Class;method()` needs to handle `MinecraftClient$Options;getVideoMode()`. But `$` is special in many contexts (regex, string templates). Also, the `;` separator in the FQN could conflict with Java's internal descriptor format where `;` terminates type references.

**Prevention:** Define the FQN scheme precisely and document it. Use `$` for inner classes (matching existing convention), `;` for member separator, `()` suffix for methods, `:` suffix for fields. Validate FQN parsing with inner class test cases.

**Detection:** Test FQN parsing with `OuterClass$InnerClass;method()` and `OuterClass$InnerClass;field:`.

**Confidence:** HIGH -- the codebase already uses `$` for inner classes throughout.

### Pitfall 12: Synthetic and Bridge Methods in Results

**What goes wrong:** JDT LS may return synthetic methods (compiler-generated bridge methods for generics, lambda accessors, enum `values()`/`valueOf()`) in workspace/symbol and documentSymbol results. These are implementation details that clutter search results and confuse users.

**Prevention:** Filter out methods with synthetic/bridge flags if JDT LS exposes them. At minimum, deprioritize them in results. Check the `tags` array -- JDT LS uses LSP SymbolTag.Deprecated (1) but may not have a synthetic tag. May need to filter by name pattern (e.g., `access$`, `lambda$`, `$VALUES`).

**Detection:** Search for `access$` or `lambda$` in workspace/symbol results against real Minecraft workspace. If they appear, filtering is needed.

**Confidence:** MEDIUM -- depends on JDT LS behavior with source files (synthetics are more common in .class files, less likely in decompiled sources).

### Pitfall 13: `endpoint.send` vs `client` Method Inconsistency

**What goes wrong:** The current codebase uses two different patterns to talk to JDT LS: `endpoint.send('workspace/symbol', ...)` in `search-symbols.ts` and `client.documentSymbol(...)` / `client.hover(...)` in other tools. The `endpoint` is the raw JSON-RPC layer; `client` is the typed LspClient wrapper. New method/field tools might inconsistently mix these, making the codebase harder to maintain.

**Prevention:** Decide on one pattern per request type. Use `client` methods when `ts-lsp-client`'s `LspClient` has a typed method for the request. Use `endpoint.send` only for requests that `LspClient` does not expose. Document the convention.

**Detection:** grep for `endpoint.send` and `client.` calls across tool files. If the same LSP method is invoked both ways in different tools, consolidate.

**Confidence:** HIGH -- the inconsistency already exists between `search-symbols.ts` (endpoint) and `list-members.ts` (client).

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Enabling `includeSourceMethodDeclarations` | Result explosion (Pitfall 2), readiness probe perf | Change probe query BEFORE enabling setting. Measure response times. |
| Enabling `includeSourceMethodDeclarations` | Fields not included (Pitfall 1) | Document limitation. Implement field search via documentSymbol pipeline. |
| Enabling `includeSourceMethodDeclarations` | Setting placement (Pitfall 8) | Set in initializationOptions at startup. Verify with post-init query. |
| Structured member types / ClassReference | Hover parsing fragility (Pitfall 3) | Use tokenizer not regex. Accept partial failures. Test complex generics. |
| Structured member types / ClassReference | FQN resolution (Pitfall 7) | Import scanning + hover fallback. Allow null FQN. |
| Structured member types / ClassReference | Extending existing types (Pitfall 9) | Create new MethodReference/FieldReference types. Keep ClassReference unchanged. |
| FQN scheme for members | Overload ambiguity (Pitfall 4) | Design as "family" reference returning all overloads. |
| FQN scheme for members | Inner class handling (Pitfall 11) | Test with `$` separators. Document scheme precisely. |
| Test infrastructure | Mocked tests hide bugs (Pitfall 6) | Capture real JDT LS response fixtures. Add integration test. |
| search_symbols enhancement | containerName semantics (Pitfall 5) | Normalize or add declaringClass field for method results. |

## Sources

- [JDT LS Preferences.java - includeSourceMethodDeclarations](https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/main/org.eclipse.jdt.ls.core/src/org/eclipse/jdt/ls/core/internal/preferences/Preferences.java) -- HIGH confidence
- [JDT LS Issue #2075 - Slow dynamic workspace symbols](https://github.com/eclipse-jdtls/eclipse.jdt.ls/issues/2075) -- HIGH confidence
- [JDT LS Issue #1712 - Partial results for workspace/symbol](https://github.com/eclipse-jdtls/eclipse.jdt.ls/issues/1712) -- HIGH confidence
- [nvim-jdtls Discussion #676 - Workspace symbols other than class](https://github.com/mfussenegger/nvim-jdtls/discussions/676) -- HIGH confidence
- [LSP-jdtls Sublime settings](https://github.com/sublimelsp/LSP-jdtls/blob/main/LSP-jdtls.sublime-settings) -- MEDIUM confidence
- Codebase: `src/jdtls/client.ts` (initialization options, line 220) -- HIGH confidence
- Codebase: `src/tools/search-symbols.ts` (workspace/symbol query, client-side pagination) -- HIGH confidence
- Codebase: `src/tools/list-members.ts` (documentSymbol, transformSymbol) -- HIGH confidence
- Codebase: `src/tools/get-symbol-info.ts` (hover markdown extraction) -- HIGH confidence
- Codebase: `src/jdtls/workspace-sync.ts` (readiness probe with '*' query, line 85) -- HIGH confidence
- Codebase: `src/browsing/types.ts` (ClassReference, TransformedSymbol types) -- HIGH confidence
- Codebase: `tests/tools/search-symbols.test.ts` (mocked endpoint fixtures) -- HIGH confidence
