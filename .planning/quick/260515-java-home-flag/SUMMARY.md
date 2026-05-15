---
slug: java-home-flag
date: 2026-05-15
quick_id: 260515-d0i
status: complete
---

# Summary — `--java-home` CLI flag

Added a `--java-home <path>` CLI flag that overrides which JDK the server uses to spawn JDT LS, taking precedence over the `JAVA_HOME` env var.

## Changes

- `src/cli/args.ts` — parse `--java-home`, surface as `CliArgs.javaHome?: string`
- `src/jdtls/client.ts` — module-level `configuredJavaHome` + `setJavaHome(path?)` setter; `detectJava()` resolves `configured ?? JAVA_HOME ?? java-on-PATH`
- `src/index.ts` — call `setJavaHome(args.javaHome)` after `parseCli`. Applies to the default project's JDT LS session and any subsequent `create_project` calls.
- `tests/cli/args.test.ts` — 3 new cases covering default, set, and isolation from logLevel
- `tests/jdtls/client.test.ts` — 4 new `detectJava` cases covering precedence (override > env > PATH) and clearing

## Verification

- `pnpm test` — 767 passed
- `pnpm exec tsc --noEmit` — clean
