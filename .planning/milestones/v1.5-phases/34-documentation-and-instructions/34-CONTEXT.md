# Phase 34: Documentation & Instructions - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Update all documentation and instructions to accurately describe the server's final state after phases 28-33. All tool descriptions, SERVER_INSTRUCTIONS, and CLAUDE.md must match actual behavior.

</domain>

<decisions>
## Implementation Decisions

### SERVER_INSTRUCTIONS approach
- Add all detail thoroughly first, then distill down for clarity
- Completeness over brevity — agents have large context windows
- New sections to add:
  1. **JDT LS** — explain what it is, how to check availability, which tools require it
  2. **Response envelope** — document `{ ok, data }` / `{ ok, code, message, tried, suggestions }` structure
  3. **Study jar workflow** — add_study_jar → configure_study_jar → list_study_jars
  4. **Scope dual effect** — namespace resolution AND jar filtering when scoped
  5. **Refresh guidance** — when to use refresh_project/refresh_project_members, that they re-parse build files
  6. **configure_filters** — mention it exists and what it does
- Fix existing text:
  - Step 1: "(or use the 'default' project)" → clarify default project is pre-created at startup
  - Step 4: search → read_member pipeline is misleading (needs list_members in between)
  - Scope section: document that scope also restricts jar search, not just ID resolution

### DOC-01: JDT LS per-tool documentation
- Add "Requires JDT LS (Java 21+ and JDTLS_HOME)." to each of these 8 tools' TOOL_DESCRIPTIONS:
  - list_members, read_member, find_definition, find_references, find_implementations, get_symbol_info, search_symbols, type_hierarchy
- Keep it brief per-tool — the detail lives in SERVER_INSTRUCTIONS

### DOC-04: Individual tool description fixes (from audit)
- locate_in_source: document that matched text is available via `details.steps` (each step has `matched` field)
- list_study_jars: remove "total entries" claim (field doesn't exist in stats)
- create_project: mention JDT LS initialization happens here, response includes jdtlsAvailable
- read_member: show field FQN format with trailing colon (e.g., `Class#field:`)
- type_hierarchy: document depth:0 returns no subtypes, supertype chain is fully traversed regardless of depth
- set_active_child: reword to accurately describe behavior (only affects bare ID namespace resolution, not jar filtering scope)
- configure_filters: fix pattern example from `"net.fabricmc.*"` to `"net.fabricmc.fabric-api:*"`
- search_symbols: note that field search is not supported (field kind removed in Phase 30)
- add_study_jar: document that name must not conflict with existing dependency IDs
- search_classes: update to reference `query` param (renamed in Phase 30)
- remove_project_member: update to reference `names` param (renamed in Phase 30)

### DOC-05: CLAUDE.md
- Fill in Architecture section with current layered structure (domain → tool pattern)
- Fill in Conventions section (tab indentation, no nested JSON, descriptions in descriptions.ts, PARAMS/DETAIL_PARAMS)
- Fill in Project Structure section with directory layout
- Remove stale "Phase 2" references in Alternatives table
- Update SDK version timeline prediction (stale "v2 anticipated Q1 2026")
- Update ts-lsp-client confidence to HIGH
- Fill in empty Runtime Dependencies, Installation, Key Technical Details sections (or remove empty headers)

### Claude's Discretion
- Exact wording of all documentation changes
- How to organize the new SERVER_INSTRUCTIONS sections
- Level of detail in CLAUDE.md sections

</decisions>

<specifics>
## Specific Ideas

- Write all SERVER_INSTRUCTIONS additions thoroughly first, then review for conciseness
- For JDT LS per-tool notices, use a consistent short sentence: "Requires JDT LS. Returns JDTLS_NOT_AVAILABLE if unavailable."
- The stale `getResolvedDependencies` import in tool-helpers.ts (flagged by Phase 32 verifier) can be cleaned up in this phase as a bonus

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### SERVER_INSTRUCTIONS and tool descriptions
- `src/tools/descriptions.ts` — ALL text lives here. This is the primary file for this phase.

### Tool files to cross-reference (verify descriptions match actual schemas)
- `src/tools/list-members.ts` — JDT LS check, schema
- `src/tools/read-member.ts` — JDT LS check, FQN format
- `src/tools/find-definition.ts` — JDT LS check, pagination response
- `src/tools/find-references.ts` — JDT LS check, pagination response
- `src/tools/find-implementations.ts` — JDT LS check, pagination response
- `src/tools/get-symbol-info.ts` — JDT LS check, response shape (no javadoc field now)
- `src/tools/search-symbols.ts` — JDT LS check, no field kind, no default limit
- `src/tools/type-hierarchy.ts` — JDT LS check, depth semantics, ClassReference with jar
- `src/tools/locate-in-source.ts` — steps with matched field
- `src/tools/list-study-jars.ts` — stats fields
- `src/tools/create-project.ts` — JDT LS init, response fields
- `src/tools/set-active-child.ts` — actual behavior vs description
- `src/tools/configure-filters.ts` — pattern format
- `src/tools/search-classes.ts` — renamed to query, z.enum kind
- `src/tools/remove-project-member.ts` — renamed to names
- `src/tools/add-study-jar.ts` — name collision behavior
- `src/tools/refresh-project.ts` — re-parses build files now
- `src/tools/refresh-project-members.ts` — re-parses build files now

### CLAUDE.md
- `./CLAUDE.md` — empty sections to fill, stale references to fix

### Audit findings (comprehensive list)
- `.planning/AUDIT-FINDINGS.md` — D1-D15 items with exact descriptions of what to fix

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- All tool descriptions are in `TOOL_DESCRIPTIONS` object in descriptions.ts — single location to update
- `SERVER_INSTRUCTIONS` is a template literal string — easy to extend

### Established Patterns
- Tool descriptions are concise (1-3 sentences) with key behavior notes
- SERVER_INSTRUCTIONS uses markdown headers for sections
- CLAUDE.md follows a standard template with Technology Stack, Conventions, Architecture sections

### Integration Points
- descriptions.ts is imported by every tool file — changes here affect all tools at once
- CLAUDE.md is read by Claude Code on every conversation start — accuracy directly affects agent behavior

</code_context>

<deferred>
## Deferred Ideas

- Clean up stale `getResolvedDependencies` import in tool-helpers.ts (cosmetic, flagged by Phase 32 verifier)

</deferred>

---

*Phase: 34-documentation-and-instructions*
*Context gathered: 2026-04-16*
