# Technology Stack: v1.2 Symbol Resolution

**Project:** MinecraftDevMCP v1.2
**Researched:** 2026-04-14
**Scope:** Stack additions/changes for method/field symbol search and structured member type representations

## Executive Summary

This milestone requires **zero new dependencies**. The entire feature set is achievable through:
1. A single JDT LS initialization setting change (`includeSourceMethodDeclarations`)
2. New TypeScript types/interfaces for structured member representations
3. A member FQN scheme implemented as string conventions in existing code

The existing stack (TypeScript 6.0.2, MCP SDK ^1.29.0, ts-lsp-client ^1.1.1, Zod ^4.3.6, node-stream-zip ^1.15.0) is fully sufficient.

## Required Changes to Existing Stack

### JDT LS Initialization Settings

| Change | Current | Required | Confidence |
|--------|---------|----------|------------|
| `java.symbols.includeSourceMethodDeclarations` | Not set (defaults to `false`) | `true` | HIGH |

**What this does:** JDT LS's `workspace/symbol` request only returns types (classes, interfaces, enums) by default. This is a deliberate performance tradeoff by the JDT LS team. Setting `includeSourceMethodDeclarations: true` causes `workspace/symbol` to also return method and constructor declarations from indexed source files.

**Where to change:** `src/jdtls/client.ts` in the `initializationOptions.settings.java` object (around line 221):

```typescript
initializationOptions: {
	settings: {
		java: {
			autobuild: { enabled: true },
			import: {
				maven: { enabled: false },
				gradle: { enabled: false },
			},
			symbols: {
				includeSourceMethodDeclarations: true,
			},
		},
	},
},
```

**Critical limitation -- no field equivalent:** JDT LS does NOT have an `includeSourceFieldDeclarations` setting. The `workspace/symbol` request can return methods but NOT fields. This is confirmed by inspecting the JDT LS `Preferences.java` source -- only two symbol-related settings exist:
- `java.symbols.includeSourceMethodDeclarations` (boolean, default false)
- `java.symbols.includeGeneratedCode` (boolean, default false -- for Lombok-generated code)

**Implication for field search:** Fields must be discovered through `textDocument/documentSymbol` (which already works via `list_members`) rather than `workspace/symbol`. The `search_symbols` tool should clearly communicate this: when `kind: "field"` is requested, either return an informative error directing the user to `list_members`, or implement a fallback that searches within a specified class scope.

**Confidence:** HIGH -- verified against JDT LS `Preferences.java` source on GitHub and corroborated by nvim-jdtls discussion #676, Neovim Discourse reports, and emacs-lsp/lsp-java documentation.

### LSP Response Shape for Methods in workspace/symbol

When `includeSourceMethodDeclarations` is enabled, method entries in the `SymbolInformation[]` response have:

| Field | Value for Methods | Existing Handling |
|-------|-------------------|-------------------|
| `name` | Method name (e.g., `"tick"`, `"render"`) | Already mapped in `search_symbols` |
| `kind` | `6` (Method) or `9` (Constructor) | Already in `SYMBOL_KIND_NAME` and `KIND_NAME_TO_NUMBER` |
| `containerName` | Containing class FQN (e.g., `"net.minecraft.client.MinecraftClient"`) | Already read (line 99 of search-symbols.ts) |
| `location.uri` | File URI to extracted source | Already handled by `uriMapper` |
| `location.range` | Position of the method declaration | Already handled |

**No new LSP types or protocol libraries needed.** The existing `SymbolInformation` shape from ts-lsp-client already supports all method-related fields. The `search_symbols` tool's transform logic (lines 94-108) already handles `containerName`, `kind`, and `location` generically.

### Performance Impact

Enabling `includeSourceMethodDeclarations` increases result volume. Minecraft sources have ~6,600 classes with 5-50 methods each, so broad queries could return 30,000-300,000 symbols.

**Why this is manageable:**
- JDT LS applies the query string server-side as a prefix/substring filter before returning results -- it does not return all symbols and let the client filter
- The `search_symbols` tool already has `limit` (default 50, max 200), `offset` (pagination), and `kind` filter
- Specific method name queries (e.g., `"tick"`) will return hundreds, not hundreds of thousands

**Recommended safeguard:** Add a note in the tool description that method searches work best with specific queries, not single-character wildcards.

## New Types Needed (Pure TypeScript -- No Libraries)

### Structured Member Type Representations

The `ClassReference` type already exists in `src/browsing/types.ts`:

```typescript
export interface ClassReference {
	name: string;      // simple name
	fqn: string;       // fully qualified name
	kind: string;      // "class" | "interface" | "enum" | "record" | "@interface"
}
```

New interfaces needed for rich method/field representations. These are pure TypeScript -- no library required:

```typescript
// Parameter with ClassReference type
export interface MethodParameter {
	name: string;                    // parameter name
	type: ClassReference | string;   // ClassReference when resolvable, raw string otherwise
}

// Structured method representation
export interface MethodInfo {
	name: string;
	fqn: string;                     // "net.minecraft.client.MinecraftClient;tick()"
	access: string;                  // "public" | "protected" | "private" | "package-private"
	modifiers: string[];             // ["static", "final", "synchronized", etc.]
	returnType: ClassReference | string;
	parameters: MethodParameter[];
	deprecated: boolean;
}

// Structured field representation
export interface FieldInfo {
	name: string;
	fqn: string;                     // "net.minecraft.client.MinecraftClient;running:"
	access: string;
	modifiers: string[];
	type: ClassReference | string;
	deprecated: boolean;
}
```

**Where the type info comes from:** JDT LS `textDocument/hover` already returns type signatures as markdown. The `get_symbol_info` tool (already working) retrieves this. Parsing hover markdown into structured `ClassReference` objects requires regex on the hover output -- no AST parser needed because JDT LS formats hover text consistently:

```
public void tick()
public static MinecraftClient getInstance()
private final GameOptions options
```

### Member FQN Scheme

The FQN scheme uses `;` as the separator between class FQN and member name:

| Symbol Type | FQN Format | Example |
|-------------|-----------|---------|
| Class | `package.ClassName` | `net.minecraft.client.MinecraftClient` |
| Method | `package.ClassName;methodName()` | `net.minecraft.client.MinecraftClient;tick()` |
| Constructor | `package.ClassName;ClassName()` | `net.minecraft.client.MinecraftClient;MinecraftClient()` |
| Field | `package.ClassName;fieldName:` | `net.minecraft.client.MinecraftClient;running:` |

- `;` separates class from member (classes never contain `;`, so unambiguous)
- `()` suffix marks methods/constructors
- `:` suffix marks fields
- This is a **human-readable convention**, not JVM bytecode descriptor format

**Construction from workspace/symbol:** For method results, `containerName` provides the class FQN and `name` provides the method name. FQN = `${containerName};${name}()`.

**Construction from documentSymbol:** For field results from `list_members`, the class FQN is known from the tool input, and `name` is the field name. FQN = `${classFqn};${name}:`.

## No New Dependencies Required

| Need | Solution | Why No Library |
|------|----------|----------------|
| Method symbol search | JDT LS config change | Already built into JDT LS |
| Field discovery | Existing `list_members` / `documentSymbol` | Already working |
| Structured types | TypeScript interfaces | Pure type definitions |
| Member FQN | String concatenation | Simple convention |
| Zod schemas for new types | Zod 4 (^4.3.6 installed) | Already in place |
| Hover parsing for type info | Regex on JDT LS hover markdown | Consistent format, no AST needed |

## What NOT to Add

| Technology | Why Not |
|------------|---------|
| Java parser library (java-parser, tree-sitter-java) | JDT LS already provides semantic analysis. Hover gives type signatures. Parsing Java ASTs ourselves is redundant. |
| Additional LSP client library | ts-lsp-client + JSONRPCEndpoint handle all needed LSP requests. No protocol gaps. |
| Method signature parser library | JDT LS hover output is consistently formatted. Simple regex extracts return type, name, and parameters. |
| Caching layer for symbol results | JDT LS maintains its own index. Client-side caching adds complexity for marginal benefit. |
| Type resolution library | ClassReference construction from hover text is string manipulation. Full type resolution would require JDT LS APIs we can already call (hover, definition). |
| `java.symbols.includeGeneratedCode` | Minecraft sources are decompiled, not Lombok-generated. This setting is irrelevant for our use case. |

## Stack Summary

| Component | Version | Status for v1.2 | Action |
|-----------|---------|-----------------|--------|
| TypeScript | 6.0.2 | Unchanged | None |
| Node.js | 22 LTS | Unchanged | None |
| @modelcontextprotocol/sdk | ^1.29.0 | Unchanged | None |
| Zod | ^4.3.6 | Unchanged | None |
| node-stream-zip | ^1.15.0 | Unchanged | None |
| ts-lsp-client | ^1.1.1 | Unchanged | None |
| glob | ^13.0.6 | Unchanged | None |
| picomatch | ^4.0.4 | Unchanged | None |
| JDT LS | Latest milestone | **Config change** | Add `symbols.includeSourceMethodDeclarations: true` to init settings |

## Key Technical Details

### How workspace/symbol Query Matching Works

JDT LS uses the query string as a case-insensitive prefix/substring match against symbol names. With methods enabled:
- Query `"tick"` returns classes like `TickManager` AND methods like `tick()`, `tickEntities()`
- Query `"MinecraftClient"` returns the class AND its constructors
- The `kind` filter parameter becomes important for disambiguation

### containerName for Member FQN Construction

When JDT LS returns a method via workspace/symbol, `containerName` is the fully-qualified class name:

```
containerName: "net.minecraft.client.MinecraftClient"
name: "tick"
kind: 6 (Method)
--> FQN: "net.minecraft.client.MinecraftClient;tick()"
```

### documentSymbol for Complete Member Listing

`textDocument/documentSymbol` (used by `list_members`) already returns ALL members including fields, methods, constructors, inner classes, and enum constants with `detail` strings containing type information. This is the authoritative source for "what members does this class have" and is the only path to field discovery since workspace/symbol cannot return fields.

## Sources

- [JDT LS Preferences.java](https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/main/org.eclipse.jdt.ls.core/src/org/eclipse/jdt/ls/core/internal/preferences/Preferences.java) -- authoritative source for all JDT LS settings (HIGH confidence)
- [nvim-jdtls Discussion #676](https://github.com/mfussenegger/nvim-jdtls/discussions/676) -- community confirmation of `includeSourceMethodDeclarations` behavior (HIGH confidence)
- [Neovim Discourse: workspace symbols not giving methods](https://neovim.discourse.group/t/telescope-lsp-dynamic-workspace-symbols-for-nvim-jdtls-is-not-giving-methods/5032) -- additional confirmation (MEDIUM confidence)
- [JDT LS Issue #1712: partial results for workspace/symbol](https://github.com/eclipse-jdtls/eclipse.jdt.ls/issues/1712) -- performance considerations for large result sets (MEDIUM confidence)
- [LSP 3.17 Specification](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/) -- SymbolInformation type definition, containerName semantics (HIGH confidence)
- [emacs-lsp/lsp-java](https://emacs-lsp.github.io/lsp-java/) -- additional JDT LS settings reference (MEDIUM confidence)
- Codebase analysis: `src/jdtls/client.ts`, `src/tools/search-symbols.ts`, `src/tools/list-members.ts`, `src/browsing/types.ts` -- existing implementation review (HIGH confidence)
