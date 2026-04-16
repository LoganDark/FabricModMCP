# Technology Stack — v1.4 Project Rearchitecture

**Project:** FabricModMCP
**Researched:** 2026-04-15
**Scope:** Stack additions/changes for composable project containers and JDT LS in-memory file support

## No New Dependencies Required

The v1.4 rearchitecture requires **zero new library additions**. All changes are architectural refactoring of existing code using the current stack. This is the correct outcome -- the milestone is about restructuring data models and composition patterns, not adding new capabilities that require new libraries.

## JDT LS In-Memory File Support -- Research Verdict

**Verdict: Keep tmpdir extraction. Do NOT attempt in-memory/virtual files.**

Confidence: HIGH (multiple sources, confirmed by JDT LS architecture)

### Why In-Memory Files Will Not Work for This Use Case

There are two theoretical approaches to avoid tmpdir extraction, and both fail:

#### Approach 1: textDocument/didOpen Without Files on Disk

The LSP spec says servers should use content from didOpen notifications rather than reading from disk. However:

- **JDT LS violates this for indexing.** Issue [#1815](https://github.com/eclipse-jdtls/eclipse.jdt.ls/issues/1815) documents that JDT LS assumes files exist on disk and throws `JavaModelException` when they don't. This is a known, unfixed architectural limitation in JDT LS.
- **didOpen is per-document, not project-wide.** You would need to send didOpen for all ~6,600 Minecraft source files at startup. JDT LS does not build its index from didOpen notifications -- it scans source folders declared in `.classpath`.
- **find-references and type hierarchy require the JDT index**, which is built from disk-based source folders, not from open documents.

#### Approach 2: kind="lib" with sourcepath (Source Attachments)

Eclipse `.classpath` supports library entries with attached source jars:
```xml
<classpathentry kind="lib" path="minecraft.jar" sourcepath="minecraft-sources.jar"/>
```

This is how Eclipse IDE navigates into library source code. However:

- **Source attachments are read-only view-only.** They provide source display when navigating to a class file, but the source is NOT indexed for find-references or workspace symbol search. References are found through the compiled `.class` files in the library jar, not the source attachment.
- **We don't have compiled class jars for all sources.** Our sources jars contain `.java` files without corresponding `.class` jars in many cases (decompiled Minecraft sources have no separate class jar in the Loom cache -- the sources jar IS the artifact).
- **jdt:// URI scheme adds complexity.** Navigation to library source returns `jdt://contents/...` URIs, requiring the client to implement a `java/classFileContents` handler with `classFileContentsSupport` in extendedClientCapabilities. This is a fundamentally different URI mapping model than our current `file://` approach, and would require rewriting the entire URI mapper and all tools that consume navigation results.

#### Why Tmpdir Extraction Actually Works Well

The current approach extracts ~6,600 files to tmpdir in a few seconds at project load time. This is a one-time cost. The benefits:

- JDT LS indexes everything as `kind="src"` source folders -- full semantic analysis
- find-references works across ALL sources (Minecraft, Fabric API, libraries, mod source, study jars)
- URI mapping is simple: `file://` paths map bidirectionally to jar IDs
- Incremental sync for study jars already works (add/remove individual jars without full re-extraction)

The only downside is disk usage (~50-100MB in tmpdir per project), which is acceptable and cleaned up on unload.

### Recommendation

Mark the "Investigate JDT LS in-memory file support" requirement as **researched and rejected**. The current tmpdir extraction approach is the correct one for this use case. No changes needed.

## Stack for Composable Project Containers

### What Changes (Architecture Only, No New Libraries)

| Change | Current | New | Library Impact |
|--------|---------|-----|----------------|
| `LoadedProject` type | Monolithic: rootPath, gradleConfig, fabricMod, dependencyJars, studyJars | Container: name, children (FabricModChild / StudyJarChild), no rootPath | None -- TypeScript types only |
| `ProjectStore` | Stores `LoadedProject` directly | Stores `ProjectContainer` with named children | None -- same Map-based store |
| Dependency namespacing | Flat: jar IDs like `minecraft`, `fabric-api:...` | Namespaced: `mymod/minecraft`, `mymod/fabric-api:...` | None -- string manipulation |
| JDT LS workspace | One workspace per project | One workspace per project (shared across all children) | None -- same extraction |
| Tool scoping | `project` param only | `project` + optional `child` param | None -- Zod schema change |
| `dependency-resolver` | Merges project.dependencyJars + study jars | Merges all children's dependencies with namespace prefixes | None -- logic change |

### What Does NOT Change

| Component | Why Unchanged |
|-----------|---------------|
| node-stream-zip | Jar reading is jar reading -- composable containers don't change I/O |
| ts-lsp-client | LSP client interface is the same regardless of project model |
| JDT LS workspace extraction | Still extracts to tmpdir, still uses `.classpath` with `kind="src"` |
| MCP SDK / Zod | Tool registration pattern unchanged, just different schema shapes |
| EntryIndex / SourceAdapter | Entry indexing is per-jar, unaffected by container structure |
| cascading-regex | Source search is per-file, unaffected by container structure |
| picomatch / glob | Same glob matching for filters and file discovery |

## Dependency Namespacing Pattern

No library needed. The pattern is straightforward string prefixing:

```typescript
// Current: flat jar IDs
"minecraft"
"fabric-api:fabric-networking-api-v1"
"com.google.code.gson:gson"

// New: namespaced by child name within project
"my-mod/minecraft"
"my-mod/fabric-api:fabric-networking-api-v1"
"other-mod/minecraft"  // different fabric mod, same project

// Study jars at project level (no namespace prefix)
"my-study-jar"
```

The `/` separator is safe because jar IDs use `:` as their internal separator (Maven coordinate convention), and filesystem paths are never exposed as jar IDs.

## JDT LS Multi-Child Workspace Strategy

When a project has multiple fabric mod children, the single JDT LS workspace must contain sources from ALL children. The current extraction architecture already supports this:

```xml
<!-- .classpath for project with two fabric mods and a study jar -->
<classpath>
  <!-- Fabric mod 1 dependencies -->
  <classpathentry kind="src" path="my-mod__minecraft"/>
  <classpathentry kind="src" path="my-mod__fabric-api__fabric-networking-api-v1"/>
  <classpathentry kind="src" path="my-mod__src"/>

  <!-- Fabric mod 2 dependencies (may share some jars) -->
  <classpathentry kind="src" path="other-mod__minecraft"/>
  <classpathentry kind="src" path="other-mod__src"/>

  <!-- Study jars (project-level) -->
  <classpathentry kind="src" path="my-study-jar"/>

  <classpathentry kind="con" path="org.eclipse.jdt.launching.JRE_CONTAINER"/>
  <classpathentry kind="output" path="bin"/>
</classpath>
```

**Shared jar optimization:** When two fabric mods reference the same Minecraft version, the sources jar is identical. The extraction can detect this (same `sourcesJarPath`) and extract once, symlinking or sharing the directory. This is an optimization, not a blocker -- naive extraction (one dir per child per dep) works correctly if less efficiently.

**URI mapper update:** The `jarIdToDirName` mapping must become namespace-aware. Currently `jarIdToDirName("minecraft")` returns `"minecraft"`. With namespacing, `jarIdToDirName("my-mod/minecraft")` would return `"my-mod__minecraft"`. The existing `__` replacement for `:` extends naturally to `/` as well.

## Existing Stack Verification

Current versions confirmed still appropriate:

| Technology | Current | Status |
|------------|---------|--------|
| TypeScript | 6.0.2 (package.json) | Current -- exceeds 5.7+ minimum |
| Node.js | 22 LTS | Current |
| @modelcontextprotocol/sdk | ^1.29.0 | Current |
| Zod | ^4.3.6 | Current |
| node-stream-zip | ^1.15.0 | Current |
| ts-lsp-client | ^1.1.1 | Current |
| picomatch | ^4.0.4 | Current |
| glob | ^13.0.6 | Current |

## What NOT to Add

| Library | Why Not |
|---------|---------|
| Any virtual filesystem library | JDT LS requires real files on disk for indexing |
| Additional LSP client libraries | ts-lsp-client handles everything needed |
| State management libraries | Project containers are simple enough for plain Maps and TypeScript types |
| Event emitter libraries | Node.js built-in EventEmitter is sufficient if child lifecycle events are needed |
| Schema/validation beyond Zod | Zod 4 handles all tool parameter validation; container types are internal |
| Dependency injection framework | Project is 7K LOC -- DI adds complexity without benefit at this scale |
| Tree/graph data structure libraries | Container hierarchy is max 2 levels deep (project -> children). A Map is sufficient. |

## Sources

- [JDT LS Issue #1815: should not assume file exists on disk](https://github.com/eclipse-jdtls/eclipse.jdt.ls/issues/1815) -- confirms JDT LS requires files on disk for indexing
- [Eclipse .classpath source attachments](https://help.eclipse.org/latest/topic/org.eclipse.jdt.doc.user/reference/ref-properties-source-attachment.htm) -- sourcepath is view-only, not indexed for search
- [Eclipse classpath entry kinds](https://help.eclipse.org/latest/topic/org.eclipse.jdt.doc.isv/guide/jdt_api_classpath.htm) -- kind=src vs kind=lib behavior differences
- [JDT LS Issue #657: jdt URI scheme](https://github.com/eclipse-jdtls/eclipse.jdt.ls/issues/657) -- jdt:// URIs require classFileContentsSupport capability
- [JDT LS Issue #1652: manual source attachment](https://github.com/eclipse-jdtls/eclipse.jdt.ls/issues/1652) -- source attachment configuration in JDT LS
- [LSP Virtual Documents proposal](https://github.com/NTaylorMullen/LSPVirtualDocuments/blob/master/Documents/FileSystemSpec.md) -- LSP-level virtual FS spec, not implemented by JDT LS
- [JDT LS Discussion #3191: classpaths](https://github.com/eclipse-jdtls/eclipse.jdt.ls/discussions/3191) -- classpath configuration without build tools
- [JDT LS Issue #906: source attachment relative paths](https://github.com/eclipse-jdtls/eclipse.jdt.ls/issues/906) -- source attachment path handling behavior
- Codebase analysis: `src/jdtls/workspace.ts`, `src/jdtls/workspace-sync.ts`, `src/jdtls/client.ts`, `src/jdtls/uri-mapper.ts`, `src/project/types.ts`, `src/state/project-store.ts`, `src/project/loader.ts`, `src/project/dependency-resolver.ts` -- existing implementation review (HIGH confidence)
