---
status: partial
phase: 39-windows-end-to-end-validation
source: [39-VERIFICATION.md]
started: 2026-05-24T22:30:00Z
updated: 2026-05-24T22:30:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. find_references behavior on Windows (SC-2 gap decision)
expected: Either (a) `find_references` on a mod-local symbol (e.g., the test mod's own `ROOT_ID` field rather than `net.minecraft.resources.Identifier`) returns N > 0 results within 30s on the Windows host — demonstrating the tool works for typical use cases — OR (b) the maintainer explicitly accepts Failure 2 as a documented v1.7 item and adds a Known Limitations note to `docs/WINDOWS-SUPPORT.md` reading: "find_references on workspace-wide Minecraft classes (such as `Identifier`) may hang indefinitely due to the absence of JDT LS request cancellation. Use a narrower symbol."
result: [pending]

### 2. Linux vitest suite (SC-3 gap)
expected: On a Linux host (or WSL2 Linux environment), `pnpm test -- run` at the repository root exits 0 with zero new failures. Test count may differ slightly from macOS (872p/1s) based on platform-gated `describe.runIf` blocks; the acceptance criterion is zero new failures, not exact count match.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
