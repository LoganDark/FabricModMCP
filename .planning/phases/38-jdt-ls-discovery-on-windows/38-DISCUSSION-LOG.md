# Phase 38: JDT LS Discovery on Windows - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-24
**Phase:** 38-jdt-ls-discovery-on-windows
**Areas discussed:** Probe depth, Error message format, JDTLS_HOME validation depth, os.homedir() migration sweep

---

## Probe depth

| Option | Description | Selected |
|--------|-------------|----------|
| Dir exists + launcher jar present | `existsSync(dir) && globSync('plugins/org.eclipse.equinox.launcher_*.jar', { cwd: dir }).length > 0`. Catches the empty-dir shadow case. Adds one sync glob per existing candidate. | ✓ |
| Dir exists only (current behavior) | Keep `existsSync(loc)` only. Simpler, no new dep usage in findJdtLs. Empty-dir shadowing produces a less helpful error in startJdtLs. | |
| Dir exists + `plugins/` subdir exists | Compromise: `existsSync(join(dir, 'plugins'))`. Cheaper than glob, catches the empty-dir case, doesn't validate jar name pattern. | |

**User's choice:** Dir exists + launcher jar present (Recommended)
**Notes:** Eliminates the empty-dir shadow case (an empty `~/jdtls/` shadowing a valid `/usr/local/share/jdtls/`). Reuses the `glob` runtime dep already imported in `client.ts:20`.

---

## Error message format

| Option | Description | Selected |
|--------|-------------|----------|
| Multi-line mirroring Phase 37 D-18 | Per-candidate slot label + reason (not set / dir missing / no launcher jar). First line starts with `JDT LS not found.` Per-candidate reasons also `logger.debug`-logged (matching Phase 37 D-20). | ✓ |
| Terse single line listing probed paths | One line: `JDT LS not found in <p1>, <p2>, .... Install from <url> or set JDTLS_HOME.` Shorter but loses per-candidate reason. | |
| Multi-line WITHOUT per-candidate skip reasons | List each path on its own line but no exists/missing annotation. Compromise. | |

**User's choice:** Multi-line mirroring Phase 37 D-18 (Recommended)
**Notes:** Direct mirror of the precedent set in Phase 37 for the Java-not-found message. Skip-reason taxonomy is the 3-element set: `(not set)`, `directory does not exist`, `exists but no launcher jar in plugins/`. JDTLS_HOME gets a slot label; candidate dirs get a bare path prefix.

---

## JDTLS_HOME validation depth

| Option | Description | Selected |
|--------|-------------|----------|
| Same depth as candidates | JDTLS_HOME must satisfy `existsSync(dir) AND` launcher-jar glob. Distinct error messages for dir-missing vs dir-present-but-empty. | ✓ |
| Dir existence only (current) | Keep JDTLS_HOME as a "trust the user" path — only check the dir exists. `startJdtLs`'s launcher-jar error remains the late-error path. | |
| Dir existence + `plugins/` subdir | Match whatever Area 1 chose. Since Area 1 picked the deepest probe, this would degrade JDTLS_HOME below candidates. | |

**User's choice:** Same depth as candidates (Recommended)
**Notes:** Consistent depth — an explicit override is surfaced as a user-config bug if invalid, not silently fallen-through-from. v1.5's existing dir-missing branch behavior is preserved (return immediately, do not fall through to candidates).

---

## os.homedir() migration sweep

| Option | Description | Selected |
|--------|-------------|----------|
| Just the one site, gated on grep | Replace `client.ts:63` only. Use ROADMAP grep criterion as verification gate. | |
| Sweep all HOME-adjacent env vars cross-platform | Audit `HOMEDRIVE`/`HOMEPATH`/`USERPROFILE`/`LOCALAPPDATA`/`ProgramFiles` usage and replace where appropriate. Bigger scope, may overlap with Phase 35. | ✓ |
| Just the one site + add a lint rule | Replace the site AND add a lint/test rule banning `process.env.HOME` in `src/` (greps and fails CI). | |

**User's choice:** Sweep all HOME-adjacent env vars cross-platform
**Notes:** Audit conducted during discussion produced: only 1 fix needed (`client.ts:63`) + 1 regression test to enforce the grep gate. `LOCALAPPDATA`/`ProgramFiles` reads in `src/platform/index.ts` are intentional Windows env-var consumption (NOT home-resolution) and stay. `HOMEDRIVE`/`HOMEPATH`/`USERPROFILE`/`APPDATA`/`TMPDIR`/`TMP`/`TEMP` have zero uses in `src/`. `homedir()` already used correctly in 5 other files. The "sweep" was a check, not a rewrite — the migration scope ends up being the same as Option 1 (one line) plus the lint rule from Option 3.

---

## Claude's Discretion

- Plan splitting (single plan vs split into refactor + tests).
- Whether `findJdtLs` stays sync (recommended via `globSync`) or becomes async (`await`-able).
- Test file naming (extend `tests/jdtls/client.test.ts` vs new `tests/jdtls/findJdtLs.test.ts`).
- Grep regression test location (default: `tests/no-process-env-home.test.ts`).
- Whether to remove the redundant launcher-jar glob in `startJdtLs:97` now that `findJdtLs` does the same probe (defense-in-depth either way).

## Deferred Ideas

- `--jdtls-home` CLI flag (no entry in REQUIREMENTS.md; revisit in v1.7 if needed).
- JDT LS version compatibility probing (no current requirement).
- Auto-download / bundle JDT LS (REQUIREMENTS.md "Out of Scope").
- Probing VS Code's bundled JDT LS (REQUIREMENTS.md "Out of Scope").
- Reinit on JDT LS install change between requests (Phase 37 D-02 reinit is for Java discovery, not JDT LS install changes).
