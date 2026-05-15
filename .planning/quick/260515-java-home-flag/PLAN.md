---
slug: java-home-flag
date: 2026-05-15
quick_id: 260515-d0i
status: in-progress
---

# Add `--java-home` CLI flag

Add a `--java-home` flag that overrides the Java home used by JDT LS.

## Scope

Today `detectJava()` (src/jdtls/client.ts:54-92) reads `JAVA_HOME` from the env. We add an explicit CLI override so users can launch the server with a specific JDK without mutating their shell env.

## Approach

Match the existing logger-singleton pattern:

1. `src/cli/args.ts`: parse `--java-home <path>` into `CliArgs.javaHome?: string`.
2. `src/jdtls/client.ts`: add module-level state + `setJavaHome(path?: string)` setter. `detectJava()` resolves the candidate as `configured ?? process.env.JAVA_HOME`, then falls back to `java` on PATH.
3. `src/index.ts`: after `parseCli`, call `setJavaHome(args.javaHome)`. Applies to both the default project and any subsequent `create_project` calls without threading options through.

## Files

- `src/cli/args.ts` — add option, update return type
- `src/jdtls/client.ts` — add setter + module state, update `detectJava`
- `src/index.ts` — wire CLI → setter
- `tests/cli/args.test.ts` — coverage for `--java-home`
- `tests/jdtls/client.test.ts` — coverage for `setJavaHome` precedence

## Verification

- `pnpm test` passes
- `pnpm exec tsc --noEmit` clean
