import { describe, it, expect } from 'vitest';
import { buildMemberFqn } from '../../src/browsing/member-fqn.js';

describe('buildMemberFqn', () => {
	it('returns method FQN with parens suffix', () => {
		expect(buildMemberFqn("net.minecraft.client.MinecraftClient", "tick", "method"))
			.toBe("net.minecraft.client.MinecraftClient#tick()");
	});

	it('strips existing parens from method name to prevent double-parens', () => {
		expect(buildMemberFqn("net.minecraft.client.MinecraftClient", "tick()", "method"))
			.toBe("net.minecraft.client.MinecraftClient#tick()");
	});

	it('returns constructor FQN with parens suffix', () => {
		expect(buildMemberFqn("net.minecraft.client.MinecraftClient", "MinecraftClient()", "constructor"))
			.toBe("net.minecraft.client.MinecraftClient#MinecraftClient()");
	});

	it('returns field FQN with colon suffix', () => {
		expect(buildMemberFqn("net.minecraft.client.MinecraftClient", "instance", "field"))
			.toBe("net.minecraft.client.MinecraftClient#instance:");
	});

	it('returns constant FQN with colon suffix', () => {
		expect(buildMemberFqn("net.minecraft.client.MinecraftClient", "MAX_COUNT", "constant"))
			.toBe("net.minecraft.client.MinecraftClient#MAX_COUNT:");
	});

	it('returns enumMember FQN with colon suffix', () => {
		expect(buildMemberFqn("net.minecraft.server.Status", "ONLINE", "enumMember"))
			.toBe("net.minecraft.server.Status#ONLINE:");
	});

	it('returns null for class kind', () => {
		expect(buildMemberFqn("net.minecraft.client.MinecraftClient", "MinecraftClient", "class"))
			.toBeNull();
	});

	it('returns null for interface kind', () => {
		expect(buildMemberFqn("net.minecraft.client.MinecraftClient", "Options", "interface"))
			.toBeNull();
	});

	it('returns null for enum kind', () => {
		expect(buildMemberFqn("net.minecraft.client.MinecraftClient", "State", "enum"))
			.toBeNull();
	});
});
