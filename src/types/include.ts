import { z } from 'zod';

export const INCLUDE_CATEGORIES = ['provenance', 'stats', 'hints'] as const;
export type IncludeCategory = typeof INCLUDE_CATEGORIES[number];

export const includeSchema = z.array(z.enum(INCLUDE_CATEGORIES))
	.optional()
	.describe('Optional metadata categories to include in response');
