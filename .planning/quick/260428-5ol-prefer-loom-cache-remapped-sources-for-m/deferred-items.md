# Deferred Items — quick-260428-5ol

Pre-existing issues discovered during 5ol verification but out of scope for the
loom-cache-first probe-ordering fix.

---

## fabricApi.module(...) submodules are not discovered

**Where:** `src/project/gradle-parser.ts` (extractGradleConfig, line ~172) sets
`fabricApiVersion` only when a dep with `artifact === 'fabric-api'` is found in
the `dependencies { ... }` block. The Claude project pulls in fabric-api via:

```kotlin
modImplementation(fabricApi.module("fabric-resource-loader-v0", fabric_api_version))
```

`fabricApi.module(...)` is a Loom DSL helper -- the literal coord
`net.fabricmc.fabric-api:fabric-api:<version>` never appears in the file, so the
parser leaves `fabricApiVersion` undefined and `dependency-discovery.ts` Step 2
is skipped entirely. As a result, no `fabric-api`-categorized entries appear in
the project's `dependencyJars` map, and no fabric-api submodule sources can be
browsed from this project.

**Why deferred:** This is independent of loom-cache resolution. Even before
260428-59m / 260428-5ol, fabric-api submodules were not discovered for this
project shape. The 5ol task was scoped to the loom-cache-first probe ordering;
fixing the fabric-api discovery gap requires:

1. Extracting `fabric_api_version` from `gradle.properties` directly (or
   detecting `fabricApi.module()` calls in build.gradle.kts), and
2. Synthesizing the missing `fabricApiVersion` in `GradleConfig`, regardless of
   whether a literal `fabric-api` coord appears.

**Suggested follow-up:** Quick task -- read `fabric_api_version` from
gradle.properties and use it as the fabric-api version when no `fabric-api`
coord is in the dependencies block. Once that lands, the loom-cache-first
probe in this 5ol task will *automatically* route fabric-api submodule sources
through the remapped_mods cache (the resolver code is already loom-cache-first;
it's just never being exercised for fabric-api submodules on this project).

**Impact:** No regression -- fabric-api browsing was already broken on this
project before 5ol. The 5ol fix verifiably works for `auxcommands`, the
declared mod dep that was the explicit primary target.
