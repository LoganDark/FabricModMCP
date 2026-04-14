import { describe, it, expect } from 'vitest';
import type {
	TypeReference,
	PrimitiveType,
	ClassType,
	ArrayType,
	VarargType,
	VoidType,
	UnresolvedType,
	MemberReference,
	MethodReference,
	FieldReference,
	ParameterInfo,
} from '../../src/browsing/member-types.js';

describe('TypeReference', () => {
	it('constructs PrimitiveType with correct shape', () => {
		const t: PrimitiveType = { kind: 'primitive', name: 'int' };
		expect(t.kind).toBe('primitive');
		expect(t.name).toBe('int');
	});

	it('constructs ClassType with correct shape', () => {
		const t: ClassType = { kind: 'class', name: 'BlockPos', fqn: 'net.minecraft.util.math.BlockPos' };
		expect(t.kind).toBe('class');
		expect(t.name).toBe('BlockPos');
		expect(t.fqn).toBe('net.minecraft.util.math.BlockPos');
	});

	it('constructs ArrayType with recursive elementType', () => {
		const inner: PrimitiveType = { kind: 'primitive', name: 'int' };
		const t: ArrayType = { kind: 'array', elementType: inner };
		expect(t.kind).toBe('array');
		expect(t.elementType).toEqual({ kind: 'primitive', name: 'int' });
	});

	it('constructs VarargType with recursive elementType', () => {
		const inner: ClassType = { kind: 'class', name: 'String', fqn: 'java.lang.String' };
		const t: VarargType = { kind: 'vararg', elementType: inner };
		expect(t.kind).toBe('vararg');
		expect(t.elementType.kind).toBe('class');
	});

	it('constructs VoidType with no extra fields', () => {
		const t: VoidType = { kind: 'void' };
		expect(t.kind).toBe('void');
		expect(Object.keys(t)).toEqual(['kind']);
	});

	it('constructs UnresolvedType preserving raw text', () => {
		const t: UnresolvedType = { kind: 'unresolved', rawType: 'SomeUnknown' };
		expect(t.kind).toBe('unresolved');
		expect(t.rawType).toBe('SomeUnknown');
	});

	it('supports exhaustive switch on TypeReference.kind', () => {
		const check = (t: TypeReference): string => {
			switch (t.kind) {
				case 'primitive': return t.name;
				case 'class': return t.fqn;
				case 'array': return 'array';
				case 'vararg': return 'vararg';
				case 'void': return 'void';
				case 'unresolved': return t.rawType;
			}
			// TypeScript ensures this is unreachable if all cases covered
			const _exhaustive: never = t;
			return _exhaustive;
		};

		expect(check({ kind: 'primitive', name: 'int' })).toBe('int');
		expect(check({ kind: 'void' })).toBe('void');
	});
});

describe('MemberReference', () => {
	it('constructs MethodReference with parameters and returnType', () => {
		const param: ParameterInfo = {
			name: null,
			type: { kind: 'primitive', name: 'int' },
		};
		const t: MethodReference = {
			kind: 'method',
			parameters: [param],
			returnType: { kind: 'void' },
		};
		expect(t.kind).toBe('method');
		expect(t.parameters).toHaveLength(1);
		expect(t.parameters[0].name).toBeNull();
		expect(t.parameters[0].type.kind).toBe('primitive');
		expect(t.returnType).toEqual({ kind: 'void' });
	});

	it('constructs MethodReference with null returnType for constructors', () => {
		const t: MethodReference = {
			kind: 'method',
			parameters: [],
			returnType: null,
		};
		expect(t.returnType).toBeNull();
	});

	it('constructs FieldReference with correct shape', () => {
		const t: FieldReference = {
			kind: 'field',
			fieldType: { kind: 'class', name: 'BlockPos', fqn: 'net.minecraft.util.math.BlockPos' },
		};
		expect(t.kind).toBe('field');
		expect(t.fieldType.kind).toBe('class');
	});

	it('supports discrimination via kind field', () => {
		const check = (m: MemberReference): string => {
			switch (m.kind) {
				case 'method': return `method(${m.parameters.length})`;
				case 'field': return `field`;
			}
		};

		const method: MemberReference = { kind: 'method', parameters: [], returnType: null };
		const field: MemberReference = { kind: 'field', fieldType: { kind: 'primitive', name: 'int' } };
		expect(check(method)).toBe('method(0)');
		expect(check(field)).toBe('field');
	});
});
