// TypeReference union -- discriminated by `kind`
export interface PrimitiveType { kind: "primitive"; name: string; }
export interface ClassType { kind: "class"; name: string; fqn: string; }
export interface ArrayType { kind: "array"; elementType: TypeReference; }
export interface VarargType { kind: "vararg"; elementType: TypeReference; }
export interface VoidType { kind: "void"; }
export interface UnresolvedType { kind: "unresolved"; rawType: string; }

export type TypeReference = PrimitiveType | ClassType | ArrayType | VarargType | VoidType | UnresolvedType;

// ParameterInfo -- a single parameter in a method signature
export interface ParameterInfo {
	name: string | null;  // parameter name if available (usually null from JDT LS detail strings)
	type: TypeReference;
}

// MemberReference union -- discriminated by `kind`
export interface MethodReference {
	kind: "method";
	parameters: ParameterInfo[];
	returnType: TypeReference | null;  // null for constructors
}

export interface FieldReference {
	kind: "field";
	fieldType: TypeReference;
}

export type MemberReference = MethodReference | FieldReference;
