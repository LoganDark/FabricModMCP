import { loadFabricMod } from '../../../src/project/loader.js';

const path = '/Users/LoganDark/Documents/Projects/CreatorCore/Claude';

try {
	const mod = await loadFabricMod(path);
	console.log('=== mod loaded ===');
	console.log('name:', mod.name);
	console.log('rootPath:', mod.rootPath);
	console.log('gradleConfig.dependencies:', JSON.stringify(mod.gradleConfig.dependencies, null, 2));
	console.log('mappingEra:', mod.gradleConfig.mappingEra);
	console.log('sourcesJar:', mod.sourcesJar);
	console.log('compiledJar:', mod.compiledJar);
	console.log('=== dependencyJars ===');
	for (const [id, dep] of mod.dependencyJars) {
		console.log(JSON.stringify({ id, group: dep.group, artifact: dep.artifact, version: dep.version, category: dep.category, sourcesJarPath: dep.sourcesJarPath, available: dep.available }, null, 0));
	}
	console.log(`=== total: ${mod.dependencyJars.size} entries ===`);
} catch (err) {
	console.error('=== ERROR ===');
	console.error(err);
	if (err instanceof Error && 'code' in err) {
		console.error('code:', (err as any).code);
		console.error('tried:', (err as any).tried);
		console.error('suggestions:', (err as any).suggestions);
	}
}
