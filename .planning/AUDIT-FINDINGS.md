# Comprehensive Audit Findings — 2026-04-15

Decisions made during review. Grouped by category for milestone planning.

## Documentation & Instructions Fixes

### D1. Document JDT LS requirement per-tool
- Each of the 8 JDT LS tools gets "Requires JDT LS" in its TOOL_DESCRIPTION
- Add brief explanation of JDT LS in SERVER_INSTRUCTIONS shared concepts
- Tools: list_members, read_member, find_definition, find_references, find_implementations, get_symbol_info, search_symbols, type_hierarchy

### D2. Document response envelope structure
- Add to SERVER_INSTRUCTIONS: `{ ok: true, data: {...} }` / `{ ok: false, code, message, tried, suggestions }`

### D3. Fix `read_jar_entry` error referencing non-existent `listEntries`
- Change suggestion to reference `list_packages` and `list_classes`

### D4. Document `scope` dual effect (namespace resolution + jar filtering)
- Add to SERVER_INSTRUCTIONS scope section

### D5. Add study jar workflow to SERVER_INSTRUCTIONS

### D6. Fix `locate_in_source` description — matched text IS available via details.steps
- Document that steps include `matched` field when `details.steps: true`

### D7. Fix `configure_filters` pattern example
- Change `"net.fabricmc.*"` to `"net.fabricmc.fabric-api:*"`

### D8. Fix `list_study_jars` description claiming "total entries" (field doesn't exist)
- Remove "total entries" from description

### D9. Fix SERVER_INSTRUCTIONS "(or use the 'default' project)" phrasing
- Clarify the default project is pre-created at startup, not special

### D10. Fix `add_study_jar` missing provenance metadata in makeSuccess

### D11. Document `read_member` field FQN trailing colon format in description

### D12. Document `type_hierarchy` depth:0 returns no subtypes

### D13. Document supertype chain traversed fully (depth only controls subtypes)

### D14. Fix `create_project` description — mention JDT LS initialization happens here

### D15. Fix CLAUDE.md empty sections (Architecture, Conventions, etc.)
- Fill in architecture, conventions, remove stale Phase references

## Code Fixes

### C1. Unify pagination — add both `limit` and `hasMore` to all paginated tools
- search_classes and search_symbols need `hasMore`
- find_references/find_implementations/find_definition need `limit` in response

### C2. Remove `field` from search_symbols kind enum + document field search not supported

### C3. Remove always-empty `javadoc` field from get_symbol_info, leave TODO comment

### C4. Implement build file re-parsing in refresh_project/refresh_project_members
- Re-read gradle.properties, build.gradle.kts, fabric.mod.json on refresh

### C5. Fix multi-mod filter: each child should have its own filtered jar set, not merged
- getDependenciesForTool without scope should return per-child results merged with proper provenance, not apply one mod's filter to all

### C6. Fix `remove_project` to evict entryIndexCache for all project jars

### C7. Clean up JDT LS data directory on exit/termination signals

### C8. Prevent JarReader.getHandle() race condition (avoid await in critical path)

### C9. Add cycle detection to type_hierarchy supertype walk

### C10. Fix inner class FQN handling in read_source (strip $Inner to find outer class file)

### C11. Fix syncFabricModToWorkspace partial extraction cleanup (clean up files on error)

### C12. Expose JDT LS status in get_project_info response

### C13. Expose GradleConfig.dependencies in get_member_info mod metadata

### C14. Add jar locations to type_hierarchy ClassReference output

### C15. Add FQN to list_members compact output for inner class entries

### C16. Rename search_classes `pattern` to `query` (still glob, not cascading regex)

### C17. Rename remove_project_member `members` param to `names` (match configure_study_jar)

### C18. Remove search_symbols default limit (return all by default like other tools)

### C19. Fix search_classes kind filter — add z.enum validation

## Future Considerations (Document for Later)

### F1. FQN-based navigation shortcut for LSP tools
- Feasible per research: read_member already resolves FQN→position
- Would add optional `memberFqn` param as alternative to `match` patterns
- Recommended approach: separate `resolveSymbolPositionFromFqn()` function

### F2. Annotation-based search
- Annotations ARE in extracted source already (JDT LS ranges include them)
- Feasible via regex post-processing of extracted source
- Best approach: add `extractAnnotations()` utility, expose in list_members
- NOT feasible at search_classes level without major performance hit (full file reads)

### F3. Server health/diagnostic tool
- Would show: open jar count, JDT LS status per project, cache sizes, workspace sync status

### F4. Batch operations (read_sources, batch list_members)

### F5. FQN input for inner class read_source (dot notation tolerance)
