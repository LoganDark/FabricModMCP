# Windows Support

FabricModMCP runs natively on Windows, macOS, Linux, and WSL2. The MCP server itself is a Node.js 22+ process; the JDT LS child process it spawns runs on Java 21+. This document describes how the server discovers those two runtimes on Windows and the known platform-specific limitations.

Two priority chains govern startup: a five-slot **Java discovery chain** that locates a Java 21+ binary, and a four-or-five-slot **JDT LS install chain** (depending on platform) that locates the Eclipse JDT LS launcher jar. Both chains are evaluated lazily on the first request that needs them; both surface multi-line failure messages naming every slot that was tried when no candidate succeeds.

## Installation Prerequisites

- **Java 21+** — [Eclipse Adoptium Temurin](https://adoptium.net/), Microsoft Build of OpenJDK, Azul Zulu, or Amazon Corretto. JDT LS will refuse to spawn on anything older.
- **Eclipse JDT LS milestone** — download from the [Eclipse JDT LS milestones index](https://download.eclipse.org/jdtls/milestones/) and extract into one of the locations listed below.
- **Node.js 22+ LTS** — [nodejs.org](https://nodejs.org/).
- **pnpm** — [pnpm.io](https://pnpm.io/) (`npm install -g pnpm` or the standalone installer).

## Java Discovery Priority Chain

The MCP server probes Java in a fixed five-slot order; the first slot that resolves to a Java 21+ binary wins. The chain is implemented by `discoverJava` in `src/jdtls/java-discovery.ts` and each candidate is probed via `<candidate> --version` with a 3-second timeout. A candidate that resolves but reports Java < 21 does NOT abort the chain — the next slot is tried.

Slot order for `discoverJava`:

1. `--java-home` (module-state `configuredJavaHome`)
2. `org.gradle.java.home` from `<projectRoot>/gradle.properties`
3. `JAVA_HOME` env var
4. `java` on PATH (libuv handles PATH lookup + PATHEXT on Windows)
5. Scan common install locations from `commonJavaLocations()` with
   vendor-aware layout map

Slot 2 is the load-bearing addition for Fabric modders: a project that pins its build to a specific JDK via `org.gradle.java.home` in `gradle.properties` will see FabricModMCP automatically pick up that same JDK for JDT LS, so semantic navigation runs against the exact bytecode the project compiles against. Slot 5 covers Adoptium, Microsoft, Oracle Java, Amazon Corretto, Azul Zulu, IntelliJ-managed `~/.jdks`, and Scoop on Windows — see `commonJavaLocations()` in `src/platform/index.ts` for the full parent-directory list.

## JDT LS Install Locations

`JDTLS_HOME` env var heads each list — when set, `findJdtLs` in `src/jdtls/client.ts` validates it for the launcher jar BEFORE iterating the per-OS candidates below. A `JDTLS_HOME` that points at a nonexistent directory, or at a directory with no `plugins/org.eclipse.equinox.launcher_*.jar`, fails fast with an explicit error instead of falling through.

### Windows

The Windows candidate chain (in source order from `jdtlsCandidateDirs()` in `src/platform/index.ts`):

1. `%LOCALAPPDATA%\jdtls`
2. `%ProgramFiles%\jdtls`
3. `%USERPROFILE%\jdtls`
4. `%LOCALAPPDATA%\nvim-data\mason\packages\jdtls`

The fourth entry exists so Neovim users who install JDT LS via [Mason](https://github.com/williamboman/mason.nvim) get zero-config discovery — no symlinking or `JDTLS_HOME` needed.

If the four locations above do not match your installer's layout, set `JDTLS_HOME` to point at the directory containing the `plugins/` subfolder and FabricModMCP will use it directly.

### Linux / macOS

The Unix candidate chain (in source order from `jdtlsCandidateDirs()`):

1. `~/.local/share/jdtls`
2. `/usr/local/share/jdtls`
3. `~/jdtls`

These three paths are byte-identical to the v1.5 behavior (UNIX-01 commitment). On both Windows and Unix, only the FIRST candidate that contains a `plugins/org.eclipse.equinox.launcher_*.jar` is selected; candidates that exist but lack the launcher jar are skipped with a debug-level log entry and the chain continues.

## Known Limitations

### 260-character path limit

Windows enforces a 260-character `MAX_PATH` limit by default on legacy file APIs. JDT LS workspace extraction unpacks ZIP entries into `%TEMP%\mcp-jdtls-<uuid>\dep-<id>\<deep\package\path>\<ClassName>.java`. A long Fabric API namespace combined with a long username can push past 260 characters, surfacing as `ENOENT` or `ENAMETOOLONG` during `add_fabric_mod` or as empty `find_definition` results afterward.

**Mitigation:** enable long-path support on Windows 10 1607+ / Windows 11 by setting the registry value:

```
HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled = 1
```

Or enable the Group Policy **Computer Configuration → Administrative Templates → System → Filesystem → Enable Win32 long paths**. A reboot is required for either change to take effect. See [Microsoft Learn: Maximum file path limitation](https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation) for the full background.

Node.js 22 honors the registry flag automatically when set — no FabricModMCP-side code change is required. The MCP server does not probe the registry value itself, so if extraction failures appear without an obvious cause and the project lives deep under `C:\Users\<long-username>\...`, the long-path flag is the first thing to check.

### WSL2

WSL2 is Linux from FabricModMCP's perspective (`process.platform === 'linux'`) — the same Unix discovery chains apply, and no Windows-specific code path runs inside WSL2. However, cross-filesystem access between Windows (`C:\...`) and WSL2 (`/mnt/c/...` or `\\wsl$\...`) is significantly slower than same-FS access, and case-sensitivity differences can confuse JDT LS workspace indexing.

If you hit Windows-native quirks (long paths, antivirus interference with `.gradle` caches, EBUSY retries during workspace sync), the cleanest workaround is to run **fully inside WSL2**: keep the mod project under the WSL filesystem (`~/dev/...`), install Java + JDT LS + Node.js + pnpm inside the WSL distribution, and launch the MCP server from WSL. Claude Code's MCP transport works identically over either side.

Conversely, do not try to mix sides — running the MCP server on Windows against a project that lives under `\\wsl$\Ubuntu\home\...` will work but is the slowest configuration, because every jar read crosses the 9P filesystem bridge.

Source of truth for the contract: see REQUIREMENTS.md WIN-01/WIN-02/JAVA-01/JAVA-02.
Implementation: `src/jdtls/java-discovery.ts` (Java) and `src/jdtls/client.ts` `findJdtLs` (JDT LS).
