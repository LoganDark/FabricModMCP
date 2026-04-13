export class DomainError extends Error {
	constructor(
		public readonly code: string,
		message: string,
		public readonly tried: string[] = [],
		public readonly suggestions: string[] = [],
	) {
		super(message);
		this.name = 'DomainError';
	}
}
