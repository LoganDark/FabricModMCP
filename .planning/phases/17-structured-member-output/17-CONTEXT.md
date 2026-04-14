# Phase 17: Structured Member Output - Context

**Gathered:** 2026-04-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire Phase 16's domain types (TypeReference, MemberReference, parseDetail, import resolver) into `list_members` and `search_symbols` tool output. Add memberFqn to both tools. list_members gets full structured type information; search_symbols gets memberFqn only.

</domain>

<decisions>
## Implementation Decisions

### Member FQN scheme
- Format: `{classFqn}#{memberName}()` for methods/constructors, `{classFqn}#{memberName}:` for fields
- Hash `#` separator between class FQN and member name
- Class portion is always the full FQN (e.g., `net.minecraft.client.MinecraftClient#tick()`)
- No parameter types in parens — just `()` for all methods/constructors (overloads are indistinguishable by FQN alone)
- Constructors use the class simple name: `net.minecraft.client.MinecraftClient#MinecraftClient()`
- Fields use trailing colon: `net.minecraft.client.MinecraftClient#instance:`
- FQN applies to methods, constructors, fields, constants, and enum members only — classes/interfaces/enums/packages do not get memberFqn
- Constants and enum members treated as fields (colon suffix)
- `buildMemberFqn(classFqn, memberName, memberKind)` as a pure domain function, not inline in tools

### FQN source
- list_members: derive class FQN from the entry path (e.g., `net/minecraft/client/MinecraftClient.java` -> `net.minecraft.client.MinecraftClient`) via EntryIndex lookup
- search_symbols: use `containerName` from JDT LS workspace/symbol results directly

### Structured type output shape — list_members
- Inline flat fields: methods get `parameters: ParameterInfo[]` and `returnType: TypeReference | null`, fields get `fieldType: TypeReference`
- Keep existing `detail` string for backward compatibility
- Add `memberFqn` field

### Enriched symbol types — discriminated union
- `EnrichedMethodSymbol extends TransformedSymbol` — has `memberFqn: string`, `parameters: ParameterInfo[]`, `returnType: TypeReference | null`
- `EnrichedFieldSymbol extends TransformedSymbol` — has `memberFqn: string`, `fieldType: TypeReference`
- `EnrichedClassSymbol extends TransformedSymbol` — has `children: EnrichedSymbol[]`
- `EnrichedSymbol = EnrichedMethodSymbol | EnrichedFieldSymbol | EnrichedClassSymbol`
- No nullable fields — each variant has exactly what it needs, discriminated by `kind`
- Children are recursive: nested members also get enriched types and FQNs

### search_symbols output
- Add `memberFqn` field only (no structured types — workspace/symbol has no detail string)
- memberFqn is null for non-method/field results (classes, interfaces, etc.)

### resolvePackage wiring
- `createResolvePackage(entryIndex: EntryIndex)` added to `src/browsing/import-resolver.ts`
- Searches all loaded jars (Minecraft, Fabric API, dependencies, study jars) via EntryIndex
- Returns simple class names for a given package
- EntryIndex already indexes all loaded jars per project

### Claude's Discretion
- How to efficiently parse detail strings for all members in a class (batching, caching resolvers)
- Whether to create an enrichment helper function or inline the transformation
- Error handling when parseDetail returns null (symbol kinds without detail strings)
- Test fixture design for integration tests

</decisions>

<specifics>
## Specific Ideas

No specific requirements beyond what's captured in decisions above.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — SRCH-03 (member FQN in search_symbols), TYPE-03 (structured member output in list_members)
- `.planning/REQUIREMENTS.md` "Out of Scope" table — FQN-based tool input deferred to v1.3

### Phase 16 artifacts (foundation)
- `src/browsing/member-types.ts` — TypeReference union (6 variants), MemberReference, ParameterInfo
- `src/browsing/detail-parser.ts` — parseDetail() function
- `src/browsing/import-resolver.ts` — extractImports(), createTypeResolver(), ImportInfo
- `.planning/phases/16-member-parser/16-CONTEXT.md` — Phase 16 decisions (type design, parser behavior, resolution cascade)

### Tools being modified
- `src/tools/list-members.ts` — current tool, uses TransformedSymbol, needs enrichment
- `src/tools/search-symbols.ts` — current tool, workspace/symbol results, needs memberFqn
- `src/browsing/types.ts` — TransformedSymbol type definition, ClassReference, etc.

### Infrastructure
- `src/browsing/entry-index.ts` — EntryIndex.getClasses(packageName) for resolvePackage callback

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `TransformedSymbol` in `browsing/types.ts`: base type for member output — EnrichedSymbol variants extend this
- `EntryIndex.getClasses(packageName)`: returns `ClassIndexEntry[]` with `className` field — powers resolvePackage callback
- `parseDetail()` in `detail-parser.ts`: converts detail strings to MemberReference
- `createTypeResolver()` in `import-resolver.ts`: builds the type name resolver from imports
- `extractImports()` in `import-resolver.ts`: parses Java source for imports and package declaration
- `classNameToEntryPath()` in `tool-helpers.ts`: converts class name to entry path (reverse of FQN derivation)

### Established Patterns
- Domain types live in `browsing/types.ts`
- Tool registration follows `register*Tool(server)` pattern in `src/tools/`
- Structured output uses `makeSuccess()` envelope with provenance
- Tools return `{ content: [text summary], structuredContent: envelope }`

### Integration Points
- `list-members.ts` calls `lspClient.documentSymbol()` which returns DocumentSymbol[] — transformation from raw LSP to TransformedSymbol happens in `transformSymbol()`, enrichment should happen after this
- `search-symbols.ts` gets SymbolInformation[] from `workspace/symbol` — has `containerName` but no `detail`
- `sourceResult.entryPath` in list-members provides the path to derive class FQN
- `resolveClassSource()` already fetches source text — available for `extractImports()`

</code_context>

<deferred>
## Deferred Ideas

- FQN-based tool input (accepting member FQNs in find_references, find_definition, etc.) — deferred to v1.3 per REQUIREMENTS.md
- Generic type arguments on ClassType (typeArguments[]) — deferred per REQUIREMENTS.md
- Parameter types in FQN for overload disambiguation — decided against for now, revisit if needed

</deferred>

---

*Phase: 17-structured-member-output*
*Context gathered: 2026-04-14*
