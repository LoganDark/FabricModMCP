---
slug: list-members-only-two
status: resolved
trigger: "list_members on large classes (StoredUserEntry, StoredUserList, ServerPlayer — 2311 lines) returns only 2 top-level members regardless of jar specification, making list_members nearly useless for API discovery"
created: 2026-05-26
updated: 2026-05-26
---

# Debug Session: list-members-only-two

## Scope

**In scope:** Root cause of why `list_members` returns only 2 top-level
members for large/well-populated classes in the lifesteal Fabric mod
project. Fix the underlying issue.

**Out of scope:** Other FEEDBACK.txt 2026-05-26 items (locate_in_source
cascade failures, search_symbols kind=method rejection, Yarn-vs-Mojmap
display, error-message wording). Track separately in a v1.7 milestone.

## Symptoms

Source: `FEEDBACK.txt` entries dated 2026-05-26T11:06 and 2026-05-26T11:28.
Treat as data.

<DATA_START>
2026-05-26 11:06 (cwd: /Users/LoganDark/Documents/Projects/lifesteal):
"list_members on ServerPlayer only returns 2 top-level members regardless
of jar specification, which seems like too few for a class with 2311
lines. This made it hard to discover methods without reading raw source."

2026-05-26 11:28 (cwd: /Users/LoganDark/Documents/Projects/lifesteal):
"list_members is severely limited for many classes. StoredUserEntry
returned only 2 members (should show getUser(), hasExpired(),
serialize()), StoredUserList returned only 2 (should show many more),
and ServerPlayer returned only 2 (for a 2311-line class). This makes
list_members nearly useless for API discovery — you have to fall back
to reading raw source."
</DATA_END>

## Current Focus

- hypothesis: **CONFIRMED root cause** — see Resolution section.
- status: resolved.

## Evidence

### evidence-1 (2026-05-26 06:00) — JDT LS reproduction

Spawned JDT LS directly against the lifesteal workspace
`/var/folders/.../mcp-jdtls-575fec1c-...` (already extracted by a
prior MCP server run). Sent `textDocument/didOpen` followed by
`textDocument/documentSymbol` for
`lifesteal--minecraft/net/minecraft/server/players/StoredUserEntry.java`.

**Raw response (3 separate didOpen/documentSymbol cycles, all
identical — NOT a workspace-warmup race):**

```
result type: array(len=2)
[
  {
    "name": "net.minecraft.server.players",
    "kind": 4,   // package
    ...
  },
  {
    "name": "StoredUserEntry<T>",
    "kind": 5,   // class
    "children": [
      { "name": "user", "kind": 8 },                       // field
      { "name": "StoredUserEntry(T)", "kind": 9 },         // constructor
      { "name": "getUser()", "kind": 6, "detail": " : T" }, // method
      { "name": "hasExpired()", "kind": 6, "detail": " : boolean" },
      { "name": "serialize(JsonObject)", "kind": 6, "detail": " : void" }
    ]
  }
]
```

The two top-level entries are: the **package declaration** (kind=4) and
the **class declaration** (kind=5). Class members appear as CHILDREN of
the class symbol, not as separate top-level entries. JDT LS's deliberate
hierarchical encoding for `hierarchicalDocumentSymbolSupport: true`.

Diagnostic script: `scripts/diagnose-list-members.ts` (kept for future
JDT LS diagnostics — runs against any pre-extracted MCP workspace).

### evidence-2 (deterministic across runs)

Three back-to-back `didOpen` → `documentSymbol` cycles (immediate, after
a 2-second sleep, and again immediate on a third open) all produced
byte-identical output. The "2 top-level members" pattern is NOT a
workspace-warmup or reconcile race — it is the steady-state shape of JDT
LS's reply for a Java file with a package declaration. Eliminates orig
hypotheses 1 (workspace race), 3 (outline stub), and 4 (wrong jar).

### evidence-3 — pipeline is innocent

`transformSymbolResponse` is a pure `Array.map(transformSymbol)` — no
filter, no slice. `enrichSymbols` is a pure
`Promise.all(symbols.map(enrichOne))`. `stripEnrichedSymbol` strips
DETAIL fields per `details` flag but never removes elements. Existing
12 list_members tests use single-class fixtures (no package symbol at
top level), which hid the user-visible "2" misnomer.

### evidence-4 — content[] body rendering vs summary perception

`renderMember` recursively renders every child, so under commit 6a4cdc4
the structured payload IS visible in `content[1].text`. The methods ARE
in the response. **But the summary string at content[0].text said
"Found 2 top-level members"** — technically true (LSP top level = package
+ class) but UX-misleading. The user reads only the summary and
concludes "list_members returned 2 members, nothing useful".

### evidence-5 — pre-6a4cdc4 builds had NO body block

Diff of 6a4cdc4 against list-members.ts shows the body block
(`if (stripped.length > 0) { content.push({…body…}); }`) was ADDED in
that commit. Prior to 6a4cdc4 the response was:

```
content: [{ type: 'text', text: 'Found 2 top-level members in ...' }]
```

— and the methods were literally invisible to any client reading only
content[*].text. At the user's FEEDBACK timestamps (2026-05-26 11:06
and 11:28 UTC = 04:06 and 04:28 PDT), commit 6a4cdc4 (made at 05:53
PDT) DID NOT YET EXIST. The user's MCP server was built from an even
older revision (they pulled but did not restart between fixes, per the
project CLAUDE.md observation about the read_source investigation).

## Eliminated

- **JDT LS workspace warmup race** (orig hypothesis 1) — eliminated by
  evidence-2 (deterministic across three back-to-back runs, including a
  2-second-wait variant).
- **transformSymbolResponse / enrichSymbols dropping members** (orig
  hypothesis 2) — eliminated by evidence-3 (pure map; no filter/slice;
  existing tests pass).
- **Outline / stub source jar** (orig hypothesis 3) — eliminated by
  inspecting the extracted file on disk (full source intact — `cat
  .../lifesteal--minecraft/.../StoredUserEntry.java` shows all 5
  members; the 440-byte size is correct for that small class).
- **Wrong jar selection (Mojmap-vs-Yarn confusion)** (orig hypothesis 4)
  — eliminated. The lifesteal project is unmapped (Mojmap), gradle-parser
  detects `mappingEra: 'unmapped'` from the absence of a `mappings(…)`
  line in build.gradle.kts, and loom-cache.ts finds the per-project jar
  at `.gradle/loom-cache/.../minecraft-merged-374c84699f-...-sources.jar`
  via the bare-prefix probe (added for newer Loom). The classes exist
  at the correct Mojmap paths inside that jar (verified by `unzip -l`
  and `unzip -p`).

## Resolution

- **root_cause:** Two-part problem.
  1. The summary string in `list-members.ts` reported `members.length`
     (count of LSP top-level DocumentSymbols, typically 2 = package +
     class), not the user-meaningful count of class-body members. JDT
     LS always returns Java files with `[Package, Class]` at the top
     level — the package declaration is a syntactic Java construct, not
     a class member, but `members.length` treats it as one.
  2. Compounded by a pre-6a4cdc4 build that emitted only the summary
     text and no rendered body block — the user saw "Found 2 top-level
     members" with no member list following it, and reasonably concluded
     the tool was broken. Commit 6a4cdc4 (rendered body block) made the
     methods visible, but the misleading summary remained.

- **fix:** in `src/tools/list-members.ts`:
  1. Added `isPackageSymbol` predicate and `CLASS_CONTAINER_KINDS` set.
  2. Filter the LSP top-level results: drop any symbol with `kind ==
     'package'` from both the structured `members` payload and the
     rendered body. The package declaration is Java syntax noise, not
     a class member.
  3. Added `countClassBodyMembers(symbols)` which sums children counts
     across all class-container top-level entries (class / interface /
     enum / struct). For a normal single-class file, this returns the
     count of fields + methods + constructors + inner classes — exactly
     what the user expects. Falls back to `symbols.length` when no class
     container is present (defensive — keeps non-Java or edge-case
     responses non-zero).
  4. Summary now reads `Found N member(s) in {class}` — no more
     misleading "top-level" phrasing.

- **verification:**
  - `pnpm vitest run tests/tools/list-members.test.ts` → 13/13 pass
    (12 existing + 1 new regression).
  - `pnpm vitest run` (full suite) → 73 files / 897 pass, 1 skip.
  - `pnpm exec tsc --noEmit` → clean.
  - New regression test `REGRESSION: drops top-level package symbol
    and counts class-body members` uses a fixture mirroring the live
    JDT LS response captured by scripts/diagnose-list-members.ts:
    `[Package, Class with 5 children]`. Asserts:
      - `envelope.data.members.length === 1` (class only, package
        filtered).
      - `content[0].text` matches `/^Found 5 members in /`.
      - body contains `getUser()`, `hasExpired()`, `serialize`.
      - body does NOT have `1. package net.minecraft…` (package
        dropped from rendering).

- **files_changed:**
  - `src/tools/list-members.ts` — filter package, count class-body
    members, update summary wording.
  - `tests/tools/list-members.test.ts` — update existing REGRESSION
    test regex (`top-level member` → `member`), add new
    `REGRESSION: drops top-level package symbol and counts class-body
    members` test mirroring live JDT LS reply.
  - `scripts/diagnose-list-members.ts` — diagnostic script that
    captured the live JDT LS reply; kept for future investigations.
  - `.planning/debug/resolved/list-members-only-two.md` — this
    session, archived.
