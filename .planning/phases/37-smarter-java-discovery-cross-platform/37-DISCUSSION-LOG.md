# Phase 37: Smarter Java Discovery (cross-platform) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in 37-CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-16
**Phase:** 37-smarter-java-discovery-cross-platform
**Areas discussed:** Startup integration & projectRoot wiring, Common-install enumeration strategy, API migration: setJavaHome / detectJava lifecycle, Error / diagnostic message composition

---

## Startup integration & projectRoot wiring

| Option | Description | Selected |
|--------|-------------|----------|
| A+C hybrid (Recommended) | `--project-root` CLI flag + inert slot when flag absent | |
| A only | `--project-root` flag; drop org.gradle.java.home slot when flag absent | |
| C only | Inert slot in chain; unreachable at startup in v1.6 | |
| B | Lazy JDT LS init | |
| **Other (user-authored)** | **"when jdt ls fails to initialize on startup, attempt reinit when a project with org.gradle.java.home is added"** — extended in follow-up to "also retry on project refresh while jdt ls is degraded" | **✓** |

**User's choice:** Custom hybrid — on-demand reinit of degraded JDT LS sessions when a project is added or refreshed. No new CLI flag.

**Notes:** This approach was not in the four advisor-research options. It cleanly preserves UNIX-01 (zero behavioral change for users whose v1.5 chain already worked) while extending the chain to recover from "startup failed but later-loaded project has org.gradle.java.home pointing at a usable JDK". Two follow-up questions nailed scope and trigger:

**Follow-up 1 — Reinit scope:**

| Option | Description | Selected |
|--------|-------------|----------|
| Only the default project's JDT LS | Newly-added projects get their own JDT LS; default gets retried | |
| **All degraded projects, not just default** | Sweep every project with `jdtls.available === false` on each retry trigger | **✓** |
| Default-only + shared JDT LS | Collapse new project into default's JDT LS | |

**Follow-up 2 — Retry trigger:**

| Option | Description | Selected |
|--------|-------------|----------|
| Only when added project has `org.gradle.java.home` | Gate on new info being present | |
| **On every project add when JDT LS is degraded** | Unconditional retry — user may have installed Java in the meantime | **✓** |
| Only when resolved Java differs from previous failure | Compare-before-spawn | |

**User addendum (typed as freeform after follow-ups):** "also retry on project refresh while jdt ls is degraded" — extending the retry trigger to `refresh_project` and `refresh_project_members` tool handlers, not just `add_fabric_mod`.

---

## Common-install enumeration strategy

| Option | Description | Selected |
|--------|-------------|----------|
| **D: Vendor-aware readdir + version-sort (Recommended)** | Per-vendor handlers; macOS .jdk/Contents/Home + Homebrew libexec + scoop current; version-hint sort within each parent; sequential probe short-circuits | **✓** |
| B: Vendor-aware readdir + first-match-wins | Per-vendor handlers; filesystem order within each parent | |
| A: Generic `**/bin/java[.exe]` glob with maxDepth cap | One pattern per parent via glob library | |

**User's choice:** D — version-aware sort within each vendor parent.

**Notes:** Confirms multi-JDK side-by-side (`java-17-openjdk` + `java-21-openjdk` under `/usr/lib/jvm/`) prefers the newer 21+ via best-effort version-hint regex. Worst-case latency capped by the locked 3s per-candidate timeout × ~12 candidates = 36s; typical short-circuit is <100ms.

---

## API migration: setJavaHome / detectJava lifecycle

| Option | Description | Selected |
|--------|-------------|----------|
| **D: java-discovery.ts owns all 3 symbols; client.ts is pure re-export (Recommended)** | `client.ts` becomes literal re-export line | **✓** |
| C: Sync detectJava stays in client.ts byte-identical | Sync logic untouched; new file imports from it | |
| A: client.ts has state mutator + thin sync detectJava | Stripped sync helper as private fn | |
| B: Drop setJavaHome, javaHome as parameter | Pure-function `discoverJava({projectRoot, javaHome})` | |

**User's choice:** D — pure re-export shim.

**Notes:** TypeScript ESM re-exports are zero-cost. Phase 35's Windows-mocked `tests/jdtls/client.test.ts` continues to import `from './client.js'` without modification. v1.7 cleanup is mechanical (delete two functions + one re-export line + plumb javaHome through index.ts → startup.ts).

---

## Error / diagnostic message composition

| Option | Description | Selected |
|--------|-------------|----------|
| **B: Multi-line failureReason + bare paths in tried[] (Recommended)** | First line still "Java not found." for substring-match tests; per-candidate skip reasons inline; `tried: string[]` envelope shape unchanged | **✓** |
| A: Keep v1.5 single line | Zero test churn; opaque to user | |
| C: Compact attempted-paths list | Loses per-candidate "why" | |
| D: Two-tier with structured tried[{candidate, reason}] | Widens envelope shape across all error sites | |

**User's choice:** B — aggregated multi-line `failureReason`.

**Notes:** Existing tests use `toContain('Java not found')` substring match — the new first line preserves the prefix. `src/types/envelope.ts:12` confirmed `tried: string[]`; widening to structured was over-engineering for a single consumer. Per-candidate reasons also `logger.debug`-logged for `--verbose` audit.

---

## Claude's Discretion

- Plan wave splitting (likely 3–4 plans: discovery module, client.ts shim, startup.ts callsite + initJdtLsSession signature, retry hook in tool handlers, tests)
- Whether `unescapePropertiesValue` lives in `java-discovery.ts` or as an export from `src/project/gradle-parser.ts`
- Whether `retryDegradedJdtLsSessions()` is a free function in `startup.ts`, a method on `ProjectStore`, or inlined per-tool — default is free function in startup.ts
- Whether degraded-session reinit replaces fields in-place or fully reconstructs the session (default: reconstruct, after cleaning up old `tempDir`/`dataDir`)
- Exact glob/readdir details for the `/opt` filter and the Homebrew `openjdk*` prefix match

## Deferred Ideas

- `--project-root` CLI flag (Option A from Area 1 research) — rejected for v1.6 in favor of on-demand reinit
- Lazy JDT LS init (Option B from Area 1 research) — too large a refactor for this phase
- Surfacing `javaSource` (matched slot) in JDT LS status — v1.7 per REQUIREMENTS.md Future
- Two-tier structured `tried[{candidate, reason}]` envelope — cross-cutting refactor for one consumer
- `org.gradle.java.installations.paths` / Gradle toolchain discovery — v1.7
- User-level `~/.gradle/gradle.properties` — v1.7
- Relative-path `org.gradle.java.home` resolution — v1.7
- Standalone diagnostics tool / dedicated error-detail surface — v1.7
