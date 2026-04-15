# Phase 22: Verbosity Audit Report

**Date measured:** 2026-04-15
**Project under test:** CreatorCore/Template (Minecraft 1.21.11, Yarn 1.21.11+build.4, 53 dependencies)

## Methodology

All byte counts measured using `Buffer.byteLength(JSON.stringify(structuredContent))` on real tool call responses from an in-process MCP client/server pair connected to a loaded Minecraft Fabric project. The measurement script (`scripts/measure-verbosity.ts`) calls each audited tool twice: once with no `details` parameter (compact default) and once with the tool's detail flag set to `true` (full output). No numbers in this report are estimates -- all are actual measured values.

## Per-Tool Measurements

### ClientPlayerEntity (`net.minecraft.client.network.ClientPlayerEntity`)

| Tool | Compact Bytes | Full Bytes | Reduction | Fields Stripped | Detail Flag |
|------|--------------|------------|-----------|----------------|-------------|
| list_members | 33,079 | 62,967 | 47.5% | detail, parameters, returnType, fieldType, selectionRange, range.character | `details: { signatures: true }` |
| list_classes | 6,130 | 7,404 | 17.2% | access, modifiers, innerClasses | `details: { modifiers: true }` |
| search_classes | 328 | 362 | 9.4% | access, modifiers, innerClasses | `details: { modifiers: true }` |
| locate_in_source | 264 | 544 | 51.5% | steps, provenanceChains | `details: { steps: true }` |
| find_references | 13,247 | 106,871 | 87.6% | context, entryPath, provenanceChains | `details: { lineContent: true }` |
| find_definition | 452 | 710 | 36.3% | context, entryPath, provenanceChains | `details: { lineContent: true }` |
| find_implementations | 330 | 330 | 0.0% | context, entryPath, provenanceChains | `details: { lineContent: true }` |

### GameRenderer (`net.minecraft.client.render.GameRenderer`)

| Tool | Compact Bytes | Full Bytes | Reduction | Fields Stripped | Detail Flag |
|------|--------------|------------|-----------|----------------|-------------|
| list_members | 20,667 | 39,874 | 48.2% | detail, parameters, returnType, fieldType, selectionRange, range.character | `details: { signatures: true }` |
| search_classes | 309 | 343 | 9.9% | access, modifiers, innerClasses | `details: { modifiers: true }` |
| find_references | 1,538 | 9,412 | 83.7% | context, entryPath, provenanceChains | `details: { lineContent: true }` |
| find_definition | 431 | 697 | 38.2% | context, entryPath, provenanceChains | `details: { lineContent: true }` |

## Summary

| Metric | Value |
|--------|-------|
| Total compact bytes (all measurements) | 76,775 bytes |
| Total full bytes (all measurements) | 229,514 bytes |
| Overall reduction | 66.5% |

### Biggest wins by absolute bytes saved

1. **find_references (ClientPlayerEntity):** 93,624 bytes saved (87.6% reduction) -- context snippets for 161+ reference locations dominate response size
2. **list_members (ClientPlayerEntity):** 29,888 bytes saved (47.5% reduction) -- parameter/returnType/fieldType structures add up across 100+ members
3. **list_members (GameRenderer):** 19,207 bytes saved (48.2% reduction) -- same pattern, slightly fewer members
4. **find_references (GameRenderer):** 7,874 bytes saved (83.7% reduction) -- fewer references than ClientPlayerEntity but same proportional win

### Smallest wins

- **search_classes** (both benchmarks): 34 bytes saved (9.4-9.9%) -- search typically returns few results, and access/modifiers are small strings
- **find_implementations (ClientPlayerEntity):** 0 bytes saved -- no implementations found, so no results to strip

## Tools NOT Requiring Details Params

These tools were already compact and did not need verbosity reduction:
- **list_packages** -- returns package names and class counts only
- **type_hierarchy** -- returns ClassReference arrays (name, fqn, kind)
- **search_symbols** -- returns SymbolInformation-derived results, already minimal

## Detail Flag Reference

| Tool Category | Detail Flag | What It Restores |
|---------------|------------|-----------------|
| Navigation (find_references, find_definition, find_implementations) | `details: { lineContent: true }` | context snippets, entry paths, provenance chains |
| Locate (locate_in_source) | `details: { steps: true }` | cascade regex step details, provenance chains |
| Member listing (list_members) | `details: { signatures: true }` | parameter types, return types, field types, LSP detail strings, selection ranges, full range with characters |
| Class listing (list_classes, search_classes) | `details: { modifiers: true }` | access level, modifiers array, inner class listings |

## Conclusion

The compact-by-default approach reduces total structured response size by 66.5% across the benchmark classes. The most impactful reduction is on `find_references`, where context snippets account for up to 87.6% of the response -- stripping them by default brings ClientPlayerEntity references from 106,871 bytes down to 13,247 bytes. The `list_members` tool sees a consistent ~48% reduction by omitting parameter/return type structures that are only needed when examining signatures in detail.

Both ClientPlayerEntity (33,079 bytes compact) and GameRenderer (20,667 bytes compact) member listings now fit comfortably within Claude Code's response handling, where previously the full responses (62,967 and 39,874 bytes respectively) risked context window pressure. The agent can opt into full detail for specific tools when needed, keeping the default interaction lightweight.
