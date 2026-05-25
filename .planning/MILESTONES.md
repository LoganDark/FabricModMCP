# Milestones

## v1.6 Windows Support (Shipped: 2026-05-25)

**Phases completed:** 5 phases (35-39), 18 plans, 21 tasks
**Stats:** 10,357 src LOC / 18,878 test LOC, 28 MCP tools, 872 tests (+176 over v1.5), 106 commits over 10 days

**Delivered:** First-class Windows support — FabricModMCP now spawns JDT LS on Windows out of the box, with smarter cross-platform Java discovery that prefers the JDK the user's mod project actually builds against. Every Unix code path is byte-identical to v1.5 (UNIX-01/02/03 regression guards proven by the full vitest suite).

**Key accomplishments:**

- **Cross-platform Java discovery** — 5-slot async priority chain (`--java-home` → `org.gradle.java.home` from project `gradle.properties` → `JAVA_HOME` → `java` on PATH → vendor-aware install scan), 3s per-candidate timeout, 23 unit tests in `tests/jdtls/java-discovery.test.ts` locking down every JAVA-NN requirement (Phase 37)
- **Windows-native JDT LS spawning** — `resolveJavaExecutable()` lets `child_process.spawn` succeed with absolute `java.exe` paths (libuv ignores PATHEXT for absolute paths); `findJdtLs()` probes Windows conventions (`%LOCALAPPDATA%\jdtls`, `%PROGRAMFILES%\jdtls`, `%USERPROFILE%\jdtls`, Mason package) via the cross-platform `jdtlsCandidateDirs()` helper from new `src/platform/index.ts`; `process.env.HOME` replaced by `os.homedir()` everywhere (Phases 35, 38)
- **Windows URI / path handling correctness** — drive-letter case-folding round-trips through `toFileUri`/`fromFileUri`, ZIP-entry path normalization avoids mixed `\`/`/` corruption, ZIP path-traversal guard, Windows-only EBUSY retry loop on temp-dir cleanup, 8.3 short-name canonicalization makes JDT LS `Location.uri` prefix matching work (Phases 36, 39-06)
- **End-to-end Windows validation** — 4-row matrix on a real Windows 11 host empirically confirmed `create_project` → `add_fabric_mod` → cross-jar `find_definition` succeeds under all 4 Java-discovery slots (Phase 39-04)
- **UNIX-01/02/03 regression-guard preserved** — every Unix code path is byte-identical to v1.5 by design (helpers return v1.5 literals verbatim from their Unix branch); full vitest suite stays green on macOS (872p/1s, exit 0) after every Windows-targeted change (Phase 35 + Phase 39-05)
- **User-facing Windows docs** — standalone `docs/WINDOWS-SUPPORT.md` plus a new `### Platform Support` subsection in `CLAUDE.md`, both inlining the Java + JDT LS priority chains verbatim with a D-18 cross-reference footer pointing to REQUIREMENTS.md and the implementing source files (Phase 39-01, 39-02)

**Known deferred items at close:** 4 (see STATE.md `## Deferred Items`)
- Phase 37 human-UAT: `add_fabric_mod` → `find_definition` after live Java-install rescue (requires real JDT LS + Java 21+ + real Minecraft mod)
- Phase 39 human-UAT: Windows `find_references` SC-2 decision (architectural — needs JDT LS request-cancellation plumbing, deferred to v1.7) + Linux SC-3 vitest sanity run (no Linux host accessible at close)

---

## v1.5 Quality & Consistency (Shipped: 2026-04-16)

**Phases completed:** 7 phases, 7 plans, 14 tasks
**Stats:** 8,542 LOC TypeScript, 28 MCP tools, 696 tests (+31)

**Delivered:** Comprehensive quality pass driven by 4-agent codebase audit — fixed bugs, unified APIs, improved documentation accuracy, and closed data exposure gaps to make the server reliable and agent-friendly.

**Key accomplishments:**

- Bug fixes: race-safe jar handles, cache eviction leak, cycle-safe type hierarchy, inner class read_source, JDT LS cleanup, workspace sync rollback
- Unified API: limit+hasMore on all paginated tools, consistent parameter naming, z.enum validation, dead fields removed
- Per-child jar filtering: each mod's own filter applied independently (fixed cross-mod filter leakage)
- Build file re-parsing: refresh tools re-read gradle.properties, build.gradle.kts, fabric.mod.json with change warnings
- Data exposure: JDT LS status, declared build deps, jar locations in type hierarchy, inner class FQNs
- Complete documentation: SERVER_INSTRUCTIONS with 5 new sections, all 28 tool descriptions accurate, CLAUDE.md filled

---

## v1.4 Project Rearchitecture (Shipped: 2026-04-15)

**Phases completed:** 6 phases, 15 plans, 31 tasks
**Stats:** 8,250 LOC TypeScript, 28 MCP tools, 665 tests (+73)

**Delivered:** Projects restructured from monolithic Fabric-only containers into composable named containers holding any mix of fabric mods and study jars, with namespaced dependency resolution, flexible scoping, and unified JDT LS semantic navigation.

**Key accomplishments:**

- Composable project containers with discriminated union type hierarchy (Project/FabricModChild/StudyJarChild)
- Namespaced dependency resolution — all dep IDs prefixed by mod name, scope parameter on all jar-aware tools
- Multi-mod support with auto-suffix collision handling and per-child jar lifecycle
- Clean 28-tool taxonomy: 5 lifecycle, 6 info/refresh, 17 browsing — zero compatibility shims
- Unified JDT LS workspace per project with cross-mod semantic navigation
- Default project with JDT LS session at startup

---

## v1.3 Context Management (Shipped: 2026-04-15)

**Phases completed:** 4 phases, 9 plans, 17 tasks

**Key accomplishments:**

- Pure sliceLines utility with 11 edge-case tests covering no-params, partial ranges, clamping, beyond-EOF, empty files, trailing newlines, and chunk concatenation invariant
- read_source tool accepts startLine/lineCount params with JAR_REQUIRED validation and metadata on every response
- extractMemberSource accepts optional linesBefore/linesAfter with silent boundary clamping and memberStartLine/memberEndLine metadata
- read_member tool accepts linesBefore/linesAfter params, passing them to extractMemberSource and returning memberStartLine/memberEndLine metadata
- Generic applyPagination<T>() utility with PaginationInput/PaginatedResult types and PARAMS.limit/offset Zod schemas
- Paginated find_references/find_implementations/find_definition with limit/offset params and total/offset/hasMore envelope metadata
- Compact-by-default navigation and locate tools via shared DETAIL_PARAMS schemas and strip functions
- Compact-by-default member/class listing tools with 66.5% overall response size reduction measured against real Minecraft project
- 4 new tests covering detail flag opt-in paths for navigation and locate tools (lineContent: true, steps: true)

---

## v1.2 Symbol Resolution (Shipped: 2026-04-14)

**Phases completed:** 4 phases, 7 plans, 12 tasks

**Key accomplishments:**

- Unlocked JDT LS method declarations in workspace/symbol, removed explosion-prone readiness probe, corrected search_symbols description to types+methods (not fields)
- TypeReference/MemberReference discriminated unions and four-stage import-based type name resolver with star import caching
- parseDetail function converting JDT LS detail strings into structured FieldReference/MethodReference with annotation stripping, depth-counted generic removal, and array/vararg detection
- buildMemberFqn, EnrichedSymbol types, createResolvePackage bridge, and enrichSymbols pipeline for structured member output
- Wired enrichment pipeline into list_members (structured types + FQNs) and added memberFqn to search_symbols results
- read_member MCP tool that extracts individual method/field source by FQN with Javadoc, including overload and inner class support
- Optional context parameter on locate_in_source that extends matches to whole line boundaries with configurable surrounding lines

---

## v1.1 Study Jars (Shipped: 2026-04-14)

**Phases completed:** 4 phases, 8 plans, 18 tasks

**Key accomplishments:**

- StudyJar type system with granular JarReader add/remove and per-key cache eviction
- Study jar lifecycle domain service with validation, creation, staleness detection, DependencyEntry conversion, and refresh_dependencies survival wiring
- Two-mode dependency resolver (resolved vs all) with getDependenciesForTool helper and simplified searchClasses signature
- All 11 tool files updated to use dependency resolver, eliminating direct dependencyJars access across the entire tool layer
- Four MCP tools (add, remove, list, configure) for study jar lifecycle management, wired into registerAllTools with 379 tests green
- 18 integration tests across 4 files covering add/remove/list/configure study jar tools with success, error, and batch fail-fast behavior
- Incremental study jar extraction with classpath regeneration, JDT LS notification, and probe-based readiness detection
- Study jar tools wired to workspace sync -- add blocks until indexed, remove unsyncs before cleanup, list shows workspaceSynced per jar

---

## v1.0 MVP (Shipped: 2026-04-14)

**Phases completed:** 10 phases, 22 plans, 41 tasks

**Key accomplishments:**

- ESM TypeScript MCP server skeleton with response envelope types, stderr logger, CLI parser, and StdioServerTransport entry point
- Echo demonstration tool with Zod validation, response envelope, include-based metadata opt-in, and 8-test suite proving all SERV requirements via InMemoryTransport
- Gradle parser with variable substitution, Loom cache resolver for both mapping eras, and Zod-validated fabric.mod.json parser
- Project loader orchestrates gradle/loom/fabric parsing into LoadedProject, wired into server startup via --project CLI flag
- Three-pronged dependency discovery with POM parsing, source jar resolution, and transitive traversal integrated into project loader
- On-demand jar entry reading via node-stream-zip with picomatch glob filtering and three new MCP tools (configure_filters, refresh_dependencies, read_jar_entry)
- ProjectStore resolution chain, auto-naming with collision suffixes, JarReader per-project handle tracking with shared-handle ref counting, and zero-project CLI startup
- Four new MCP tools (load/unload/list/set-default) and optional project resolution on all existing tools via shared JarReader singleton
- DependencyEntry extended with provenanceChains field tracking all dependency paths through recursive discovery traversal
- get_project_metadata MCP tool with category flags for version info, mod info, and jar inventory including mapping era and provenance chains
- Entry index builder, class declaration parser, and jar/filesystem source adapter for hierarchical source browsing
- Three MCP tools (list_packages, list_classes, read_source) for hierarchical source navigation with cross-jar merging, picomatch glob filtering, and provenance tracking
- FQN glob search with picomatch dot-to-slash conversion, kind filtering, deduplication, priority sorting, and offset pagination
- search_classes MCP tool wired with Zod schema validation, DomainError handling, and provenance envelope wrapping searchClasses domain function
- Pure cascading regex domain module with sequential pattern narrowing, inline flag prefix parsing, and absolute offset/line/column tracking
- locate_in_source MCP tool wrapping cascading regex engine with multi-jar search, priority sorting, and results/failures split
- Bidirectional URI mapper and regex-based context extractor for JDT LS integration, with typed session/navigation interfaces and Wave 0 test scaffolds
- JDT LS workspace extraction and process lifecycle with eager init on project load and graceful degradation when Java 21 or JDT LS is unavailable
- find_definition and find_references MCP tools combining cascading regex position identification with JDT LS semantic navigation, returning NavigationResult with jar provenance and context snippets
- JDT LS endpoint storage, Phase 10 capabilities declaration, SymbolKind mapping, and list_members tool for tree-structured class member browsing
- Shared cascading-regex-to-position helper with hover info tool and implementation finder using raw LSP endpoint
- 3-step LSP type hierarchy with supertype walk and BFS subtypes, plus workspace-wide symbol search with kind filtering and pagination

---
