import { describe, it, expect } from 'vitest';
import { parsePomDependencies } from '../../src/project/pom-parser.js';

describe('parsePomDependencies', () => {
	it('extracts groupId, artifactId, version, scope from dependency blocks', () => {
		const pom = `
<project>
  <dependencies>
    <dependency>
      <groupId>com.google.code.gson</groupId>
      <artifactId>gson</artifactId>
      <version>2.13.2</version>
      <scope>compile</scope>
    </dependency>
  </dependencies>
</project>`;
		const deps = parsePomDependencies(pom);
		expect(deps).toHaveLength(1);
		expect(deps[0]).toEqual({
			groupId: 'com.google.code.gson',
			artifactId: 'gson',
			version: '2.13.2',
			scope: 'compile',
		});
	});

	it('strips dependencyManagement section before parsing', () => {
		const pom = `
<project>
  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>managed.group</groupId>
        <artifactId>managed-artifact</artifactId>
        <version>1.0.0</version>
      </dependency>
    </dependencies>
  </dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>real.group</groupId>
      <artifactId>real-artifact</artifactId>
      <version>2.0.0</version>
    </dependency>
  </dependencies>
</project>`;
		const deps = parsePomDependencies(pom);
		expect(deps).toHaveLength(1);
		expect(deps[0].groupId).toBe('real.group');
		expect(deps[0].artifactId).toBe('real-artifact');
	});

	it('strips XML comments before parsing', () => {
		const pom = `
<project>
  <dependencies>
    <!-- This is a comment containing <dependency> tags -->
    <dependency>
      <groupId>net.fabricmc</groupId>
      <artifactId>fabric-loader</artifactId>
      <version>0.16.14</version>
    </dependency>
  </dependencies>
</project>`;
		const deps = parsePomDependencies(pom);
		expect(deps).toHaveLength(1);
		expect(deps[0].groupId).toBe('net.fabricmc');
	});

	it('defaults scope to compile when scope element is absent', () => {
		const pom = `
<project>
  <dependencies>
    <dependency>
      <groupId>io.netty</groupId>
      <artifactId>netty-all</artifactId>
      <version>4.1.118.Final</version>
    </dependency>
  </dependencies>
</project>`;
		const deps = parsePomDependencies(pom);
		expect(deps).toHaveLength(1);
		expect(deps[0].scope).toBe('compile');
	});

	it('skips dependencies missing groupId, artifactId, or version', () => {
		const pom = `
<project>
  <dependencies>
    <dependency>
      <groupId>valid.group</groupId>
      <artifactId>valid-artifact</artifactId>
      <version>1.0.0</version>
    </dependency>
    <dependency>
      <groupId>no.version</groupId>
      <artifactId>missing-version</artifactId>
    </dependency>
    <dependency>
      <artifactId>missing-group</artifactId>
      <version>1.0.0</version>
    </dependency>
    <dependency>
      <groupId>no.artifact</groupId>
      <version>1.0.0</version>
    </dependency>
  </dependencies>
</project>`;
		const deps = parsePomDependencies(pom);
		expect(deps).toHaveLength(1);
		expect(deps[0].groupId).toBe('valid.group');
	});

	it('returns empty array for POM with no dependencies', () => {
		const pom = `
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>empty</artifactId>
  <version>1.0.0</version>
</project>`;
		const deps = parsePomDependencies(pom);
		expect(deps).toEqual([]);
	});

	it('handles real-world POM with dependencyManagement, comments, and mixed scopes', () => {
		const pom = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>net.fabricmc.fabric-api</groupId>
  <artifactId>fabric-api</artifactId>
  <version>0.141.3+1.21.11</version>
  <packaging>pom</packaging>

  <!-- Managed versions for submodules -->
  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>net.fabricmc.fabric-api</groupId>
        <artifactId>fabric-api-bom</artifactId>
        <version>0.141.3+1.21.11</version>
        <type>pom</type>
        <scope>import</scope>
      </dependency>
    </dependencies>
  </dependencyManagement>

  <dependencies>
    <!-- Core networking -->
    <dependency>
      <groupId>net.fabricmc.fabric-api</groupId>
      <artifactId>fabric-networking-api-v1</artifactId>
      <version>4.3.1+1.21.11</version>
      <scope>compile</scope>
    </dependency>
    <!-- Rendering support -->
    <dependency>
      <groupId>net.fabricmc.fabric-api</groupId>
      <artifactId>fabric-rendering-v1</artifactId>
      <version>8.0.0+1.21.11</version>
    </dependency>
    <!-- Test framework (should be included with test scope) -->
    <dependency>
      <groupId>net.fabricmc.fabric-api</groupId>
      <artifactId>fabric-gametest-api-v1</artifactId>
      <version>2.0.0+1.21.11</version>
      <scope>test</scope>
    </dependency>
  </dependencies>
</project>`;
		const deps = parsePomDependencies(pom);
		expect(deps).toHaveLength(3);

		// Managed dependency should NOT appear
		expect(deps.find(d => d.artifactId === 'fabric-api-bom')).toBeUndefined();

		// Compile scope explicit
		expect(deps[0]).toEqual({
			groupId: 'net.fabricmc.fabric-api',
			artifactId: 'fabric-networking-api-v1',
			version: '4.3.1+1.21.11',
			scope: 'compile',
		});

		// Default compile scope
		expect(deps[1].artifactId).toBe('fabric-rendering-v1');
		expect(deps[1].scope).toBe('compile');

		// Test scope preserved
		expect(deps[2].artifactId).toBe('fabric-gametest-api-v1');
		expect(deps[2].scope).toBe('test');
	});
});
