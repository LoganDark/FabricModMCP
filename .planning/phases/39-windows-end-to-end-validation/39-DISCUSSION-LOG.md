# Phase 39: Windows End-to-End Validation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-24
**Phase:** 39-windows-end-to-end-validation
**Areas discussed:** Smoke test scope & evidence, README scope, Failure-handling protocol, CLAUDE.md priority-chain update
**Mode:** advisor (`$HOME/.claude/get-shit-done/USER-PROFILE.md` present); calibration tier `standard`; `NON_TECHNICAL_OWNER = false`
**Research agents:** 4 parallel `gsd-advisor-researcher` agents spawned, one per gray area

---

## Area 1 — Smoke test scope & evidence

Three sub-decisions: target mod, sequence, evidence format.

### Sub-decision 1a: Target mod

| Option | Description | Selected |
|--------|-------------|----------|
| Fabric example mod template | Official `fabricmc/fabric-example-mod`. Minimal, designed for first-time Loom users. Cross-mod test requires scaffolding a second module. | |
| Sodium / Lithium / Iris (real third-party) | Real-world stress: thousands of references, deep Minecraft API, Mixins. Risk: third-party build break conflates with FabricModMCP bugs. | |
| Self-scaffolded minimal mod | Fully controlled. Maintenance burden as Loom evolves; no upstream support. | |
| Fabric example mod + hand-authored sibling mod that imports from it | Official baseline + controlled cross-mod scenario. Reproducible Windows-checkpoint fixture. | ✓ (recommended; accepted) |

### Sub-decision 1b: Test sequence

| Option | Description | Selected |
|--------|-------------|----------|
| Minimum-viable happy path only | 4 tool calls (`create_project` → `add_fabric_mod` → `find_definition` → `find_references`). Doesn't satisfy criterion 1's 4-entry-point requirement. | |
| Happy path × Java-discovery matrix | 4× happy-path runs, one per Java-discovery entry point. Covers criterion 1 exhaustively; requires env-cleanup between runs. | ✓ (recommended; accepted) |
| Full tool surface sweep | Every MCP tool, not just happy path. Scope creep — URI sweep + macOS/Linux unit tests already cover non-critical-path tools. | |

### Sub-decision 1c: Evidence capture format

| Option | Description | Selected |
|--------|-------------|----------|
| Full report markdown (`39-VALIDATION-REPORT.md` with screenshots + transcripts + env block) | Auditable, reproducible, future regression diff target. Most effort. | (Recommended by advisor; rejected by user) |
| Checkbox-only manifest | Fastest. No evidence — six months out, can't diff against future runs. | ✓ (selected — D-06/D-07/D-08) |
| Terse pass/fail + key excerpts in existing verification doc | Lightweight; captures load-bearing output. Misses environment metadata. | |

**User's choice:** Checkbox-only manifest (overrode advisor recommendation).
**Notes:** User explicitly accepted the future-regression-triage cost tradeoff. Evidence lives in `39-VERIFICATION.md` per established phase convention; environment block + per-row JDT LS spawn line + result counts retained as minimum forensic floor.

---

## Area 2 — README scope

| Option | Description | Selected |
|--------|-------------|----------|
| (a) Full v1.6 README from scratch + Windows section | Professional first impression; satisfies criterion. Scope explosion for a validation phase; sections (tool reference, contributing) will go stale. | |
| (b) Standalone `docs/WINDOWS-SUPPORT.md` only, no README | Tightest scope. Violates criterion wording ("README has a Windows Support section"); requires ROADMAP reword. | ✓ (selected) |
| (c) Stub README pointing at CLAUDE.md + REQUIREMENTS.md | Minimal write effort, satisfies criterion literally. "Read CLAUDE.md" is a poor first-touch UX; looks abandoned on GitHub/npm. | |
| (d) Lean README — overview + install + Claude Code MCP config snippet + Windows Support section + pointer to CLAUDE.md | Satisfies criterion natively; gives new users minimum needed; keeps CLAUDE.md as deep-dive ref. | (Recommended by advisor; rejected by user) |

**User's choice:** Option (b), standalone `docs/WINDOWS-SUPPORT.md`. Requires reword of ROADMAP success criterion 4.
**Notes:** Follow-up question confirmed user wants the ROADMAP success criterion reworded rather than the docs/WINDOWS-SUPPORT.md choice papered over with a stub README. Three ROADMAP edits applied as part of this CONTEXT.md commit (D-12). Full README creation deferred to v1.7+.

---

## Area 3 — Failure-handling protocol

| Option | Description | Selected |
|--------|-------------|----------|
| (a) Fix-in-place — all gap closures inside Phase 39 | Matches Phase 36/37 4+1 precedent. Right for 0-2 localized bugs; balloons indefinitely otherwise. | (Default tier of selected hybrid) |
| (b) Always spawn Phase 40 for any findings | Hard split. Heavy ceremony for one-liner fixes; rigorous milestone boundaries. | |
| (c) Triage-driven hybrid | Small fixes fold into 39, large findings spawn Phase 40. Matches established "gap closure vs new phase" heuristic. | (Pre-authorized escalation tier of selected hybrid) |
| (d) Document as known issues, ship v1.6, fix in v1.7 | Lowest velocity hit; credibility cost for milestone branded "Windows Support". | |
| **Hybrid: (a) by default, pre-authorized escalation to (c) if any single finding > gap-closure plan** | Combines (a) + (c). Default fix-in-place; escalate when a finding needs its own discuss-phase cycle. | ✓ (recommended; accepted) |

**User's choice:** Hybrid: (a) default + pre-authorized escalation to (c).
**Notes:** Threshold for escalation is "needs its own discuss-phase," not bug count or severity in isolation. Document-as-known-issue (d) explicitly NOT acceptable except for genuinely-environmental edge cases that go in `docs/WINDOWS-SUPPORT.md` "Known limitations" with workarounds.

---

## Area 4 — CLAUDE.md priority-chain update

### Initial choice

| Option | Description | Selected |
|--------|-------------|----------|
| (a) Inline both chains as new "Platform Support" subsection under Technology Stack | Fresh session sees chain immediately. +30-50 lines context burn every session. | ✓ (selected — overrode advisor recommendation) |
| (b) Add chains inside existing "Java Language Server Integration" + new "Java Runtime Detection" subsections | Stays within existing taxonomy. Stretches 5-column table format awkwardly. | |
| (c) Single-paragraph pointer to REQUIREMENTS.md WIN-01/WIN-02 + JAVA-01/JAVA-02 | DRY, smallest context burn, matches terse-direct profile. | (Recommended by advisor; rejected by user) |
| (d) Top-level "Platform Support" section parallel to Technology Stack | Promotes platform support to first-class. Largest context burn. | |

**User's choice:** Option (a), inline both chains as new subsection. Overrode advisor's DRY/context-economy recommendation in favor of discoverability.

### Follow-up: placement

| Option | Description | Selected |
|--------|-------------|----------|
| New `## Platform Support` subsection inside the existing `## Technology Stack` (under it, not parallel) | Sibling to existing subsections like "Language & Runtime", "MCP Framework". | ✓ |
| New top-level `## Platform Support` section parallel to `## Technology Stack` | Promotes to first-class concern. Larger context burn but most discoverable. | |
| Append to existing "Key Technical Details" section as a new subsection | Narrative prose style instead of tables. | |

**User's choice:** Subsection inside Technology Stack.
**Notes:** Drift-mitigation cross-references mandated (D-18) — both CLAUDE.md `## Platform Support` and `docs/WINDOWS-SUPPORT.md` end with a "Source of truth: REQUIREMENTS.md WIN-01/WIN-02/JAVA-01/JAVA-02. Implementation: java-discovery.ts + client.ts" footer.

---

## Claude's Discretion

- `docs/WINDOWS-SUPPORT.md` length and tone (suggested: 80-150 lines, technical-but-not-exhaustive).
- Format of priority chains in CLAUDE.md (numbered list vs table — numbered list likely cleaner for chain-shaped content).
- Section ordering inside `docs/WINDOWS-SUPPORT.md` (suggested: install pre-reqs → Java chain → JDT LS chain → known limitations).
- Whether to add a `CHANGELOG.md` entry (none currently exists; not blocking).
- ROADMAP Phase 39 "Plans" subsection cleanup (currently lists Phase 36 plans — copy-paste bug; planner will rewrite during `/gsd:plan-phase 39`).

## Deferred Ideas

- Full v1.6 README.md — deferred to v1.7+.
- Full validation report markdown with screenshots + transcripts — deferred; could be added retroactively in v1.7 if regression triage becomes painful.
- Automated Windows CI runner — deferred to v1.7+ (unit tests only; integration matrix remains manual).
- Tool reference / contributing guide — deferred to future README phase.
- CHANGELOG.md scaffolding — deferred.
- Long-path-enable bit startup probe — deferred to v1.7+.
- Probing VS Code's bundled JDT LS — REQUIREMENTS.md "Out of Scope".
- `--jdtls-home` CLI flag — deferred from Phase 38; not added in Phase 39.
