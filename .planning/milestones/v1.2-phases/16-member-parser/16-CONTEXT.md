# Phase 16: Member Parser Domain Module - Context

**Gathered:** 2026-04-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Pure domain types and parser that convert JDT LS detail strings into structured method/field representations. No tool wiring — that's Phase 17. This phase delivers the TypeReference union, MemberReference types, detail string parser, and import-based name resolution.

</domain>

<decisions>
## Implementation Decisions

### TypeReference union design
- Discriminated union with `kind` field: `TypeReference = PrimitiveType | ClassType | ArrayType | VarargType | VoidType | UnresolvedType`
- `PrimitiveType`: `{ kind: "primitive"; name: string }` — for `int`, `boolean`, `float`, etc.
- `ClassType`: `{ kind: "class"; name: string; fqn: string }` — resolved class reference with FQN
- `ArrayType`: `{ kind: "array"; elementType: TypeReference }` — recursive, handles multi-dimensional arrays
- `VarargType`: `{ kind: "vararg"; elementType: TypeReference }` — semantically distinct from arrays
- `VoidType`: `{ kind: "void" }` — for method return types; constructor return type is `null`, not `VoidType`
- `UnresolvedType`: `{ kind: "unresolved"; rawType: string }` — minimal fallback, preserves raw text only

### MemberReference types
- `MemberReference = MethodReference | FieldReference`
- `MethodReference`: includes `ParameterInfo[]` (each with name if available + `TypeReference`) and `returnType: TypeReference | null` (null for constructors)
- `FieldReference`: includes `fieldType: TypeReference`

### Detail string parser
- `parseDetail()` converts JDT LS detail strings like `(BlockPos, int) : BlockState` into structured `ParameterInfo[]` and `returnType`
- Strip annotations (e.g., `@Nullable`) before resolving the underlying type — annotations are not part of the type
- Strip generic type arguments (e.g., `List<String>` → resolve `List`) — generics are out of scope per REQUIREMENTS.md, resolve the base type
- Parser takes an async `resolvePackage: (packageName: string) => string[]` callback for star import resolution — no jar I/O in the domain module

### Import resolution strategy
- Four-stage resolution cascade for simple name → FQN:
  1. Explicit imports: `import net.minecraft.util.math.BlockPos;`
  2. Star imports: `import net.minecraft.util.math.*;` — resolved via `resolvePackage` callback
  3. Same-package: types in the same package as the source file (extracted from `package` declaration)
  4. `java.lang.*`: `String`, `Object`, `Integer`, etc. implicitly available
- If all four fail → `UnresolvedType` with the raw simple name
- Star import results cached per package per tool call — `resolvePackage` only called once per package

### Claude's Discretion
- Internal parser implementation (regex, manual parsing, etc.)
- Exact set of Java primitives to recognize
- How to extract imports from source text (regex is fine)
- File organization within `src/` for the new domain module
- Test fixture design — real JDT LS detail string samples

</decisions>

<specifics>
## Specific Ideas

No specific requirements — the type design and parser behavior are fully captured in decisions above.

</specifics>

<canonical_refs>
## Canonical References

### Requirements
- `.planning/REQUIREMENTS.md` — TYPE-01 (MemberReference with ClassReference), TYPE-02 (detail string parser with graceful degradation)
- `.planning/REQUIREMENTS.md` "Out of Scope" table — generics explicitly deferred, hover-based parsing rejected in favor of detail strings

### Roadmap
- `.planning/ROADMAP.md` — Phase 16 success criteria (4 criteria: MemberReference type, parseDetail(), graceful degradation, import map extraction)

### Key source files
- `src/browsing/types.ts` — existing `ClassReference` and `TransformedSymbol` (has `detail: string | null` field)
- `src/tools/list-members.ts` — current consumer of `TransformedSymbol`, shows how `detail` flows through
- `src/tools/search-symbols.ts` — other consumer, workspace/symbol results
- `src/browsing/entry-index.ts` — `EntryIndex` can list classes per package (needed for `resolvePackage` callback in Phase 17 wiring)

### Prior phase context
- `.planning/phases/15-enable-method-search/15-CONTEXT.md` — Phase 15 decisions (method declarations enabled, probe removed)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ClassReference` in `browsing/types.ts`: existing type with `name/fqn/kind` — new `ClassType` variant is spiritually similar but designed for signatures
- `TransformedSymbol` in `browsing/types.ts`: already carries `detail: string | null` — this is the input to `parseDetail()`
- `EntryIndex` in `browsing/entry-index.ts`: can list classes per package — will provide the `resolvePackage` callback implementation in Phase 17

### Established Patterns
- Domain types live in `types.ts` files within their module directory
- Domain logic is pure functions with no I/O dependencies (see `class-parser.ts`, `cascading-regex.ts`)
- External dependencies injected as callbacks (consistent with `resolvePackage` design)

### Integration Points
- `TransformedSymbol.detail` is the input — parser consumes this string
- Phase 17 will wire the parser into `list_members` and `search_symbols` tool output
- `resolvePackage` callback will be provided by Phase 17 using `EntryIndex`

</code_context>

<deferred>
## Deferred Ideas

- Generic type arguments on ClassType (e.g., `List<String>` → `typeArguments: TypeReference[]`) — explicitly deferred per REQUIREMENTS.md
- Member FQN scheme (`Class;method()`, `Class;field:`) — Phase 17
- FQN-based tool input (accepting member FQNs in inspection tools) — deferred to v1.3

</deferred>

---

*Phase: 16-member-parser*
*Context gathered: 2026-04-14*
