# Requirements: MinecraftDevMCP

**Defined:** 2026-04-12
**Core Value:** Claude can browse, search, and navigate decompiled Minecraft source code and dependency sources in real time, enabling it to reverse engineer how things work and help write Mixins and mod logic with accurate, up-to-date knowledge of the actual codebase.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Server Foundation

- [x] **SERV-01**: MCP server runs over stdio transport using the official TypeScript MCP SDK
- [x] **SERV-02**: Server executes via ts-node (no compile step required for development)
- [x] **SERV-03**: All logging goes to stderr only — zero stdout output outside JSON-RPC protocol messages
- [x] **SERV-04**: Every MCP tool has a strongly-typed Zod schema for parameters and returns rich, structured response types
- [x] **SERV-05**: Tool responses err on the side of providing more information rather than less (include context, metadata, related info)

### Project Management

- [x] **PROJ-01**: User can load a Fabric/Loom Gradle project by providing its root directory path
- [x] **PROJ-02**: User can assign a human-readable name to a loaded project session (e.g., "debrand-1.21" or "old-version") and refer to it by that name in all subsequent tool calls
- [x] **PROJ-03**: Multiple projects can be loaded simultaneously with independent state
- [x] **PROJ-04**: User can list all loaded projects with their names, MC versions, and status
- [x] **PROJ-05**: User can unload a project to free resources
- [x] **PROJ-06**: Server auto-discovers the Minecraft sources jar from gradle.properties (minecraft_version, yarn_mappings) and the Loom cache path structure
- [x] **PROJ-07**: Server auto-discovers dependency source jars (Fabric API, libraries) from Gradle dependency resolution
- [x] **PROJ-08**: User can include/exclude specific dependencies from the discovered set
- [x] **PROJ-09**: Minecraft sources jar has a stable, predictable identifier (e.g., "minecraft") distinct from other dependency jars
- [ ] **PROJ-10**: User can manually override any auto-discovered jar path
- [x] **PROJ-11**: Server correctly handles both Yarn-mapped jar era (MC <=1.21.11) and unobfuscated jar era (MC >=26.1) with different Loom cache path structures

### Project Metadata

- [ ] **META-01**: User can query structured project metadata: Minecraft version, Yarn/Mojang mappings version, Fabric Loader version, Fabric API version
- [ ] **META-02**: User can query mod metadata from fabric.mod.json: mod ID, name, version, description, authors, dependencies
- [ ] **META-03**: User can list all available source jars for a project with their identifiers, types, and sizes
- [ ] **META-04**: Each source jar is labeled with granular provenance: which mod or project depends on it, whether it's Minecraft core, a Fabric API module, a transitive dependency, or the mod's own source
- [ ] **META-05**: Metadata responses include the mapping era (Yarn-mapped vs unobfuscated) for each project

### Source Browsing

- [ ] **BROW-01**: User can list all top-level packages in any source jar or mod source
- [ ] **BROW-02**: User can list sub-packages at any depth within a package
- [ ] **BROW-03**: User can list all classes in a package, including inner classes, enums, records, and interfaces
- [ ] **BROW-04**: User can read the full decompiled source of any class by fully-qualified name
- [x] **BROW-05**: Source files are read directly from jars on demand — no extraction to disk, no file caching
- [ ] **BROW-06**: User can browse mod source (src/main/java/) using the same interface as jar source browsing
- [ ] **BROW-07**: Inner classes, anonymous classes, lambdas, enums, and records are correctly handled (listed, readable, navigable)
- [ ] **BROW-08**: Every source browsing result includes source provenance: which jar/source it came from and its granular dependency chain

### Search

- [ ] **SRCH-01**: User can search for classes, methods, or fields by name across all sources (MC, dependencies, mod) in a project
- [ ] **SRCH-02**: Search supports regex patterns
- [ ] **SRCH-03**: Search results include rich context: fully-qualified name, enclosing class, method/field signature, source provenance
- [ ] **SRCH-04**: Search results are paginated or limited to prevent oversized responses
- [ ] **SRCH-05**: User can scope search to specific source types (e.g., only MC core, only Fabric API, only mod source)

### Cascading Regex

- [ ] **CREG-01**: User can provide an array of regex patterns where each pattern searches within the text matched by the previous pattern
- [ ] **CREG-02**: The cascading regex resolves to a precise character position (offset) in a source file
- [ ] **CREG-03**: Cascading regex works across any source (jar or mod source) in any loaded project
- [ ] **CREG-04**: Error reporting is clear when a pattern in the chain fails to match (which step failed, what text was being searched)

### Navigation

- [ ] **NAV-01**: User can find the definition of a symbol at a position identified by cascading regex (go-to-definition)
- [ ] **NAV-02**: User can find all references/usages of a symbol at a position identified by cascading regex across all sources
- [ ] **NAV-03**: Find-definition and find-references work across jar boundaries (MC source, dependency source, mod source)
- [ ] **NAV-04**: Navigation results include source provenance, file path, position, and surrounding context

### Version Comparison

- [ ] **COMP-01**: User can compare the source of a class between two loaded projects (different MC versions)
- [ ] **COMP-02**: Comparison accounts for the mapping transition — classes may have different names between Yarn-mapped and unobfuscated eras
- [ ] **COMP-03**: Comparison results are structured (not just raw diff) so Claude can reason about what changed

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Mixin Tooling

- **MIX-01**: User can query available injection points for a target method
- **MIX-02**: User can validate a Mixin target reference against the actual MC source
- **MIX-03**: Server suggests Mixin annotation types appropriate for a given modification goal

### Advanced Navigation

- **ANAV-01**: User can query the class hierarchy (superclass chain, implemented interfaces) for any class
- **ANAV-02**: User can find all subclasses/implementors of a class/interface

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Code generation / file writing | Claude Code handles this; MCP server is read/analysis only |
| Mixin injection point analysis | v2 — foundation must be solid first |
| Runtime game interaction (JDWP) | Different domain entirely; not relevant to source analysis |
| Non-Fabric toolchain support (Forge, NeoForge, Quilt) | Multiplies complexity; Fabric + Loom only |
| Persistent source extraction cache | User requirement: read from jars directly |
| GUI or web interface | MCP server consumed by AI assistants; no human UI needed |
| Bytecode analysis | Decompiled source is sufficient for mod development workflow |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SERV-01 | Phase 1 | Complete |
| SERV-02 | Phase 1 | Complete |
| SERV-03 | Phase 1 | Complete |
| SERV-04 | Phase 1 | Complete |
| SERV-05 | Phase 1 | Complete |
| PROJ-01 | Phase 2 | Complete |
| PROJ-06 | Phase 2 | Complete |
| PROJ-11 | Phase 2 | Complete |
| PROJ-07 | Phase 3 | Complete |
| PROJ-08 | Phase 3 | Complete |
| PROJ-09 | Phase 3 | Complete |
| PROJ-10 | Deferred | Pending |
| BROW-05 | Phase 3 | Complete |
| PROJ-02 | Phase 4 | Complete |
| PROJ-03 | Phase 4 | Complete |
| PROJ-04 | Phase 4 | Complete |
| PROJ-05 | Phase 4 | Complete |
| META-01 | Phase 5 | Pending |
| META-02 | Phase 5 | Pending |
| META-03 | Phase 5 | Pending |
| META-04 | Phase 5 | Pending |
| META-05 | Phase 5 | Pending |
| BROW-01 | Phase 6 | Pending |
| BROW-02 | Phase 6 | Pending |
| BROW-03 | Phase 6 | Pending |
| BROW-04 | Phase 6 | Pending |
| BROW-06 | Phase 6 | Pending |
| BROW-07 | Phase 6 | Pending |
| BROW-08 | Phase 6 | Pending |
| SRCH-01 | Phase 7 | Pending |
| SRCH-02 | Phase 7 | Pending |
| SRCH-03 | Phase 7 | Pending |
| SRCH-04 | Phase 7 | Pending |
| SRCH-05 | Phase 7 | Pending |
| CREG-01 | Phase 8 | Pending |
| CREG-02 | Phase 8 | Pending |
| CREG-03 | Phase 8 | Pending |
| CREG-04 | Phase 8 | Pending |
| COMP-01 | Phase 9 | Pending |
| COMP-02 | Phase 9 | Pending |
| COMP-03 | Phase 9 | Pending |
| NAV-01 | Phase 10 | Pending |
| NAV-02 | Phase 10 | Pending |
| NAV-03 | Phase 10 | Pending |
| NAV-04 | Phase 10 | Pending |

**Coverage:**
- v1 requirements: 45 total
- Mapped to phases: 45
- Unmapped: 0

---
*Requirements defined: 2026-04-12*
*Last updated: 2026-04-12 after roadmap creation*
