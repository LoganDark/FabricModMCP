import { z } from 'zod';
import { DomainError } from '../errors/domain-error.js';
import { formatZodError } from '../errors/validation.js';
import type { FabricModJson } from './types.js';

const fabricModSchema = z.object({
	schemaVersion: z.number(),
	id: z.string(),
	version: z.string(),
	name: z.string(),
	description: z.string().default(''),
	authors: z.array(z.union([z.string(), z.object({ name: z.string() })])).default([]),
	license: z.string().default(''),
	environment: z.string().default('*'),
	mixins: z.array(z.string()).default([]),
	depends: z.record(z.string(), z.string()).default({}),
}).passthrough();

export function parseFabricMod(content: string, properties?: Map<string, string>): FabricModJson {
	// Substitute ${property_name} placeholders using gradle properties (same pattern as parseBuildGradle)
	let substituted = content;
	if (properties && properties.size > 0) {
		substituted = content.replace(/\$\{(\w+)\}/g, (_match, varName: string) => {
			return properties.get(varName) ?? _match;
		});
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(substituted);
	} catch {
		throw new DomainError(
			'FABRIC_MOD_INVALID_JSON',
			'fabric.mod.json is not valid JSON',
			[],
			['Check for syntax errors in fabric.mod.json'],
		);
	}

	const result = fabricModSchema.safeParse(parsed);
	if (!result.success) {
		throw new DomainError(
			'FABRIC_MOD_VALIDATION',
			formatZodError(result.error),
			[],
			[],
		);
	}

	return result.data as FabricModJson;
}
