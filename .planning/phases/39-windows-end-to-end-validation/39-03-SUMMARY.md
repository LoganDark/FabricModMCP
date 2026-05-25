---
phase: 39
plan: "03"
subsystem: planning-artifacts
tags: [roadmap, housekeeping, unix-03, copy-paste-bug-fix]
dependency_graph:
  requires:
    - .planning/ROADMAP.md (with Phase 39 block + stale 36-0X Plans subsection at lines 181-185 pre-edit)
  provides:
    - .planning/ROADMAP.md (Phase 39 Plans subsection now lists actual 39-01..39-05 plans)
  affects:
    - /gsd:verify-phase 39 (verifier can now enumerate Phase 39 plans from ROADMAP without confusion)
tech_stack:
  added: []
  patterns:
    - "ROADMAP Plans subsection format: `**Plans**: N plans` header + `  - [ ] NN-NN-PLAN.md — <desc> (<reqs>)` per plan (two-space indent, em-dash with surrounding spaces, checkbox state)"
key_files:
  created: []
  modified:
    - .planning/ROADMAP.md
decisions:
  - "Header line uses bare `5 plans` (not `5 plans (4 original + 1 gap closure)`) because Phase 39 has 5 original plans and no gap closures have triggered yet. The `M original + K gap closure` annotation is reserved for follow-up commits if D-13 gap-closure plans get added later."
  - "All five checkboxes start `[ ]` (incomplete); the verifier (`/gsd:verify-phase`) will flip them to `[x]` post-verification per Phase 36-38 precedent."
metrics:
  duration: "~3 minutes"
  completed_date: "2026-05-25"
  tasks: 1
  files_modified: 1
  tests_passing: "869/869"
---

# Phase 39 Plan 03: Rewrite ROADMAP Phase 39 Plans Subsection — Summary

## One-Liner

Replaced the stale Phase 36 copy-paste in ROADMAP.md's Phase 39 Plans subsection with the actual five Phase 39 plans (39-01..39-05) in the established Phase 35-38 precedent format, eliminating RESEARCH.md Pitfall §5.

## Before / After

### Before (ROADMAP.md lines 181-185, pre-edit)

```
**Plans**: 5 plans (4 original + 1 gap closure)
  - [x] 36-01-PLAN.md — Create `src/platform/uri.ts` pure helper module + tests (WIN-03 / UNIX-02 foundation)
  - [x] 36-02-PLAN.md — Forward sweep (7 sites) + reverse sweep (1 site) across `client.ts`, `workspace-sync.ts`, `remove-project-member.ts`, `tool-helpers.ts` (WIN-03)
  - [x] 36-03-PLAN.md — `uri-mapper.ts` drive-letter case-fold (`prefixMatches` state machine) + internal `toFileUri` migration + Windows-mocked tests (WIN-05 / UNIX-02)
  - [ ] 36-04-PLAN.md — `workspace-sync.ts` hardening: ZIP split-and-spread + traversal guard + `rm` retry options + tests (WIN-04 / WIN-06 / WIN-07)
```

Five lines verbatim-copied from Phase 36's Plans subsection (lines 133-138) — a clear copy-paste artifact predating the Phase 39 discuss-phase cycle. The ROADMAP claimed Phase 39 was running Phase 36 plans, which is impossible (and would mislead the verifier).

### After (ROADMAP.md lines 181-186, post-edit)

```
**Plans**: 5 plans
  - [ ] 39-01-PLAN.md — Create `docs/WINDOWS-SUPPORT.md` with verbatim priority chains + known limitations + D-18 cross-reference footer (UNIX-03 / validation surface for WIN-* / JAVA-*)
  - [ ] 39-02-PLAN.md — Insert `### Platform Support` subsection into `CLAUDE.md` `## Technology Stack` with verbatim priority chains + D-18 footer (UNIX-03 / validation surface for WIN-* / JAVA-*)
  - [ ] 39-03-PLAN.md — Rewrite `.planning/ROADMAP.md` Phase 39 Plans subsection (replace stale Phase 36 copy-paste) (UNIX-03 housekeeping)
  - [ ] 39-04-PLAN.md — Human-executed 4-row Java-discovery matrix on Windows + evidence capture in `39-VERIFICATION.md` (validation: WIN-01..WIN-07, JAVA-01..JAVA-05, UNIX-02)
  - [ ] 39-05-PLAN.md — UNIX-03 regression sweep: full vitest suite green on macOS (and Linux if accessible) (UNIX-03)
```

Five Phase-39-specific plans (39-01..39-05) with:
- Header line `**Plans**: 5 plans` (no `M original + K gap closure` annotation — none triggered yet).
- Two-space indent, dash, space, checkbox `[ ]`, space, plan filename, em-dash with surrounding spaces (U+2014), description, parenthesized requirement / label annotation.
- All checkboxes `[ ]` (incomplete) — verifier flips post-verification per Phase 36-38 precedent.

## Surrounding Content — Unchanged

The edit is strictly localized to the Phase 39 Plans subsection (lines 181-185 pre-edit, 181-186 post-edit due to the extra bullet). Other Phase 39 content (Goal paragraph, Depends on, Requirements, Success Criteria 1-4) and adjacent phase blocks (Phase 35-38 and the Progress table) are untouched.

Verified via the plan's automated acceptance criteria:
- `grep -cE '^### Phase 3[5-9]:' .planning/ROADMAP.md` returns **5** (all phase H3 headings preserved).
- Inside the Phase 39 block (between `### Phase 39:` and `## Progress`), grep finds exactly one `**Plans**: 5 plans` header line.
- Inside the Phase 39 block, exactly 5 lines match `^  - \[ \] 39-0[1-5]-PLAN\.md — `.
- Inside the Phase 39 block, zero matches for `36-0[1-4]-PLAN\.md`.

## Verification

| Check | Command | Result |
|-------|---------|--------|
| Plans header line correct | `awk '/^### Phase 39:/,/^## Progress$/' .planning/ROADMAP.md \| grep -qE '^\*\*Plans\*\*: 5 plans$'` | ✓ |
| Exactly 5 Phase 39 plan bullets | `awk … \| grep -cE '^  - \[ \] 39-0[1-5]-PLAN\.md — '` returns `5` | ✓ |
| Zero stale `36-0X-PLAN.md` refs inside Phase 39 block | `! awk … \| grep -qE '36-0[1-4]-PLAN\.md'` | ✓ |
| Five `### Phase 3[5-9]:` H3 headings preserved | `grep -cE '^### Phase 3[5-9]:' .planning/ROADMAP.md` == 5 | ✓ |
| UNIX-03 regression guard | `pnpm test -- run` | ✓ 869/869 passed (1.55s) |

## Threat Model Compliance

| Threat ID | Disposition | Implementation |
|-----------|-------------|----------------|
| T-39-06 (Repudiation — ROADMAP claims about Phase 39 plans) | mitigate | Acceptance criteria assert exactly 5 `39-0[1-5]-PLAN.md` bullet lines AND zero `36-0[1-4]-PLAN.md` references inside the Phase 39 block. The `awk`-bounded grep prevents leaking edits into adjacent phase blocks. All passed. |
| T-39-07 (Tampering — adjacent phase blocks or Progress table modified) | mitigate | `grep -cE '^### Phase 3[5-9]:' .planning/ROADMAP.md == 5` confirms all five phase H3 headings preserved. The Edit tool's single `old_string`/`new_string` substitution by definition only modifies the matched region. |

## Deviations from Plan

None — plan executed exactly as written.

## Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Rewrite ROADMAP.md Phase 39 Plans subsection | c8279aa | .planning/ROADMAP.md |

## Self-Check: PASSED

- FOUND: .planning/ROADMAP.md (modified — verified via the four automated checks above)
- FOUND: c8279aa (`git rev-parse --short HEAD` after commit, confirmed in `git log`)
