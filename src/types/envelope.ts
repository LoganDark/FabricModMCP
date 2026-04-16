export type ToolSuccess<T> = {
	success: true;
	data: T;
	metadata: Record<string, unknown>;
};

export type ToolError = {
	success: false;
	error: {
		code: string;
		message: string;
		tried: string[];
		suggestions?: string[];
	};
	metadata: Record<string, unknown>;
};

export type Disambiguation = {
	success: true;
	disambiguation: true;
	message: string;
	options: Array<{ value: string; label: string; description?: string }>;
};

export type ToolResponse<T> = ToolSuccess<T> | ToolError | Disambiguation;

export function makeSuccess<T>(data: T, metadata: Record<string, unknown> = {}): ToolSuccess<T> {
	return { success: true, data, metadata };
}

export function makeError(
	code: string,
	message: string,
	tried: string[],
	suggestions?: string[],
	metadata: Record<string, unknown> = {},
): ToolError {
	return { success: false, error: { code, message, tried, suggestions }, metadata };
}

export function makeDisambiguation(
	message: string,
	options: Array<{ value: string; label: string; description?: string }>,
): Disambiguation {
	return { success: true, disambiguation: true, message, options };
}
