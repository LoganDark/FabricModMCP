// TypeReference union -- discriminated by `kind`
export type PrimitiveType = { kind: "primitive"; name: string; }
export type ClassType = { kind: "class"; name: string; fqn: string; }
export type ArrayType = { kind: "array"; elementType: TypeReference; }
export type VarargType = { kind: "vararg"; elementType: TypeReference; }
export type VoidType = { kind: "void"; }
export type UnresolvedType = { kind: "unresolved"; rawType: string; }

export type TypeReference = PrimitiveType | ClassType | ArrayType | VarargType | VoidType | UnresolvedType;

// ParameterInfo -- a single parameter in a method signature
export type ParameterInfo = {
	name: string | null;  // parameter name if available (usually null from JDT LS detail strings)
	type: TypeReference;
}

// MemberReference union -- discriminated by `kind`
export type MethodReference = {
	kind: "method";
	parameters: ParameterInfo[];
	returnType: TypeReference | null;  // null for constructors
}

export type FieldReference = {
	kind: "field";
	fieldType: TypeReference;
}

export type MemberReference = MethodReference | FieldReference;
