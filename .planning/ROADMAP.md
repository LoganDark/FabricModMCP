# Roadmap: MinecraftDevMCP

## Overview

This roadmap delivers a TypeScript MCP server that gives Claude Code deep, structured access to Minecraft Fabric mod internals. The journey starts with a working MCP server skeleton, builds up project discovery and jar reading infrastructure, then layers on browsing, search, and navigation capabilities. Each phase delivers an independently verifiable capability, with the highest-risk component (JDT LS semantic navigation) deferred to the end so the server is fully useful even if that phase proves difficult.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Server Bootstrap** - Working MCP server over stdio with typed tool framework and stderr-only logging
- [x] **Phase 2: Project Discovery** - Load a Fabric/Loom project by path, parse Gradle config, locate Minecraft sources jar (completed 2026-04-13)
- [ ] **Phase 3: Dependency Discovery and Jar Registry** - Discover all dependency source jars, read entries on demand without extraction
- [ ] **Phase 4: Multi-Project Sessions** - Named project sessions with simultaneous loading, listing, and unloading
- [ ] **Phase 5: Project Metadata** - Expose structured metadata (MC version, mappings, mod info, jar inventory, provenance)
- [ ] **Phase 6: Source Browsing** - Navigate packages, list classes, read full source from jars and mod source
- [ ] **Phase 7: Search** - Find classes/methods/fields by name or regex across all sources with scoping and pagination
- [ ] **Phase 8: Cascading Regex Engine** - Hierarchical pattern matching that resolves to precise character positions in source
- [ ] **Phase 9: Version Comparison** - Compare class source across two loaded projects with structured diff output
- [ ] **Phase 10: Semantic Navigation** - Find definition and find references via cascading regex positions and JDT LS

## Phase Details

### Phase 1: Server Bootstrap
**Goal**: A working MCP server that accepts tool calls over stdio, validates parameters with Zod schemas, and returns structured responses -- with zero stdout pollution
**Depends on**: Nothing (first phase)
**Requirements**: SERV-01, SERV-02, SERV-03, SERV-04, SERV-05
**Success Criteria** (what must be TRUE):
  1. Server starts via tsx and completes MCP handshake over stdio without errors
  2. A test tool can be called with typed parameters and returns a structured JSON response
  3. All logging output goes to stderr only -- stdout contains nothing except JSON-RPC protocol messages
  4. Tool parameter validation rejects malformed input with clear error messages
  5. Tool responses include rich metadata beyond the minimum (the "more info" principle is established)
**Plans**: 2 plans

Plans:
- [x] 01-01-PLAN.md -- Project scaffolding, core types, server framework, and entry point
- [x] 01-02-PLAN.md -- Echo tool implementation and comprehensive test suite

### Phase 2: Project Discovery
**Goal**: User can point the server at a Fabric/Loom Gradle project directory and the server correctly parses its configuration and locates the Minecraft sources jar in the Loom cache
**Depends on**: Phase 1
**Requirements**: PROJ-01, PROJ-06, PROJ-11
**Success Criteria** (what must be TRUE):
  1. User can load a project by providing its root directory path and the server accepts it
  2. Server parses gradle.properties to extract minecraft_version and yarn_mappings (or detects unobfuscated era)
  3. Server resolves the correct Loom cache path and locates the Minecraft sources jar on disk
  4. Server correctly distinguishes Yarn-mapped projects (MC <=1.21.11) from unobfuscated projects (MC >=26.1) and handles both cache path structures
**Plans**: 2 plans

Plans:
- [x] 02-01-PLAN.md -- Types, test fixtures, Gradle parser, Loom cache resolver, fabric.mod.json parser with tests
- [x] 02-02-PLAN.md -- Project loader orchestrator, project store, CLI wiring, server startup integration

### Phase 3: Dependency Discovery and Jar Registry
**Goal**: Server discovers all dependency source jars for a loaded project and can read individual entries from any jar on demand without extracting to disk
**Depends on**: Phase 2
**Requirements**: PROJ-07, PROJ-08, PROJ-09, BROW-05
**Success Criteria** (what must be TRUE):
  1. Server auto-discovers Fabric API and other dependency source jars from the Gradle cache
  2. Minecraft sources jar has a stable, predictable identifier ("minecraft") distinct from other jars
  3. User can include/exclude specific dependencies from the discovered set
  4. Individual .java files can be read directly from any jar on demand with no files extracted to disk
**Plans**: 2 plans

Plans:
- [x] 03-01-PLAN.md -- Types, POM parser, source jar finder, three-pronged dependency discovery, loader integration
- [x] 03-02-PLAN.md -- Jar reader (node-stream-zip), include/exclude filtering (picomatch), MCP tools

### Phase 4: Multi-Project Sessions
**Goal**: Users can work with multiple Fabric projects simultaneously with named sessions, enabling the side-by-side porting workflow
**Depends on**: Phase 3
**Requirements**: PROJ-02, PROJ-03, PROJ-04, PROJ-05
**Success Criteria** (what must be TRUE):
  1. User can assign a human-readable name to a project session (e.g., "old-1.21" or "new-26.1") and refer to it by name in all tool calls
  2. Two or more projects can be loaded simultaneously with fully independent state
  3. User can list all loaded projects showing their names, MC versions, and status
  4. User can unload a project to free its resources (jar handles, etc.)
**Plans**: 2 plans

Plans:
- [x] 04-01-PLAN.md — ProjectStore enhancements (resolveProject, auto-naming, default tracking), JarReader per-project handle tracking, CLI multi-project support, server startup
- [x] 04-02-PLAN.md — Four new MCP tools (load, unload, list, set-default) and update existing tools to optional project resolution

### Phase 5: Project Metadata
**Goal**: Users can query rich, structured metadata about any loaded project -- versions, mod info, jar inventory, and dependency provenance
**Depends on**: Phase 4
**Requirements**: META-01, META-02, META-03, META-04, META-05
**Success Criteria** (what must be TRUE):
  1. User can query a project's Minecraft version, mappings version, Fabric Loader version, and Fabric API version as structured data
  2. User can query mod metadata from fabric.mod.json (mod ID, name, version, description, authors, dependencies)
  3. User can list all available source jars for a project with identifiers, types, and sizes
  4. Each source jar is labeled with granular provenance (Minecraft core, Fabric API module, transitive dep, mod source, and which project depends on it)
  5. Metadata responses include the mapping era (Yarn-mapped vs unobfuscated) for each project
**Plans**: TBD

Plans:
- [ ] 05-01: TBD
- [ ] 05-02: TBD

### Phase 6: Source Browsing
**Goal**: Users can navigate decompiled source hierarchically -- list packages, list classes, read full source -- across jar sources and mod source using a unified interface
**Depends on**: Phase 3
**Requirements**: BROW-01, BROW-02, BROW-03, BROW-04, BROW-06, BROW-07, BROW-08
**Success Criteria** (what must be TRUE):
  1. User can list top-level packages in any source jar or mod source directory
  2. User can drill into sub-packages at any depth and list their contents
  3. User can list all classes in a package including inner classes, enums, records, and interfaces
  4. User can read the full decompiled source of any class by fully-qualified name
  5. Mod source (src/main/java/) is browsable using the same interface as jar source
  6. Every browsing result includes source provenance (which jar or source it came from)
**Plans**: TBD

Plans:
- [ ] 06-01: TBD
- [ ] 06-02: TBD
- [ ] 06-03: TBD

### Phase 7: Search
**Goal**: Users can find classes, methods, and fields by name or regex pattern across all sources in a project, with scoping, pagination, and rich context
**Depends on**: Phase 6
**Requirements**: SRCH-01, SRCH-02, SRCH-03, SRCH-04, SRCH-05
**Success Criteria** (what must be TRUE):
  1. User can search for classes, methods, or fields by name across MC source, dependency source, and mod source
  2. Search supports regex patterns for flexible matching
  3. Search results include fully-qualified name, enclosing class, signature, and source provenance
  4. Results are paginated or capped to prevent oversized responses
  5. User can scope search to specific source types (MC core only, Fabric API only, mod source only, etc.)
**Plans**: TBD

Plans:
- [ ] 07-01: TBD
- [ ] 07-02: TBD

### Phase 8: Cascading Regex Engine
**Goal**: Users can provide an array of regex patterns that progressively narrow within matched text to resolve a precise character position in any source file
**Depends on**: Phase 6
**Requirements**: CREG-01, CREG-02, CREG-03, CREG-04
**Success Criteria** (what must be TRUE):
  1. User can provide an array of regex patterns where each searches within the text matched by the previous
  2. The engine resolves the final match to a precise character offset in the source file
  3. Cascading regex works on any source -- jar entries and mod source files in any loaded project
  4. When a pattern fails to match, the error clearly reports which step failed and what text was being searched
**Plans**: TBD

Plans:
- [ ] 08-01: TBD
- [ ] 08-02: TBD

### Phase 9: Version Comparison
**Goal**: Users can compare how a class changed between two loaded projects (different MC versions) with structured output that Claude can reason about
**Depends on**: Phase 4, Phase 6
**Requirements**: COMP-01, COMP-02, COMP-03
**Success Criteria** (what must be TRUE):
  1. User can compare the source of a class between two loaded projects by specifying project names and class FQN
  2. Comparison handles the mapping transition -- classes may have different names between Yarn-mapped and unobfuscated eras
  3. Comparison results are structured (additions, removals, modifications -- not raw unified diff) so Claude can reason about what changed
**Plans**: TBD

Plans:
- [ ] 09-01: TBD
- [ ] 09-02: TBD

### Phase 10: Semantic Navigation
**Goal**: Users can find definitions and references of symbols across all sources using cascading regex for position identification and JDT LS for semantic analysis
**Depends on**: Phase 8
**Requirements**: NAV-01, NAV-02, NAV-03, NAV-04
**Success Criteria** (what must be TRUE):
  1. User can find the definition of a symbol at a position identified by cascading regex (go-to-definition)
  2. User can find all references/usages of a symbol at a cascading-regex-identified position across all sources
  3. Navigation works across jar boundaries (MC source, dependency source, mod source)
  4. Navigation results include source provenance, file path, position, and surrounding source context
**Plans**: TBD

Plans:
- [ ] 10-01: TBD
- [ ] 10-02: TBD
- [ ] 10-03: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9 -> 10

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Server Bootstrap | 0/2 | Planning complete | - |
| 2. Project Discovery | 2/2 | Complete   | 2026-04-13 |
| 3. Dependency Discovery and Jar Registry | 0/2 | Planning complete | - |
| 4. Multi-Project Sessions | 0/2 | Planning complete | - |
| 5. Project Metadata | 0/2 | Not started | - |
| 6. Source Browsing | 0/3 | Not started | - |
| 7. Search | 0/2 | Not started | - |
| 8. Cascading Regex Engine | 0/2 | Not started | - |
| 9. Version Comparison | 0/2 | Not started | - |
| 10. Semantic Navigation | 0/3 | Not started | - |
