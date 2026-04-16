/**
 * Cascading Regex Engine — Pure domain module
 *
 * Takes source text and an array of regex pattern strings, executes them
 * sequentially (each narrowing within the previous match's text), and returns
 * a result with step trace and final character offset/line/column.
 *
 * No I/O. No jar reading. No project/state imports. Pure function.
 */

export type CascadeStep = {
	step: number;        // 1-based step number
	pattern: string;     // Original pattern string (including any (?flags) prefix)
	status: 'success' | 'failed';
	matched?: string;    // The matched text (only on success)
	offset?: number;     // Absolute character offset in source (only on success)
	length?: number;     // Length of matched text (only on success)
}

export type CascadeSuccess = {
	success: true;
	steps: CascadeStep[];
	offset: number;      // Final match absolute offset
	line: number;        // 1-based line number
	column: number;      // 1-based column number
}

export type CascadeFailure = {
	success: false;
	steps: CascadeStep[];
	failedStep: number;  // 1-based step number that failed (0 for empty patterns)
	error?: string;      // Optional error message (for invalid regex syntax)
}

export type CascadeResult = CascadeSuccess | CascadeFailure;

function offsetToLineColumn(source: string, offset: number): { line: number; column: number } {
	let line = 1;
	let lastNewline = -1;
	for (let i = 0; i < offset; i++) {
		if (source[i] === '\n') {
			line++;
			lastNewline = i;
		}
	}
	return { line, column: offset - lastNewline };
}

const FLAG_PREFIX_RE = /^\(\?([imsu]+)\)/;

function compilePattern(pattern: string): { regex: RegExp; original: string } {
	const prefixMatch = pattern.match(FLAG_PREFIX_RE);
	if (prefixMatch) {
		const flags = prefixMatch[1];
		const body = pattern.slice(prefixMatch[0].length);
		return { regex: new RegExp(body, flags), original: pattern };
	}
	return { regex: new RegExp(pattern), original: pattern };
}

export function cascadeRegex(source: string, patterns: string[]): CascadeResult {
	if (patterns.length === 0) {
		return {
			success: false,
			steps: [],
			failedStep: 0,
			error: 'No patterns provided',
		};
	}

	const steps: CascadeStep[] = [];
	let currentText = source;
	let baseOffset = 0;

	for (let i = 0; i < patterns.length; i++) {
		const stepNum = i + 1;
		const pattern = patterns[i];

		// Compile the regex, handling flag prefixes and syntax errors
		let compiled: { regex: RegExp; original: string };
		try {
			compiled = compilePattern(pattern);
		} catch (err) {
			steps.push({
				step: stepNum,
				pattern,
				status: 'failed',
			});
			return {
				success: false,
				steps,
				failedStep: stepNum,
				error: err instanceof SyntaxError ? err.message : String(err),
			};
		}

		// Execute the regex against the current narrowed text
		const match = compiled.regex.exec(currentText);

		if (!match) {
			steps.push({
				step: stepNum,
				pattern,
				status: 'failed',
			});
			return {
				success: false,
				steps,
				failedStep: stepNum,
			};
		}

		const absoluteOffset = baseOffset + match.index;

		steps.push({
			step: stepNum,
			pattern,
			status: 'success',
			matched: match[0],
			offset: absoluteOffset,
			length: match[0].length,
		});

		// Narrow: next step searches within the matched text
		currentText = match[0];
		baseOffset = absoluteOffset;
	}

	// All steps succeeded — compute line/column from final offset
	const finalStep = steps[steps.length - 1];
	const { line, column } = offsetToLineColumn(source, finalStep.offset!);

	return {
		success: true,
		steps,
		offset: finalStep.offset!,
		line,
		column,
	};
}
