---
phase: 39
slug: windows-end-to-end-validation
status: in-progress
created: 2026-05-24
---

# Phase 39 — Windows End-to-End Validation Report

> Replace every `<…>` placeholder with the captured value during matrix execution.
> Do not leave any `<…>` in the final committed file.

## Environment

- Windows: <e.g. 11 24H2 Build 26100>
- Shell: <e.g. PowerShell 7.4.6>
- JDK installs:
  - <Adoptium Temurin 21.0.5 at C:\Program Files\Eclipse Adoptium\jdk-21.0.5.11-hotspot\> — referred to as **JDK A** below
  - <second JDK if available, e.g. Microsoft Build of OpenJDK 21.0.5 at C:\Program Files\Microsoft\jdk-21.0.5.11-hotspot\> — referred to as **JDK B** below
  - <or: "only one JDK installed" if there is no second JDK — D-04 single-JDK fallback>
- JDT LS: <version> at <absolute path resolved by findJdtLs>
- Node.js: <version>
- FabricModMCP: commit <SHA of HEAD on the Windows checkout>
- fabric-example-mod: commit <SHA at clone time>
- Fixture root: `~/dev/fmm-phase39-fixture/` (example-mod + sibling-mod)

## Matrix

- [ ] **Row 1 — `--java-home`**: javaPath=`<absolute path>`, find_definition N=<n>, find_references N=<n> (cross-mod sibling-mod → example-mod: <yes/no>); evidence-source=<Get-CimInstance | Task Manager | logger.info>
- [ ] **Row 2 — `org.gradle.java.home`**: javaPath=`<absolute path>`, find_definition N=<n>, find_references N=<n> (cross-mod: <yes/no>); evidence-source=<…>
- [ ] **Row 3 — `JAVA_HOME`**: javaPath=`<absolute path>`, find_definition N=<n>, find_references N=<n> (cross-mod: <yes/no>); evidence-source=<…>
- [ ] **Row 4 — PATH only**: javaPath=`<absolute path>`, find_definition N=<n>, find_references N=<n> (cross-mod: <yes/no>); evidence-source=<…>

**Slot-independence sanity (D-04):** The four `javaPath` values <are distinct | all equal because only one JDK is installed — see Environment block>.

**Cross-mod proof (success criterion 2):** Row <N>'s `find_definition` from sibling-mod to example-mod returned `<n>` results; row <N>'s `find_references` from example-mod found `<n>` hits including at least one inside sibling-mod.

## Failures

<none — or per-row stdout/stderr blocks pasted inline per D-07>

<!--
Failure-block template (one per failed row, copy as needed):

### Row <N> — `<entry point>` — failure

Symptom: <one-line description, e.g. "JDT LS process exited immediately after spawn">

Triage:
- D-13 gap closure → opened `39-NN-PLAN.md`
- D-14 Phase 40 escalation → opened via `/gsd:phase add 40 …`
- D-15 docs-known-limitation → added to `docs/WINDOWS-SUPPORT.md` "Known Limitations"

stdout:
```
<paste verbatim>
```

stderr:
```
<paste verbatim>
```

Fix:
<commit SHA(s) or escalation reference>
-->

## UNIX-03 Regression Sweep

<populated by Plan 39-05 after the matrix is done>

---

*Phase: 39-windows-end-to-end-validation*
*Verification captured: <date> on <hostname>*
