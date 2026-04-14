/**
 * Centralized tool descriptions, server instructions, and shared parameter schemas.
 *
 * All MCP-facing text lives here so it's easy to review, refactor,
 * and keep consistent across the 21 tools.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Server-level instructions (sent during MCP initialize handshake)
// ---------------------------------------------------------------------------

export const SERVER_INSTRUCTIONS = `\
MinecraftDevMCP — deep access to Minecraft mod development internals for Fabric/Loom projects. \
Browse decompiled source, navigate dependencies, and use semantic Java analysis \
(go-to-definition, find-references, type hierarchy) to understand Minecraft internals and write Mixins.

## Workflow

1. Load a project with load_project (path to a Fabric mod's root directory)
2. Browse: list_packages → list_classes → list_members → read_source
3. Search: search_classes (by name pattern) or search_symbols (by any symbol name)
4. Navigate: find_definition, find_references, find_implementations, get_symbol_info, type_hierarchy

## Shared Concepts

**project parameter**: Most tools accept an optional \`project\` name. Omit it when only one project is loaded or a default is set via set_default_project.

**Class names** use fully-qualified dot notation: \`net.minecraft.client.MinecraftClient\`, \`net.minecraft.world.World\`.

**Jar IDs** identify source jars. Special IDs: \`"minecraft"\` (merged Minecraft sources), \`"src"\` (the mod's own source). \
Dependencies use Maven coordinates: \`"net.fabricmc.fabric-api:fabric-resource-loader-v0"\`. \
Use get_project_metadata with include_jar_inventory to see all available jars.

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

**Mapping eras**: Projects are either \`mapped\` (Yarn-deobfuscated names like MinecraftClient, getBlockState) \
or \`unmapped\` (Mojang's unobfuscated names in newer versions). This affects which source jar format is used.`;

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
} as const;

// ---------------------------------------------------------------------------
// Tool descriptions
// ---------------------------------------------------------------------------

export const TOOL_DESCRIPTIONS = {
	// -- Project management --------------------------------------------------

	echo:
		'Echo back the input. For testing and debugging only.',

	load_project:
		'Load a Fabric/Loom Gradle project. Parses gradle.properties and build.gradle.kts to detect Minecraft version, Yarn mappings, and dependencies. Locates the Minecraft merged sources jar and all dependency source jars in the Gradle cache. Run this before using any other tools.',

	unload_project:
		'Unload a project by name. Closes jar handles and frees resources. Clears the default project if this was it.',

	list_projects:
		'List all loaded projects with name, Minecraft version, mapping era, dependency count, and which is the default.',

	set_default_project:
		'Set the default project used when the project parameter is omitted in other tools.',

	get_project_metadata:
		'Get structured project metadata in three toggleable sections: projectInfo (Minecraft version, Yarn mappings, loader version, Fabric API version, mapping era), modInfo (everything from fabric.mod.json — id, name, authors, mixins, dependencies, etc.), and jarInventory (all source jars with Maven coordinates, category, availability, and file size). Omitting all flags returns all sections.',

	// -- Configuration -------------------------------------------------------

	configure_filters:
		'Filter which dependency jars appear in browsing and search results. In include-all mode (default), glob patterns define jars to EXCLUDE. In exclude-all mode, patterns define jars to INCLUDE. The "minecraft" and "src" jars are always included. Patterns match jar IDs (e.g., "net.fabricmc.*" to match all Fabric API modules).',

	refresh_dependencies:
		'Re-scan for dependency source jars in the Gradle cache. Use after running ./gradlew downloadSources or changing build.gradle dependencies. Does not re-parse the Gradle config — use unload_project + load_project for that.',

	// -- Browsing ------------------------------------------------------------

	list_packages:
		'List Java packages across source jars. Drill into a parent package with the `package` parameter, control nesting depth, and filter by jar. Returns package names with class counts. Start here to explore unfamiliar code top-down.',

	list_classes:
		'List classes in a package with metadata: simple name, FQN, kind (class/interface/enum/record/@interface), access level, modifiers (abstract/final/static/sealed), which jars contain it, and inner classes. Filter by jar or include sub-packages with depth.',

	search_classes:
		'Search for classes by glob pattern against fully-qualified names. Use * for one name segment, ** to cross package boundaries. Case-insensitive by default. Examples: "*Client" finds MinecraftClient, "net.minecraft.block.*" lists that package, "**.*Registry" finds registries anywhere. Filterable by kind and jar. Paginated.',

	list_members:
		'List all members of a Java class as a structured tree: fields (with types), methods (with full parameter and return type signatures), constructors, enum constants, and inner classes. Each member includes its kind, line range, and nested children. Use this to understand a class\'s API before reading its source — especially useful for identifying Mixin targets.',

	read_source:
		'Read the full Java source of a class by FQN. When no jar is specified, returns source from every jar containing the class, with provenance labels. Use list_members first to understand structure, then read_source for implementation details.',

	read_member:
		'Read the source of a specific method, constructor, or field by its member FQN (e.g., net.minecraft.client.MinecraftClient#tick()). Returns the full declaration including Javadoc, annotations, signature, and body. When multiple overloads share the same FQN, returns all of them as separate entries. Get FQNs from list_members or search_symbols output.',

	read_jar_entry:
		'Read any file from a source jar by its internal path (slash-separated, e.g. "net/minecraft/client/MinecraftClient.java"). Unlike read_source which takes a class FQN, this takes a raw entry path — useful for non-Java files or when you know the exact path.',

	// -- Position ------------------------------------------------------------

	locate_in_source:
		'Find a precise character position in Java source using cascading regex patterns. Returns offset, line, column, and matched text. Searches all jars containing the class unless a specific jar is given. This is the building block used by the LSP navigation tools — use it directly only when you need raw position data. Optionally include surrounding context lines with the context parameter — useful for seeing the matched line in context without reading the full source.',

	// -- LSP navigation ------------------------------------------------------

	find_definition:
		'Go-to-definition for a symbol located by cascading regex patterns. Returns definition location(s) with source jar provenance and a code snippet showing surrounding context. Works across jar boundaries — e.g., navigate from a method call in mod source to its definition in Minecraft source.',

	find_references:
		'Find all usages of a symbol located by cascading regex patterns across all source jars. Each result includes jar provenance and a context code snippet. Use to understand how a method/field/class is used — critical for assessing impact before writing Mixins.',

	find_implementations:
		'Find implementations of an interface method, abstract method, or type located by cascading regex patterns. Returns implementing locations with provenance and code snippets. Use to find concrete implementations — e.g., "what classes implement Inventory?" or "who overrides tick()?".',

	get_symbol_info:
		'Get hover information (type signature, Javadoc, metadata) for a symbol located by cascading regex patterns. Returns raw markdown from JDT LS. Use to check a symbol\'s type or read its documentation without navigating to its definition.',

	search_symbols:
		'Search for Java types (classes, interfaces, enums) and methods/constructors by name across the entire workspace using JDT LS. Unlike search_classes which matches class names from the jar index, this finds symbols semantically via the language server. Fields are NOT searchable via this tool (use list_members on a specific class instead). Filterable by kind. Paginated.',

	type_hierarchy:
		'Get the type hierarchy for a class: supertype chain (extends lineage and implements list, separated) and subtypes to configurable depth. Returns ClassReferences (name, FQN, kind) for each entry. Essential for understanding Mixin targets — e.g., finding what a class extends, what interfaces it implements, or what classes extend it.',

	// -- Study jar management -----------------------------------------------

	add_study_jar:
		'Add a source jar to a project for study. Provide a file path to a sources JAR and an optional name (auto-derived from filename if omitted). The jar becomes available to all browsing and search tools. Use configure_study_jar to enable auto-include if you want it in default results.',

	remove_study_jar:
		'Remove one or more study jars from a project by name. Closes jar handles and evicts cached data. Accepts an array of names; fails on the first nonexistent name with no partial removal. Use list_study_jars to see current names.',

	list_study_jars:
		'List all study jars on a project with their names, file paths, auto-include status, and stats (package count, class count, total entries).',

	configure_study_jar:
		'Configure one or more study jars on a project. Currently supports setting the auto-include flag, which controls whether the jar appears in default tool results when the jars parameter is omitted. Accepts an array of names; fails on the first nonexistent name with no partial update.',
} as const;
