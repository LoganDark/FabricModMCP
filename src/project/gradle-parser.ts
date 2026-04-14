import { DomainError } from '../errors/domain-error.js';
import type { DependencyCoordinate, GradleConfig, MappingEra } from './types.js';

export function parseGradleProperties(content: string): Map<string, string> {
	const props = new Map<string, string>();
	for (const line of content.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) continue;
		const eqIndex = trimmed.indexOf('=');
		if (eqIndex === -1) continue;
		props.set(trimmed.slice(0, eqIndex).trim(), trimmed.slice(eqIndex + 1).trim());
	}
	return props;
}

export function parseBuildGradle(content: string, properties: Map<string, string>): GradleConfig {
	// Step 1: Substitute ${var_name} references using properties map
	let substituted = content.replace(/\$\{(\w+)\}/g, (_match, varName: string) => {
		return properties.get(varName) ?? _match;
	});

	// Step 2: Strip comments
	substituted = substituted.replace(/\/\/.*$/gm, '');
	substituted = substituted.replace(/\/\*[\s\S]*?\*\//g, '');

	// Step 3: Extract dependencies block
	const depsMatch = substituted.match(/dependencies\s*\{([\s\S]*?)\n\}/);
	const depsBlock = depsMatch ? depsMatch[1] : '';

	// Step 4: Extract individual dependency calls
	const depCallRegex = /(\w+)\(\s*"([^"]+)"\s*\)/g;
	const dependencies: DependencyCoordinate[] = [];
	let match: RegExpExecArray | null;

	while ((match = depCallRegex.exec(depsBlock)) !== null) {
		const configuration = match[1];
		const coordinate = match[2];
		const parts = coordinate.split(':');
		if (parts.length >= 3) {
			dependencies.push({
				configuration,
				group: parts[0],
				artifact: parts[1],
				version: parts[2],
				raw: coordinate,
			});
		}
	}

	// Step 5: Era detection
	const hasMappings = dependencies.some(d => d.configuration === 'mappings');
	const mappingEra: MappingEra = hasMappings ? 'mapped' : 'unmapped';

	// Step 6: Extract convenience fields
	const minecraftDep = dependencies.find(d => d.configuration === 'minecraft');
	if (!minecraftDep) {
		throw new DomainError(
			'GRADLE_PARSE_MISSING_MINECRAFT',
			'No minecraft(...) dependency found in build.gradle.kts dependencies block',
			['Searched dependencies block for minecraft(...) call'],
			['Ensure build.gradle.kts has a minecraft("com.mojang:minecraft:VERSION") dependency'],
		);
	}

	const mappingsDep = dependencies.find(d => d.configuration === 'mappings');
	const loaderDep = dependencies.find(d => d.artifact === 'fabric-loader');
	const fabricApiDep = dependencies.find(d => d.artifact === 'fabric-api');

	return {
		minecraftVersion: minecraftDep.version,
		mappingEra,
		yarnMappings: mappingsDep?.version,
		loaderVersion: loaderDep?.version,
		fabricApiVersion: fabricApiDep?.version,
		dependencies,
	};
}
