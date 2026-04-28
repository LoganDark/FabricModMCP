# Deferred Items - quick-260428-59m

## Pre-existing `pnpm build` DTS failure

`pnpm build` fails during the tsup DTS generation step with:

```
error TS5101: Option 'baseUrl' is deprecated and will stop functioning in TypeScript 7.0.
Specify compilerOption '"ignoreDeprecations": "6.0"' to silence this error.
```

- Verified pre-existing (reproduces on master HEAD before this task).
- Caused by tsconfig `baseUrl` option being removed in TypeScript 7 (the
  installed compiler is 6.0.2 which only warns, but tsup escalates it).
- The ESM build (`dist/index.js`) completes successfully -- runtime is
  unaffected. Only the `.d.ts` emit step fails.
- Out of scope for this task per Rules-1-3 scope boundary (no new
  warnings introduced; the failure was already there).
- `pnpm exec tsc --noEmit` is clean against my changes.

Suggested follow-up: add `"ignoreDeprecations": "6.0"` to tsconfig.json
(or wherever the dts compiler reads its options) in a separate quick task.
