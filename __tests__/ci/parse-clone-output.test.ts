/**
 * @vitest-environment node
 *
 * Unit tests for scripts/ci/parse-clone-output.ts
 *
 * Tests the pure parseCloneOutput function in isolation.
 * The CLI entry point wires stdin → function → stdout; we test the function directly.
 */
import { describe, it, expect } from 'vitest';
import { parseCloneOutput } from '../../scripts/ci/parse-clone-output';

describe('parseCloneOutput', () => {
  it('1. valid JSON with both fields emits two correct lines', () => {
    const input = JSON.stringify({
      tursoDbUrl: 'libsql://ft-clone-my-branch.turso.io',
      tursoAuthToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.test',
    });
    const result = parseCloneOutput(input);
    expect(result).toBe(
      'TURSO_DATABASE_URL=libsql://ft-clone-my-branch.turso.io\n' +
      'TURSO_AUTH_TOKEN=eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.test',
    );
  });

  it('2. JSON missing tursoDbUrl throws with clear message', () => {
    const input = JSON.stringify({
      tursoAuthToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.test',
    });
    expect(() => parseCloneOutput(input)).toThrow(/tursoDbUrl/);
  });

  it('3. JSON missing tursoAuthToken throws', () => {
    const input = JSON.stringify({
      tursoDbUrl: 'libsql://ft-clone-my-branch.turso.io',
    });
    expect(() => parseCloneOutput(input)).toThrow(/tursoAuthToken/);
  });

  it('4. non-JSON input throws', () => {
    expect(() => parseCloneOutput('not-json')).toThrow();
  });

  it('5. extra fields (alreadyExisted, branchName, etc.) are ignored', () => {
    const input = JSON.stringify({
      branchName: 'wave/21-ci-governance-gate',
      tursoDbName: 'ft-clone-wave-21',
      tursoDbUrl: 'libsql://ft-clone-wave-21.turso.io',
      tursoAuthToken: 'tok.abc123',
      alreadyExisted: true,
    });
    const result = parseCloneOutput(input);
    expect(result).toBe(
      'TURSO_DATABASE_URL=libsql://ft-clone-wave-21.turso.io\n' +
      'TURSO_AUTH_TOKEN=tok.abc123',
    );
  });
});
