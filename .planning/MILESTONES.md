# Milestones

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
