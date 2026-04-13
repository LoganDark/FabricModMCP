import type { z } from 'zod';

export function formatZodError(error: z.ZodError): string {
	return error.issues
		.map((issue) => {
			const path = issue.path.join('.');
			return `${path}: ${issue.message}`;
		})
		.join('; ');
}
