/**
 * Centralized tool descriptions, server instructions, and shared parameter schemas.
 *
 * All MCP-facing text lives here so it's easy to review, refactor,
 * and keep consistent across all tools.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Server-level instructions (sent during MCP initialize handshake)
// ---------------------------------------------------------------------------

export const SERVER_INSTRUCTIONS = `\
FabricModMCP — deep access to Minecraft mod development internals for Fabric/Loom projects. \
Browse decompiled source, navigate dependencies, and use semantic Java analysis \
(go-to-definition, find-references, type hierarchy) to understand Minecraft internals and write Mixins.

## Workflow

1. Create a project with create_project (a "default" project is pre-created at startup)
2. Add a fabric mod with add_fabric_mod (path to a Fabric mod's root directory)
3. Browse: list_packages -> list_classes -> list_members -> read_member (single member) or read_source (full class)
4. Search: search_classes (by name pattern) or search_symbols (by symbol name) -> list_members -> read_member
5. Navigate: find_definition, find_references, find_implementations, get_symbol_info, type_hierarchy

## Shared Concepts

**project parameter**: Most tools accept an optional \`project\` name. Omit it when only one project exists or an active project is set via set_active_project.

**Class names** use fully-qualified dot notation: \`net.minecraft.client.MinecraftClient\`, \`net.minecraft.world.World\`.

**Jar IDs** are namespaced by member name. A fabric mod's dependencies use "modName/depId" format \
(e.g., "my-mod/minecraft", "my-mod/net.fabricmc.fabric-api:fabric-resource-loader-v0"). \
A fabric mod's own source uses just the mod name (e.g., "my-mod"). \
Study jars use their given name (bare, no prefix). \
Use get_project_info to see members, then get_member_info with a member name to see all available jars.

**Sources vs compiled jars**: Each dependency can have two jar files — a **sources jar** (Java source files, \`.java\`) and a **compiled jar** (bytecode + resources: lang files, shaders, textures, JSON data). \
Most browsing tools (list_packages, read_source, etc.) work with sources jars. \
To read resources like \`assets/minecraft/lang/en_us.json\` or shader files, use \`read_jar_entry\` with \`source: "compiled"\`. \
Minecraft always has both jars. Dependencies may have one or both. Study jars can optionally have a compiled jar alongside the sources jar.

**scope parameter**: Most tools accept an optional \`scope\` to target a specific member (fabric mod). \
When scoped, bare jar IDs like "minecraft" resolve within that member's namespace. \
When omitted, bare IDs resolve automatically if only one fabric mod exists, or error if ambiguous. \
When scoped, only that child's own jars (after its filters) are searched. When unscoped, all children's jars are searched (each with its own filter applied).

**Cascading regex patterns**: Several tools locate a symbol position using an array of regex patterns that narrow progressively. \
The first pattern searches the entire source file; each subsequent pattern searches only within the previous match. \
The position returned is the beginning of the final match. \
The regex engine is Node.js ES2024 (supports lookbehind, named groups, Unicode properties, etc.). \
Use inline flags like (?i) for case-insensitive or (?s) for dotAll.

Best practice — use two patterns:
1. Match the declaration or statement containing the symbol: \`"private final WorldRenderer worldRenderer;"\`
2. Match the specific symbol name within it: \`"WorldRenderer"\`

More examples:
- Find \`getBlockState\` in a method call: \`["getBlockState\\\\(pos\\\\)", "getBlockState"]\`
- Find the class declaration itself: \`["class MinecraftClient", "MinecraftClient"]\`
- Find an import: \`["import net\\\\.minecraft\\\\.world\\\\.World;", "World"]\`

**details parameter**: Many tools return compact output by default to save context. \
Pass a \`details\` object with boolean flags to opt into richer output: \
navigation tools accept \`{ lineContent: true }\`, list_members accepts \`{ signatures: true }\`, \
list_classes/search_classes accept \`{ modifiers: true, innerClasses: true }\`, locate_in_source accepts \`{ steps: true }\`, \
and read_source/read_member accept \`{ provenance: true }\`.

**Mapping eras**: Projects are either \`mapped\` (Yarn-deobfuscated names like MinecraftClient, getBlockState) \
or \`unmapped\` (Mojang's unobfuscated names in newer versions). This affects which source jar format is used.

## JDT LS (Java Language Server)

JDT LS (Eclipse Java Development Tools Language Server) provides semantic Java analysis — go-to-definition, \
find-references, type hierarchy, workspace symbol search, and hover info. It requires Java 21+ and the \
JDTLS_HOME environment variable pointing to the JDT LS installation directory. \
If JDT LS is unavailable, 8 tools return the \`JDTLS_NOT_AVAILABLE\` error code: \
list_members, read_member, find_definition, find_references, find_implementations, get_symbol_info, search_symbols, type_hierarchy. \
Use get_project_info to check \`jdtlsAvailable\` per project.

## Response Envelope

All tools return \`{ ok: true, ...data }\` on success or \`{ ok: false, code: string, message: string, tried?: string[], suggestions?: string[] }\` on error. \
The \`code\` field is a machine-readable error code (e.g., JDTLS_NOT_AVAILABLE, NOT_FOUND, AMBIGUOUS_ID). \
\`tried\` shows what was attempted; \`suggestions\` offers recovery actions.

## Study Jars

Workflow: add_study_jar (provide file path + optional name) -> configure_study_jar (set autoInclude to control default visibility) -> list_study_jars (see all study jars and stats). \
Study jar names must not conflict with existing dependency IDs. \
Study jars are available to all browsing and search tools. Use configure_filters to fine-tune which jars appear in results. \
Optionally provide a compiledJar path when adding a study jar to enable reading resources (lang files, textures, shaders) via read_jar_entry with source: "compiled".

## Refresh Guidance

Use refresh_project or refresh_project_members after modifying gradle.properties, build.gradle.kts, or fabric.mod.json \
and running ./gradlew downloadSources. Both tools re-parse build configuration files (not just re-scan jars). \
refresh_project refreshes all fabric mod members; refresh_project_members refreshes specific ones by name.

## configure_filters

Use configure_filters to control which dependency jars appear in browsing and search results. \
In include-all mode (default), glob patterns define jars to EXCLUDE. In exclude-all mode, patterns define jars to INCLUDE. \
Each child's own source and minecraft dependency are always included regardless of filters.`;

// ---------------------------------------------------------------------------
// Shared parameter schemas (reused across multiple tools)
// ---------------------------------------------------------------------------

export const PARAMS = {
	/** Optional project name — used by 16+ tools. */
	project: z.string().optional().describe('Project name if multiple are loaded'),
	/** Fully-qualified class name — used by 8 tools. */
	class: z.string().describe('Fully-qualified class name'),
	/** Optional single jar ID — used by 8 tools. */
	jar: z.string().optional().describe('Jar ID (default: search all jars)'),
	/** Optional jar array with glob support — used by 3 tools. */
	jars: z.array(z.string()).optional().describe('Jar IDs or glob patterns (default: all jars)'),
	/** Cascading regex patterns — used by 5 tools. */
	patterns: z.array(z.string()).min(1).describe('Cascading regex patterns to locate the symbol'),
	/** Optional first line to return (1-based). Requires jar parameter. */
	startLine: z.number().int().min(1).optional()
		.describe('First line to return (1-based). Requires jar parameter.'),
	/** Optional number of lines to return. Requires jar parameter. */
	lineCount: z.number().int().min(1).optional()
		.describe('Number of lines to return. Requires jar parameter.'),
	/** Optional number of source lines to include before the member. */
	linesBefore: z.number().int().min(0).optional()
		.describe('Number of source lines to include before the member'),
	/** Optional number of source lines to include after the member. */
	linesAfter: z.number().int().min(0).optional()
		.describe('Number of source lines to include after the member'),
	/** Optional maximum number of results to return. Omit for all results. */
	limit: z.number().int().min(1).optional()
		.describe('Maximum number of results to return. Omit for all results.'),
	/** Optional number of results to skip (0-based). Default: 0. */
	offset: z.number().int().min(0).optional()
		.describe('Number of results to skip (0-based). Default: 0.'),
	/** Optional child name to scope to. */
	scope: z.string().optional()
		.describe('Child name to scope to (e.g., fabric mod name). Bare jar IDs resolve within this child\'s namespace.'),
} as const;

// ---------------------------------------------------------------------------
// Detail parameter schemas (opt-in verbose output per tool category)
// ---------------------------------------------------------------------------

export const DETAIL_PARAMS = {
	/** Navigation tools: find_references, find_implementations, find_definition */
	navigation: z.object({
		lineContent: z.boolean().optional().describe(
			'Include context snippets, entry paths, and provenance chains per result'
		),
	}).optional().describe('Detail flags (all default to false = compact)'),

	/** Member listing tools: list_members */
	member: z.object({
		signatures: z.boolean().optional().describe(
			'Include parameter types, return types, field types, and LSP detail strings'
		),
	}).optional().describe('Detail flags (all default to false = compact)'),

	/** Class listing tools: list_classes, search_classes */
	class: z.object({
		modifiers: z.boolean().optional().describe(
			'Include access level and modifiers (abstract, final, static, sealed)'
		),
		innerClasses: z.boolean().optional().describe(
			'Include inner class listings. Inner classes respect the modifiers flag.'
		),
	}).optional().describe('Detail flags (all default to false = compact)'),

	/** Locate tool: locate_in_source */
	locate: z.object({
		steps: z.boolean().optional().describe(
			'Include cascade regex step details and provenance chains'
		),
	}).optional().describe('Detail flags (all default to false = compact)'),

	/** Source reading tools: read_source, read_member */
	source: z.object({
		provenance: z.boolean().optional().describe(
			'Include dependency provenance chains per result'
		),
	}).optional().describe('Detail flags (all default to false = compact)'),
} as const;

// ---------------------------------------------------------------------------
// Tool descriptions
// ---------------------------------------------------------------------------

export const TOOL_DESCRIPTIONS = {
	// -- Project management --------------------------------------------------

	echo:
		'Echo back the input. For testing and debugging only.',

	list_projects:
		'List all projects with name, member count, active child name, and whether each is the active project.',

	set_active_project:
		'Set the active project used when the project parameter is omitted in other tools.',

	get_project_info:
		'Get project overview: member list with name, kind, and basic metadata per child (Minecraft version for fabric mods, jar path for study jars). Enough info to know which member to inspect with get_member_info.',

	get_member_info:
		'Get detailed info for a specific project member. For fabric mods: Minecraft version, Yarn mappings, loader version, Fabric API version, mapping era, fabric.mod.json contents, and jar inventory with Maven coordinates, category, availability, and file size. For study jars: jar path, auto-include status, and stats.',

	create_project:
		'Create a new empty project container. Initializes a JDT LS workspace if available. Projects hold fabric mods and study jars as members. The project name must be unique. Response includes jdtlsAvailable status. Use add_fabric_mod or add_study_jar to populate it.',

	remove_project:
		'Remove an entire project and all its members. Closes all jar handles, cleans up JDT LS workspace, and frees resources. Clears the active project if this was it.',

	set_active_child:
		'Set the active child (fabric mod) on a project. When set, bare jar IDs like "minecraft" resolve within that child\'s namespace without requiring the scope parameter. Does not affect which jars are searched — use the scope parameter on individual tools for that.',

	add_fabric_mod:
		'Add a Fabric/Loom Gradle project as a member of an existing project. Parses gradle.properties and build.gradle.kts to detect Minecraft version, Yarn mappings, and dependencies. Locates source jars and compiled jars in the Gradle cache. The member name is derived from fabric.mod.json id. If a member with the same name already exists, auto-suffixes with -2, -3, etc.',

	remove_project_member:
		'Remove one or more members (fabric mods or study jars) from a project by name. Closes jar handles, cleans up workspace entries, and frees resources. Accepts an array of names; fails on the first nonexistent name with no partial removal.',

	// -- Configuration -------------------------------------------------------

	configure_filters:
		'Filter which dependency jars appear in browsing and search results. In include-all mode (default), glob patterns define jars to EXCLUDE. In exclude-all mode, patterns define jars to INCLUDE. Each child\'s own source and minecraft dependency are always included in its filtered results. Patterns match jar IDs (e.g., "net.fabricmc.fabric-api:*" to match all Fabric API modules).',

	refresh_project:
		'Re-scan all fabric mod members for dependency source jars in the Gradle cache. Re-parses gradle.properties and build.gradle.kts to detect configuration changes. Use after running ./gradlew downloadSources or changing build.gradle dependencies. Automatically unloads any study jars whose names now conflict with real dependencies.',

	refresh_project_members:
		'Re-scan specific fabric mod members for dependency source jars. Re-parses gradle.properties, build.gradle.kts, and fabric.mod.json for each specified member. Requires an array of member names. An empty array is not an error but returns "nothing changed". Use after running ./gradlew downloadSources for specific mods.',

	// -- Browsing ------------------------------------------------------------

	list_packages:
		'List Java packages across source jars. Drill into a parent package with the `package` parameter, control nesting depth, and filter by jar. Returns package names with class counts. Start here to explore unfamiliar code top-down.',

	list_classes:
		'List classes in a package with metadata: simple name, FQN, kind (class/interface/enum/record/@interface), and which jars contain it. Pass details: { modifiers: true } to include access level and modifiers (abstract/final/static/sealed). Pass details: { innerClasses: true } to include inner class listings. Inner classes respect the modifiers flag. Filter by jar or include sub-packages with depth.',

	search_classes:
		'Search for classes by glob pattern against fully-qualified names. Use * for one name segment, ** to cross package boundaries. Case-insensitive by default. Examples: "*Client" finds MinecraftClient, "net.minecraft.block.*" lists that package, "**.*Registry" finds registries anywhere. Filterable by kind and jar. Paginated. Pass details: { modifiers: true } to include access level and modifiers. Pass details: { innerClasses: true } to include inner class listings.',

	list_members:
		'List all members of a Java class as a structured tree: fields, methods, constructors, enum constants, and inner classes. Requires JDT LS (Java 21+ and JDTLS_HOME). Returns JDTLS_NOT_AVAILABLE if unavailable. Each member includes its name, kind, line range, member FQN, and nested children. Pass details: { signatures: true } to include parameter types, return types, field types, and LSP detail strings. Use this to understand a class\'s API before reading its source — especially useful for identifying Mixin targets.',

	read_source:
		'Read Java source of a class by FQN. When no jar is specified, returns source from every jar containing the class. Supports optional startLine and lineCount parameters to read a specific line range (requires specifying a jar). Every response includes metadata: startLine, endLine, totalLineCount, and truncated. Pass details: { provenance: true } to include dependency provenance chains. Use list_members first to understand structure, then read_source for implementation details.',

	read_member:
		'Read the source of a specific method, constructor, or field by its member FQN (e.g., net.minecraft.client.MinecraftClient#tick()). Requires JDT LS (Java 21+ and JDTLS_HOME). Returns JDTLS_NOT_AVAILABLE if unavailable. Field FQNs use a trailing colon format (e.g., MinecraftClient#worldRenderer:). Returns the full declaration including Javadoc, annotations, signature, and body. When multiple overloads share the same FQN, returns all of them as separate entries. Get FQNs from list_members or search_symbols output. Use linesBefore and linesAfter to include surrounding source context without a separate read_source call. Pass details: { provenance: true } to include dependency provenance chains.',

	read_jar_entry:
		'Read any file from a jar by its internal path (slash-separated, e.g. "net/minecraft/client/MinecraftClient.java"). Unlike read_source which takes a class FQN, this takes a raw entry path — useful for non-Java files or when you know the exact path. By default reads from the sources jar (Java source files). Pass source: "compiled" to read from the compiled jar instead — useful for resources like lang files, shaders, textures, JSON data, and .class files that only exist in compiled jars.',

	// -- Position ------------------------------------------------------------

	locate_in_source:
		'Find a precise character position in Java source using cascading regex patterns. Returns offset, line, column, and matched text. When details: { steps: true } is passed, each step in details.steps includes a matched field showing the matched text for that step. Searches all jars containing the class unless a specific jar is given. This is the building block used by the LSP navigation tools — use it directly only when you need raw position data. Optionally include surrounding context lines with the context parameter.',

	// -- LSP navigation ------------------------------------------------------

	find_definition:
		'Go-to-definition for a symbol located by cascading regex patterns. Requires JDT LS (Java 21+ and JDTLS_HOME). Returns JDTLS_NOT_AVAILABLE if unavailable. Returns definition location(s) with jar ID, class name, line, and column. Works across jar boundaries — e.g., navigate from a method call in mod source to its definition in Minecraft source. Paginated with limit/offset. Pass details: { lineContent: true } to include context snippets, entry paths, and provenance chains.',

	find_references:
		'Find all usages of a symbol located by cascading regex patterns across all source jars. Requires JDT LS (Java 21+ and JDTLS_HOME). Returns JDTLS_NOT_AVAILABLE if unavailable. Each result includes jar ID, class name, line, and column. Use to understand how a method/field/class is used — critical for assessing impact before writing Mixins. Paginated with limit/offset. Pass details: { lineContent: true } to include context snippets, entry paths, and provenance chains.',

	find_implementations:
		'Find implementations of an interface method, abstract method, or type located by cascading regex patterns. Requires JDT LS (Java 21+ and JDTLS_HOME). Returns JDTLS_NOT_AVAILABLE if unavailable. Returns implementing locations with jar ID, class name, line, and column. Use to find concrete implementations — e.g., "what classes implement Inventory?" or "who overrides tick()?". Paginated with limit/offset. Pass details: { lineContent: true } to include context snippets, entry paths, and provenance chains.',

	get_symbol_info:
		'Get hover information (type signature, Javadoc, metadata) for a symbol located by cascading regex patterns. Requires JDT LS (Java 21+ and JDTLS_HOME). Returns JDTLS_NOT_AVAILABLE if unavailable. Returns raw markdown from JDT LS. Use to check a symbol\'s type or read its documentation without navigating to its definition.',

	search_symbols:
		'Search for Java types (classes, interfaces, enums) and methods/constructors by name across the entire workspace using JDT LS. Requires JDT LS (Java 21+ and JDTLS_HOME). Returns JDTLS_NOT_AVAILABLE if unavailable. Unlike search_classes which matches class names from the jar index, this finds symbols semantically via the language server. Fields are NOT searchable via this tool (use list_members on a specific class instead). Filterable by kind. Paginated.',

	type_hierarchy:
		'Get the type hierarchy for a class: supertype chain (extends lineage and implements list, separated) and subtypes to configurable depth. Requires JDT LS (Java 21+ and JDTLS_HOME). Returns JDTLS_NOT_AVAILABLE if unavailable. Returns ClassReferences (name, FQN, kind, jar) for each entry. depth:0 returns the supertype chain only (no subtypes). The supertype chain is fully traversed regardless of depth. Essential for understanding Mixin targets — e.g., finding what a class extends, what interfaces it implements, or what classes extend it.',

	// -- Study jar management -----------------------------------------------

	add_study_jar:
		'Add a source jar to a project for study. Provide a file path to a sources JAR and an optional name (auto-derived from filename if omitted). Optionally provide a compiledJar path for a compiled/resources JAR (for reading non-source resources like lang files, textures, shaders). The name is used as the jar ID — it must not conflict with an existing dependency ID. The jar becomes available to all browsing and search tools. Use configure_study_jar to enable auto-include if you want it in default results.',

	list_study_jars:
		'List all study jars on a project with their names, file paths, auto-include status, and stats (package count, class count).',

	configure_study_jar:
		'Configure one or more study jars on a project. Currently supports setting the auto-include flag, which controls whether the jar appears in default tool results when the jars parameter is omitted. Accepts an array of names; fails on the first nonexistent name with no partial update.',
} as const;
