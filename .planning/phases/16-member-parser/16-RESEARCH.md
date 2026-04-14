# Phase 16: Member Parser Domain Module - Research

**Researched:** 2026-04-14
**Domain:** JDT LS detail string parsing, Java type representation, import resolution
**Confidence:** HIGH

## Summary

Phase 16 is a pure domain module with no I/O dependencies. It defines TypeReference and MemberReference discriminated unions, a detail string parser that converts JDT LS detail strings into structured types, and an import resolution system that maps simple class names to fully qualified names. All external dependencies (jar reading, package listing) are injected via callbacks.

The domain is well-constrained: JDT LS detail strings for `documentSymbol` responses use a predictable format -- fields show their type (e.g., `"boolean"`, `"BlockState"`), methods show parameter types and return type (e.g., `"(BlockPos, int) : BlockState"`), and constructors show parameters with no return type. The parser must strip annotations and generic type arguments before resolving, and degrade to `UnresolvedType` when resolution fails.

**Primary recommendation:** Implement as a single domain module at `src/domain/member-parser/` with three files: `types.ts` (TypeReference + MemberReference unions), `detail-parser.ts` (parseDetail function), and `import-resolver.ts` (import extraction and name resolution). Keep all logic pure -- async only for the `resolvePackage` callback in star import resolution.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- TypeReference union: `PrimitiveType | ClassType | ArrayType | VarargType | VoidType | UnresolvedType` with `kind` discriminant
- PrimitiveType: `{ kind: "primitive"; name: string }`
- ClassType: `{ kind: "class"; name: string; fqn: string }`
- ArrayType: `{ kind: "array"; elementType: TypeReference }` (recursive)
- VarargType: `{ kind: "vararg"; elementType: TypeReference }`
- VoidType: `{ kind: "void" }`
- UnresolvedType: `{ kind: "unresolved"; rawType: string }`
- MemberReference = MethodReference | FieldReference
- MethodReference: includes `ParameterInfo[]` (name if available + TypeReference) and `returnType: TypeReference | null` (null for constructors)
- FieldReference: includes `fieldType: TypeReference`
- parseDetail() converts JDT LS detail strings into structured form
- Strip annotations before resolving type
- Strip generic type arguments (e.g., `List<String>` -> resolve `List`)
- Parser takes async `resolvePackage: (packageName: string) => string[]` callback for star imports
- Four-stage import resolution: explicit imports -> star imports -> same-package -> java.lang.* -> UnresolvedType
- Star import results cached per package per tool call

### Claude's Discretion
- Internal parser implementation (regex, manual parsing, etc.)
- Exact set of Java primitives to recognize
- How to extract imports from source text (regex is fine)
- File organization within `src/` for the new domain module
- Test fixture design -- real JDT LS detail string samples

### Deferred Ideas (OUT OF SCOPE)
- Generic type arguments on ClassType (e.g., `List<String>` -> `typeArguments: TypeReference[]`)
- Member FQN scheme (`Class;method()`, `Class;field:`) -- Phase 17
- FQN-based tool input -- deferred to v1.3
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TYPE-01 | MemberReference domain type with ClassReference for parameter types and return type | TypeReference union design, MemberReference = MethodReference + FieldReference with structured parameter/return types |
| TYPE-02 | Detail string parser converts JDT LS detail strings into structured MemberReference with graceful degradation | parseDetail() function, annotation/generic stripping, four-stage import resolution, UnresolvedType fallback |
</phase_requirements>

## Standard Stack

No new dependencies needed. This phase uses only TypeScript types and pure functions.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 5.7+ | Type definitions and logic | Already in project, discriminated unions are first-class |

### Supporting
None -- this is a pure domain module with zero runtime dependencies.

## Architecture Patterns

### Recommended Module Structure
```
src/
  domain/
    member-parser/
      types.ts            # TypeReference, MemberReference, ParameterInfo unions/interfaces
      detail-parser.ts    # parseDetail() function
      import-resolver.ts  # extractImports(), resolveTypeName()
```

Alternatively, if the project prefers to keep domain modules under `src/browsing/` where existing domain logic lives:

```
src/
  browsing/
    member-types.ts       # TypeReference, MemberReference, ParameterInfo
    detail-parser.ts      # parseDetail()
    import-resolver.ts    # extractImports(), resolveTypeName()
```

The second layout is more consistent with the existing project structure where `class-parser.ts` and `cascading-regex.ts` already live in `src/browsing/`. Recommend using `src/browsing/` to avoid creating a new `domain/` directory that breaks the existing flat structure.

### Pattern 1: Discriminated Union Types
**What:** TypeScript discriminated unions with a `kind` field for exhaustive switching
**When to use:** When a value can be one of several structurally different variants
**Example:**
```typescript
// All variants share a `kind` discriminant
type TypeReference =
  | PrimitiveType
  | ClassType
  | ArrayType
  | VarargType
  | VoidType
  | UnresolvedType;

interface PrimitiveType { kind: "primitive"; name: string; }
interface ClassType { kind: "class"; name: string; fqn: string; }
interface ArrayType { kind: "array"; elementType: TypeReference; }
interface VarargType { kind: "vararg"; elementType: TypeReference; }
interface VoidType { kind: "void"; }
interface UnresolvedType { kind: "unresolved"; rawType: string; }

// Exhaustive switch
function typeToString(t: TypeReference): string {
  switch (t.kind) {
    case "primitive": return t.name;
    case "class": return t.fqn;
    case "array": return typeToString(t.elementType) + "[]";
    case "vararg": return typeToString(t.elementType) + "...";
    case "void": return "void";
    case "unresolved": return t.rawType;
  }
}
```

### Pattern 2: Callback-Injected Async Dependencies
**What:** External I/O passed as async callback, keeping domain logic pure
**When to use:** When domain logic needs data from an external system (jars, filesystem)
**Example:**
```typescript
// Domain function signature -- async only because of callback
async function parseDetail(
  detail: string,
  symbolKind: string,
  resolveType: (simpleName: string) => Promise<TypeReference>,
): Promise<MethodReference | FieldReference> {
  // Pure parsing logic, calls resolveType for name resolution
}
```

### Pattern 3: Existing Project Patterns
**What:** Pure domain modules with no I/O, following `class-parser.ts` and `cascading-regex.ts`
**When to use:** Always for this phase
**Key observations from codebase:**
- `class-parser.ts`: Single exported function, regex-based, returns structured type or null
- `cascading-regex.ts`: Pure function with clear interface types, comprehensive JSDoc
- `types.ts`: All type exports, interfaces only, no logic
- Tests mirror source structure under `tests/browsing/`

### Anti-Patterns to Avoid
- **Importing jar-reading or LSP code:** This module must have zero imports from `jdtls/`, `project/`, or `state/`. All external data comes via callbacks.
- **Throwing on unparseable input:** Return `UnresolvedType` instead. The parser must never crash on unexpected detail strings.
- **Parsing generics recursively:** Per decisions, strip generic args (`List<String>` -> `List`). Do not build a generic type tree.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Java primitive recognition | Custom set of primitives | Hardcoded constant set | Only 8 primitives: `boolean`, `byte`, `char`, `short`, `int`, `long`, `float`, `double`. This is a fixed, small set. |
| Import statement parsing | Full Java parser | Regex on import lines | Import statements have a trivially regular syntax: `import [static] qualified.name[.*];` |
| Generic type stripping | Recursive balanced-paren parser | Simple angle-bracket depth counter | Only need to strip `<...>` from type names, not parse them. Count depth, strip when balanced. |

**Key insight:** JDT LS detail strings are a simplified representation, not full Java source. The parsing problem is much simpler than parsing Java itself.

## Common Pitfalls

### Pitfall 1: Nested Generics in Type Stripping
**What goes wrong:** A naive regex like `/<[^>]+>/` fails on nested generics like `Map<String, List<Integer>>`
**Why it happens:** Angle brackets nest, so you can't use a non-greedy match
**How to avoid:** Use a depth-counting loop: increment on `<`, decrement on `>`, strip from first `<` to the position where depth returns to 0
**Warning signs:** Test with `Map<String, List<Integer>>` -- if it leaves `, List<Integer>>` behind, the stripping is broken

### Pitfall 2: Array Types in Detail Strings
**What goes wrong:** JDT LS may represent array types as `int[]` or `String[]` in detail strings. The parser must detect trailing `[]` and wrap in `ArrayType`.
**Why it happens:** Arrays and varargs look similar but are semantically different. Varargs only appear as the last parameter.
**How to avoid:** Check for trailing `[]` to create ArrayType, trailing `...` to create VarargType. Process varargs only for the last parameter position.
**Warning signs:** `String[]` parsed as a class named "String[]" instead of ArrayType

### Pitfall 3: Annotations in Detail Strings
**What goes wrong:** JDT LS may include annotations like `@Nullable BlockState` or `@NotNull String` in detail strings
**Why it happens:** JDT LS reflects source annotations in symbol details
**How to avoid:** Strip leading `@Word` tokens (including parameterized annotations like `@SomeAnnotation(value)`) before type resolution
**Warning signs:** `@Nullable` parsed as a class name

### Pitfall 4: Constructor vs Method Detail Strings
**What goes wrong:** Treating constructors like methods and expecting a return type
**Why it happens:** Constructors have parameter lists but no ` : ReturnType` suffix
**How to avoid:** Check the `symbolKind` parameter -- constructors (kind "constructor") have `returnType: null`, not `VoidType`
**Warning signs:** Constructor parsed with `VoidType` return instead of `null`

### Pitfall 5: Empty Detail Strings
**What goes wrong:** Crashes on null/empty detail for class-level symbols
**Why it happens:** Class symbols in documentSymbol have detail `""` or `null`
**How to avoid:** Handle null/empty detail as a special case -- these symbols are not methods or fields, they represent the class itself
**Warning signs:** NPE or regex failure on empty string input

### Pitfall 6: Star Import Resolution is Async
**What goes wrong:** Forgetting that `resolvePackage` is async, leading to unresolved promises
**Why it happens:** Star imports require listing jar contents for a package, which is I/O
**How to avoid:** The resolver function and `parseDetail` must be async. Cache resolved package results per-call.
**Warning signs:** TypeReferences contain `[object Promise]` instead of actual type info

### Pitfall 7: java.lang Implicit Import Coverage
**What goes wrong:** Missing common java.lang types that aren't in explicit imports
**Why it happens:** `java.lang.*` is always implicitly available in Java but not in import statements
**How to avoid:** Include a comprehensive list of java.lang types: `Object`, `String`, `Integer`, `Long`, `Float`, `Double`, `Boolean`, `Byte`, `Short`, `Character`, `Number`, `Math`, `System`, `Thread`, `Throwable`, `Exception`, `RuntimeException`, `Error`, `Class`, `Enum`, `Record`, `Comparable`, `Iterable`, `AutoCloseable`, `Cloneable`, `Runnable`, `Override`, `Deprecated`, `SuppressWarnings`, `FunctionalInterface`, `StringBuilder`, `StringBuffer`, `ClassLoader`, `Process`, `ProcessBuilder`, `StackTraceElement`, etc.
**Warning signs:** `String` or `Object` parsed as `UnresolvedType`

## Code Examples

### JDT LS Detail String Formats (from codebase observation)

```typescript
// Field detail strings (from tests/tools/list-members.test.ts):
// detail: "boolean"         -- primitive field
// detail: "BlockState"      -- class reference field
// detail: "int"             -- primitive field
// detail: ""                -- class-level symbol (not a member)

// Method detail strings (from CONTEXT.md examples):
// detail: "void"            -- no-arg method returning void
// detail: "(BlockPos, int) : BlockState"  -- method with params and return
// detail: "(String) : void"              -- method with param, void return
// detail: "(int, int, int)"              -- constructor (no return type)

// Edge cases to handle:
// detail: "(@Nullable BlockPos) : BlockState"  -- annotated parameter
// detail: "List<String>"                       -- generic field type
// detail: "(Map<String, Integer>) : void"      -- generic parameter
// detail: "(String...) : void"                 -- varargs
// detail: "(int[]) : void"                     -- array parameter
```

### Detail String Parsing Strategy

```typescript
// Step 1: Determine if method or field based on symbolKind
// - "method" or "constructor" -> parse as method detail
// - "field" or "constant" or "enumMember" -> parse as field detail

// Step 2: For method details, split on " : " to get params and return
// "(BlockPos, int) : BlockState"
//  -> params = "BlockPos, int"
//  -> returnType = "BlockState"

// Step 3: Split params by comma (respecting nested generics)
// "Map<String, List<Integer>>, int"
//  -> ["Map<String, List<Integer>>", "int"]
//  Use angle bracket depth counting, only split at depth 0

// Step 4: For each type token:
//  a. Strip leading annotations (@Word, @Word(args))
//  b. Strip generic args (List<String> -> List)
//  c. Check for trailing [] (array) or ... (vararg)
//  d. Check if primitive -> PrimitiveType
//  e. Check if "void" -> VoidType
//  f. Resolve simple name -> ClassType via import resolver
//  g. If unresolved -> UnresolvedType
```

### Import Extraction Pattern

```typescript
// Regex to extract imports from Java source text
const IMPORT_RE = /^import\s+(?:static\s+)?([a-zA-Z_][\w.]*(?:\.\*)?)\s*;/gm;
const PACKAGE_RE = /^package\s+([a-zA-Z_][\w.]*)\s*;/m;

// Usage:
// const imports = [...sourceText.matchAll(IMPORT_RE)].map(m => m[1]);
// -> ["net.minecraft.util.math.BlockPos", "net.minecraft.block.*", "java.util.List"]
// 
// Explicit: "net.minecraft.util.math.BlockPos" -> maps "BlockPos" -> FQN
// Star: "net.minecraft.block.*" -> needs resolvePackage("net.minecraft.block")
// Package: extracted from PACKAGE_RE match
```

### Java Primitives Constant

```typescript
const JAVA_PRIMITIVES = new Set([
  "boolean", "byte", "char", "short", "int", "long", "float", "double"
]);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Raw detail strings in tool output | Structured TypeReference types | Phase 16 (now) | Claude can understand parameter/return types programmatically |
| Hover-based type parsing | Detail string parsing from documentSymbol | Design decision | More reliable -- detail strings are simpler and always available |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.x |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm vitest run tests/browsing/detail-parser.test.ts` |
| Full suite command | `pnpm vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TYPE-01 | TypeReference union exhaustive (all 6 kinds constructable) | unit | `pnpm vitest run tests/browsing/member-types.test.ts -t "TypeReference"` | No - Wave 0 |
| TYPE-01 | MemberReference = MethodReference + FieldReference | unit | `pnpm vitest run tests/browsing/member-types.test.ts -t "MemberReference"` | No - Wave 0 |
| TYPE-02 | parseDetail for field detail strings | unit | `pnpm vitest run tests/browsing/detail-parser.test.ts -t "field"` | No - Wave 0 |
| TYPE-02 | parseDetail for method detail strings with params and return | unit | `pnpm vitest run tests/browsing/detail-parser.test.ts -t "method"` | No - Wave 0 |
| TYPE-02 | parseDetail strips annotations | unit | `pnpm vitest run tests/browsing/detail-parser.test.ts -t "annotation"` | No - Wave 0 |
| TYPE-02 | parseDetail strips generics | unit | `pnpm vitest run tests/browsing/detail-parser.test.ts -t "generic"` | No - Wave 0 |
| TYPE-02 | parseDetail handles arrays and varargs | unit | `pnpm vitest run tests/browsing/detail-parser.test.ts -t "array"` | No - Wave 0 |
| TYPE-02 | parseDetail graceful degradation to UnresolvedType | unit | `pnpm vitest run tests/browsing/detail-parser.test.ts -t "unresolved"` | No - Wave 0 |
| TYPE-02 | Import extraction from source text | unit | `pnpm vitest run tests/browsing/import-resolver.test.ts -t "extract"` | No - Wave 0 |
| TYPE-02 | Four-stage import resolution cascade | unit | `pnpm vitest run tests/browsing/import-resolver.test.ts -t "resolve"` | No - Wave 0 |
| TYPE-02 | Star import caching per package | unit | `pnpm vitest run tests/browsing/import-resolver.test.ts -t "cache"` | No - Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm vitest run tests/browsing/detail-parser.test.ts tests/browsing/import-resolver.test.ts`
- **Per wave merge:** `pnpm vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/browsing/member-types.test.ts` -- covers TYPE-01 (type construction, discriminant switching)
- [ ] `tests/browsing/detail-parser.test.ts` -- covers TYPE-02 (parsing various detail formats)
- [ ] `tests/browsing/import-resolver.test.ts` -- covers TYPE-02 (import extraction, resolution cascade)

## Open Questions

1. **Exact JDT LS detail format for all edge cases**
   - What we know: Fields show type name, methods show `(ParamType, ...) : ReturnType`, constructors show `(ParamType, ...)` with no return
   - What's unclear: Whether JDT LS ever includes parameter names in detail strings (evidence suggests no -- only type names), whether annotations appear as `@Nullable` or `@org.jetbrains.annotations.Nullable`
   - Recommendation: Build parser to handle both simple and qualified annotation names. Test against real JDT LS output during Phase 17 integration. Any unexpected format degrades to UnresolvedType.

2. **Completeness of java.lang implicit imports**
   - What we know: All public types in java.lang are implicitly available
   - What's unclear: Whether to hardcode the full list or resolve dynamically via resolvePackage
   - Recommendation: Hardcode a set of the ~40 most common java.lang types. If a type is not in the hardcoded set but exists in java.lang, it will be resolved by the star import stage (since java.lang.* is implicitly a star import). The hardcoded set is an optimization to avoid the async callback for common types.

## Sources

### Primary (HIGH confidence)
- Project codebase -- `src/browsing/types.ts`, `src/browsing/class-parser.ts`, `src/browsing/cascading-regex.ts` (established patterns)
- Project codebase -- `tests/tools/list-members.test.ts` (real JDT LS detail string examples)
- Phase 16 CONTEXT.md -- locked decisions on type design and parser behavior

### Secondary (MEDIUM confidence)
- [DocumentSymbolHandler.java](https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/master/org.eclipse.jdt.ls.core/src/org/eclipse/jdt/ls/core/internal/handlers/DocumentSymbolHandler.java) -- JDT LS detail string generation logic
- [Eclipse JDT LS GitHub](https://github.com/eclipse-jdtls/eclipse.jdt.ls) -- project reference

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, pure TypeScript
- Architecture: HIGH -- follows established project patterns exactly
- Pitfalls: HIGH -- well-understood domain, predictable edge cases
- Detail string format: MEDIUM -- verified from test fixtures and JDT LS source, but real-world edge cases may surface during Phase 17 integration

**Research date:** 2026-04-14
**Valid until:** 2026-05-14 (stable domain, unlikely to change)
