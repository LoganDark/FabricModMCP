import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { parseGradleProperties, parseBuildGradle } from '../../src/project/gradle-parser.js';
import { DomainError } from '../../src/errors/domain-error.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, '..', 'fixtures');

describe('parseGradleProperties', () => {
	it('parses standard key=value pairs', () => {
		const content = 'minecraft_version=1.21.11\nyarn_mappings=1.21.11+build.4\n';
		const props = parseGradleProperties(content);
		expect(props.get('minecraft_version')).toBe('1.21.11');
		expect(props.get('yarn_mappings')).toBe('1.21.11+build.4');
	});

	it('skips comment lines starting with #', () => {
		const content = '# This is a comment\nminecraft_version=1.21.11\n';
		const props = parseGradleProperties(content);
		expect(props.size).toBe(1);
		expect(props.get('minecraft_version')).toBe('1.21.11');
	});

	it('skips blank lines', () => {
		const content = 'a=1\n\n\nb=2\n';
		const props = parseGradleProperties(content);
		expect(props.size).toBe(2);
	});

	it('handles values with special characters', () => {
		const content = 'yarn_mappings=1.21.11+build.4\nfabric_api_version=0.141.3+1.21.11\n';
		const props = parseGradleProperties(content);
		expect(props.get('yarn_mappings')).toBe('1.21.11+build.4');
		expect(props.get('fabric_api_version')).toBe('0.141.3+1.21.11');
	});
});

describe('parseBuildGradle', () => {
	describe('yarn era', () => {
		let properties: Map<string, string>;
		let buildGradle: string;

		it('loads fixtures', async () => {
			const propsContent = await readFile(resolve(fixturesDir, 'yarn-era', 'gradle.properties'), 'utf-8');
			properties = parseGradleProperties(propsContent);
			buildGradle = await readFile(resolve(fixturesDir, 'yarn-era', 'build.gradle.kts'), 'utf-8');
		});

		it('detects mapped era', async () => {
			const propsContent = await readFile(resolve(fixturesDir, 'yarn-era', 'gradle.properties'), 'utf-8');
			const props = parseGradleProperties(propsContent);
			const gradle = await readFile(resolve(fixturesDir, 'yarn-era', 'build.gradle.kts'), 'utf-8');
			const config = parseBuildGradle(gradle, props);
			expect(config.mappingEra).toBe('mapped');
		});

		it('extracts minecraft version', async () => {
			const propsContent = await readFile(resolve(fixturesDir, 'yarn-era', 'gradle.properties'), 'utf-8');
			const props = parseGradleProperties(propsContent);
			const gradle = await readFile(resolve(fixturesDir, 'yarn-era', 'build.gradle.kts'), 'utf-8');
			const config = parseBuildGradle(gradle, props);
			expect(config.minecraftVersion).toBe('1.21.11');
		});

		it('extracts yarn mappings version', async () => {
			const propsContent = await readFile(resolve(fixturesDir, 'yarn-era', 'gradle.properties'), 'utf-8');
			const props = parseGradleProperties(propsContent);
			const gradle = await readFile(resolve(fixturesDir, 'yarn-era', 'build.gradle.kts'), 'utf-8');
			const config = parseBuildGradle(gradle, props);
			expect(config.yarnMappings).toBe('1.21.11+build.4');
		});

		it('extracts loader version', async () => {
			const propsContent = await readFile(resolve(fixturesDir, 'yarn-era', 'gradle.properties'), 'utf-8');
			const props = parseGradleProperties(propsContent);
			const gradle = await readFile(resolve(fixturesDir, 'yarn-era', 'build.gradle.kts'), 'utf-8');
			const config = parseBuildGradle(gradle, props);
			expect(config.loaderVersion).toBe('0.18.6');
		});

		it('extracts dependencies with correct fields', async () => {
			const propsContent = await readFile(resolve(fixturesDir, 'yarn-era', 'gradle.properties'), 'utf-8');
			const props = parseGradleProperties(propsContent);
			const gradle = await readFile(resolve(fixturesDir, 'yarn-era', 'build.gradle.kts'), 'utf-8');
			const config = parseBuildGradle(gradle, props);
			expect(config.dependencies.length).toBeGreaterThanOrEqual(3);
			for (const dep of config.dependencies) {
				expect(dep).toHaveProperty('group');
				expect(dep).toHaveProperty('artifact');
				expect(dep).toHaveProperty('version');
				expect(dep).toHaveProperty('raw');
				expect(dep).toHaveProperty('configuration');
			}
		});
	});

	describe('unobfuscated era', () => {
		it('detects unmapped era', async () => {
			const propsContent = await readFile(resolve(fixturesDir, 'unobfuscated-era', 'gradle.properties'), 'utf-8');
			const props = parseGradleProperties(propsContent);
			const gradle = await readFile(resolve(fixturesDir, 'unobfuscated-era', 'build.gradle.kts'), 'utf-8');
			const config = parseBuildGradle(gradle, props);
			expect(config.mappingEra).toBe('unmapped');
		});

		it('extracts minecraft version', async () => {
			const propsContent = await readFile(resolve(fixturesDir, 'unobfuscated-era', 'gradle.properties'), 'utf-8');
			const props = parseGradleProperties(propsContent);
			const gradle = await readFile(resolve(fixturesDir, 'unobfuscated-era', 'build.gradle.kts'), 'utf-8');
			const config = parseBuildGradle(gradle, props);
			expect(config.minecraftVersion).toBe('26.2-snapshot-2');
		});

		it('has undefined yarn mappings', async () => {
			const propsContent = await readFile(resolve(fixturesDir, 'unobfuscated-era', 'gradle.properties'), 'utf-8');
			const props = parseGradleProperties(propsContent);
			const gradle = await readFile(resolve(fixturesDir, 'unobfuscated-era', 'build.gradle.kts'), 'utf-8');
			const config = parseBuildGradle(gradle, props);
			expect(config.yarnMappings).toBeUndefined();
		});

		it('has no mappings dependency', async () => {
			const propsContent = await readFile(resolve(fixturesDir, 'unobfuscated-era', 'gradle.properties'), 'utf-8');
			const props = parseGradleProperties(propsContent);
			const gradle = await readFile(resolve(fixturesDir, 'unobfuscated-era', 'build.gradle.kts'), 'utf-8');
			const config = parseBuildGradle(gradle, props);
			const mappingsDep = config.dependencies.find(d => d.configuration === 'mappings');
			expect(mappingsDep).toBeUndefined();
		});
	});

	it('throws DomainError when no minecraft dependency found', () => {
		const content = 'dependencies {\n    modImplementation("net.fabricmc:fabric-loader:0.18.6")\n}\n';
		const props = new Map<string, string>();
		expect(() => parseBuildGradle(content, props)).toThrow(DomainError);
		try {
			parseBuildGradle(content, props);
		} catch (e) {
			expect((e as DomainError).code).toBe('GRADLE_PARSE_MISSING_MINECRAFT');
		}
	});

	describe('parseBuildGradle.mavenRoots', () => {
		// All inputs include a minimal valid minecraft(...) dep so parseBuildGradle does not throw.
		const minDeps = `
dependencies {
	minecraft("com.mojang:minecraft:1.21.11")
}
`;

		function buildContent(repoBlock: string): string {
			return repoBlock + '\n' + minDeps;
		}

		it('extracts maven { url = uri("file:///abs/path") } block form', () => {
			const content = buildContent(`
repositories {
	maven {
		name = "Local"
		url = uri("file:///abs/path/to/repo")
	}
}
`);
			const config = parseBuildGradle(content, new Map());
			expect(config.mavenRoots).toContain('/abs/path/to/repo');
		});

		it('expands ${System.getProperty("user.home")} in uri() form', () => {
			const content = buildContent(`
repositories {
	maven {
		url = uri("file://\${System.getProperty("user.home")}/maven")
	}
}
`);
			const config = parseBuildGradle(content, new Map());
			expect(config.mavenRoots).toContain(join(homedir(), 'maven'));
		});

		it('extracts maven { url = "file:///abs/path" } (plain string, no uri() wrapper)', () => {
			const content = buildContent(`
repositories {
	maven {
		url = "file:///abs/string-path"
	}
}
`);
			const config = parseBuildGradle(content, new Map());
			expect(config.mavenRoots).toContain('/abs/string-path');
		});

		it('extracts shorthand maven("file:///abs/path") call form', () => {
			const content = buildContent(`
repositories {
	maven("file:///abs/shorthand")
}
`);
			const config = parseBuildGradle(content, new Map());
			expect(config.mavenRoots).toContain('/abs/shorthand');
		});

		it('extracts mavenLocal() to ~/.m2/repository', () => {
			const content = buildContent(`
repositories {
	mavenLocal()
}
`);
			const config = parseBuildGradle(content, new Map());
			expect(config.mavenRoots).toContain(join(homedir(), '.m2', 'repository'));
		});

		it('does NOT include mavenCentral() or other non-file repos', () => {
			const content = buildContent(`
repositories {
	mavenCentral()
	maven("https://maven.fabricmc.net/")
	maven { url = "https://example.com/repo" }
}
`);
			const config = parseBuildGradle(content, new Map());
			expect(config.mavenRoots).toEqual([]);
		});

		it('preserves declaration order across multiple repos', () => {
			const content = buildContent(`
repositories {
	maven { url = uri("file:///first") }
	mavenLocal()
	maven("file:///third")
}
`);
			const config = parseBuildGradle(content, new Map());
			expect(config.mavenRoots).toEqual([
				'/first',
				join(homedir(), '.m2', 'repository'),
				'/third',
			]);
		});

		it('returns [] when no repositories block', () => {
			const content = minDeps;
			const config = parseBuildGradle(content, new Map());
			expect(config.mavenRoots).toEqual([]);
		});

		it('returns [] for empty repositories block', () => {
			const content = buildContent(`
repositories {
}
`);
			const config = parseBuildGradle(content, new Map());
			expect(config.mavenRoots).toEqual([]);
		});

		it('expands literal ~/something to homedir', () => {
			const content = buildContent(`
repositories {
	maven { url = uri("file://~/relative-maven") }
}
`);
			const config = parseBuildGradle(content, new Map());
			expect(config.mavenRoots).toContain(join(homedir(), 'relative-maven'));
		});

		it('deduplicates same path declared twice while preserving first-occurrence order', () => {
			const content = buildContent(`
repositories {
	maven { url = uri("file:///dup") }
	maven { url = "file:///dup" }
	maven("file:///other")
}
`);
			const config = parseBuildGradle(content, new Map());
			expect(config.mavenRoots).toEqual(['/dup', '/other']);
		});

		it('matches the real CreatorCore/Claude repo declaration shape', () => {
			// Verbatim shape from FINDINGS — uri() with ${System.getProperty("user.home")}
			const content = buildContent(`
repositories {
	maven {
		name = "LocalMaven"
		url = uri("file://\${System.getProperty("user.home")}/maven")
	}

	mavenCentral()
}
`);
			const config = parseBuildGradle(content, new Map());
			expect(config.mavenRoots).toEqual([join(homedir(), 'maven')]);
		});
	});
});
