# Phase 36 — Discussion Log

**Discussion gathered:** 2026-05-15
**Mode:** advisor (ADVISOR_MODE=true, calibration=standard, NON_TECHNICAL_OWNER=false)

This log is for audit and retrospective use. Downstream agents (researcher, planner) read `36-CONTEXT.md`, not this file.

## Gray areas presented

| # | Area | User selected |
|---|------|---------------|
| 1 | Helper extraction strategy | All four for discussion |
| 2 | Drive-letter case normalization | All four for discussion |
| 3 | ZIP traversal rejection mechanism | All four for discussion |
| 4 | EBUSY retry organization | All four for discussion |

## Advisor research

Spawned 4 parallel `gsd-advisor-researcher` agents (model: opus) for the selected areas. Each returned a 3-option comparison table + rationale. Synthesis is in `36-CONTEXT.md` and the user-facing tables were rendered in the discussion turn.

## Decisions captured (table-first picks)

### Q1 — Helper extraction strategy
- **Options presented:** A. Inline `node:url` at every site / B. New `src/platform/uri.ts` sibling (Recommended) / C. Extend `src/platform/index.ts`
- **User pick:** **B. New `src/platform/uri.ts`**
- **Notes:** No clarifying notes added; pick aligned with the recommended option.
- **Locked decisions:** D-01, D-02, D-03

### Q2 — Drive-letter case normalization in `uri-mapper.ts`
- **Options presented:** A. Normalize-on-store / B. Normalize-on-compare, Windows-only (Recommended) / C. Both
- **User pick:** **B. Normalize-on-compare**
- **User notes:** *"normalize on compare. remember windows does not only have drive letters but also UNC."*
- **Follow-up clarifications from user (unprompted, three further messages):**
  1. "don't assume case insensitivity on windows. only actual drive letters are case insensitive."
  2. "file://... is not a thing on windows. there are only drive letter such as C:\\... and UNC such as \\\\system07\\C$\\... absolutely everything except the drive letter itself should be treated as completely case sensitive, you can't assume which file system they are using."
  3. "there is no need to check for canonical path equivalence, only semantic equivalence (so by string is fine)."
  4. "you may still need to translate to/from file:// for JDT-LS but there is no need to expose that to the user. everything inside the jar is addressed by unix path and windows paths are only used for the locations of jars on disk and locations of project directories on disk"
  5. "oh and DOS device paths such as \\\\.\\C:\\... or \\\\.\\Volume{b75e2c83-0000-0000-0000-602f00000000}\\..."
  6. "also \\\\?\\"
- **Locked decisions:** D-04 through D-11. The user's clarifications materially refined the implementation:
  - Case-fold is **surgical** — the single ASCII drive letter only (D-08, D-09).
  - UNC, DOS device, and `\\?\` forms compare byte-exact (D-11).
  - No `fs.realpath` / `GetFinalPathNameByHandle` / symlink resolution (D-10).
  - `file://` URIs are JDT-LS translation-layer only; tool API is Unix-shaped (D-04, D-05, D-07).
  - Windows path forms in scope at the disk layer: drive-letter, UNC, DOS device drive, DOS device volume GUID, Win32 file namespace `\\?\` (D-06).

### Q3 — ZIP traversal rejection
- **Options presented:** A. Pre-join segment scan / B. Post-resolution descendant check (Recommended) / C. Both
- **User pick:** **B. Post-resolution descendant check**
- **User notes:** *"post-resolution check is fine. keep unix conventions for all tools. jar entries are identified by unix path; jar paths are specified with unix paths; the only places where windows paths are ever used or returned are locations on the actual disk."*
- **Locked decisions:** D-04 / D-05 (the Unix-conventions-for-tool-API rule, escalated from this answer); D-12 through D-16.

### Q4 — EBUSY retry organization
- **Options presented:** A. Native `fs.rm` options at 4 sites (Recommended) / B. New `src/platform/fs.ts` helper / C. Local helper in workspace-sync.ts
- **User pick:** **A. Native `fs.rm` options**
- **Notes:** No clarifying notes; aligned with recommendation.
- **Locked decisions:** D-17, D-18, D-19, D-20

## Ground-truth findings during discussion

Beyond the questions, two facts were verified by grep/Read during the discussion turn and folded into the context:

1. **`workspace-sync.ts` extraction sites at lines 40 and 184 DO write real `.java` files to disk** (via `await writeFile(targetPath, content)`), not only `.classpath` metadata. This makes the traversal guard load-bearing, not theoretical. (Corrected my prompt context to the ZIP-traversal advisor.)

2. **`gradle-parser.ts:36` `fileUriToPath` is semantically divergent from `node:url`'s `fileURLToPath`** — it strips the two-slash `file://` form Gradle emits in `repositories { url 'file://~/.m2/...' }`, and substitutes `~/` with `homedir()`. Replacing it would break Gradle parsing. Locked as OUT OF SCOPE for the Phase 36 sweep.

## Deferred ideas

| Idea | Reason |
|------|--------|
| Long-path UNC `\\?\` opt-in conversion | REQUIREMENTS.md already excludes (Node 22 opts in already; defer until empirically observed) |
| Canonical-path probing / symlink resolution | Explicitly rejected by user — "only semantic equivalence (so by string is fine)" |
| `isFileUri(uri: string): boolean` convenience helper | Add only if a callsite needs it during planning |

## Universal-anti-pattern checks (sanity)

- ✓ No scope creep — discussion stayed within the audit boundary; no new capabilities proposed
- ✓ User-visible API unchanged — D-07 explicitly forbids exposing `file://` URIs in tool surface
- ✓ Unix byte-identical guardrail preserved — D-19 verifies `fs.rm` retry options are no-ops on Unix first-try success; D-25 reframes UNIX-02 as round-trip identity (path→URI→path), not URI-string identity with v1.5 (the two-slash → three-slash change is unavoidable when switching to `pathToFileURL`)
- ✓ Defense surfaces (case-fold, traversal guard) are narrowly defined — only the bytes/operations the user explicitly authorized
