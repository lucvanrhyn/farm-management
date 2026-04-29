/**
 * Tests for lib/ops/turso-cli.ts
 *
 * The real TursoCli delegates to child_process.execFile. These tests exercise
 * that path hermetically by overriding TURSO_BINARY to point to `node` and
 * passing tiny inline scripts. No actual `turso` binary is invoked.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { realTursoCli, TursoCliError } from '@/lib/ops/turso-cli';

// We override TURSO_BINARY to `node` so the CLI wrapper runs `node` instead of
// the real turso binary. Each test passes node-script args to exercise stdout /
// exit-code behaviour.
const NODE_BIN = process.execPath; // absolute path to the current node binary

let originalBinary: string | undefined;
let originalToken: string | undefined;

beforeEach(() => {
  originalBinary = process.env.TURSO_BINARY;
  originalToken = process.env.TURSO_API_TOKEN;
  process.env.TURSO_BINARY = NODE_BIN;
  // Clear token so it doesn't interfere with arg-shape tests
  delete process.env.TURSO_API_TOKEN;
});

afterEach(() => {
  if (originalBinary === undefined) {
    delete process.env.TURSO_BINARY;
  } else {
    process.env.TURSO_BINARY = originalBinary;
  }
  if (originalToken === undefined) {
    delete process.env.TURSO_API_TOKEN;
  } else {
    process.env.TURSO_API_TOKEN = originalToken;
  }
});

describe('TursoCliError', () => {
  it('is an instance of Error', () => {
    const err = new TursoCliError(['db', 'create'], 1, 'stderr text');
    expect(err).toBeInstanceOf(Error);
  });

  it('exposes args, exitCode, and stderr as properties', () => {
    const err = new TursoCliError(['db', 'show', 'mydb'], 2, 'some error');
    expect(err.args).toEqual(['db', 'show', 'mydb']);
    expect(err.exitCode).toBe(2);
    expect(err.stderr).toBe('some error');
  });

  it('includes args and exitCode in the message', () => {
    const err = new TursoCliError(['db', 'create', 'mydb'], 127, 'not found');
    expect(err.message).toContain('db create mydb');
    expect(err.message).toContain('127');
  });

  it('handles null exitCode (killed by signal)', () => {
    const err = new TursoCliError(['db', 'create'], null, '');
    expect(err.exitCode).toBeNull();
    expect(err.message).toBeTruthy();
  });
});

describe('realTursoCli.run', () => {
  it('returns stdout trimmed when process exits with code 0', async () => {
    // node -e "process.stdout.write('hello world')" exits 0
    const result = await realTursoCli.run(['-e', "process.stdout.write('hello world')"]);
    expect(result).toBe('hello world');
  });

  it('trims trailing newline from stdout', async () => {
    const result = await realTursoCli.run(['-e', "console.log('trimmed')"]);
    expect(result).toBe('trimmed');
  });

  it('returns full multi-line stdout', async () => {
    const result = await realTursoCli.run([
      '-e',
      "console.log('line1'); console.log('line2');",
    ]);
    expect(result).toBe('line1\nline2');
  });

  it('throws TursoCliError when process exits with non-zero code', async () => {
    await expect(
      realTursoCli.run(['-e', 'process.exit(2)']),
    ).rejects.toBeInstanceOf(TursoCliError);
  });

  it('TursoCliError has correct exitCode on non-zero exit', async () => {
    const error = await realTursoCli.run(['-e', 'process.exit(7)']).catch((e) => e);
    expect(error).toBeInstanceOf(TursoCliError);
    expect((error as TursoCliError).exitCode).toBe(7);
  });

  it('TursoCliError captures stderr output', async () => {
    const error = await realTursoCli
      .run(['-e', "process.stderr.write('err msg'); process.exit(1)"])
      .catch((e) => e);
    expect(error).toBeInstanceOf(TursoCliError);
    expect((error as TursoCliError).stderr).toContain('err msg');
  });

  it('includes the args in TursoCliError', async () => {
    const args = ['-e', 'process.exit(3)'] as const;
    const error = await realTursoCli.run(args).catch((e) => e);
    expect((error as TursoCliError).args).toEqual(args);
  });

  it('reads TURSO_BINARY env var to select the binary', async () => {
    // We already set TURSO_BINARY = NODE_BIN in beforeEach, so this is the
    // implicit assertion — if it read 'turso' instead it would fail.
    const result = await realTursoCli.run(['-e', "process.stdout.write('ok')"]);
    expect(result).toBe('ok');
  });

  it('passes env vars through to the child process (TURSO_API_TOKEN visible)', async () => {
    process.env.TURSO_API_TOKEN = 'secret-token-test';
    const result = await realTursoCli.run([
      '-e',
      "process.stdout.write(process.env.TURSO_API_TOKEN || 'missing')",
    ]);
    expect(result).toBe('secret-token-test');
  });

  it('handles empty stdout gracefully (returns empty string)', async () => {
    const result = await realTursoCli.run(['-e', '// no output']);
    expect(result).toBe('');
  });

  it('throws TursoCliError (not a plain Error) for non-zero exit', async () => {
    const error = await realTursoCli.run(['-e', 'process.exit(1)']).catch((e) => e);
    // Must be specifically TursoCliError so callers can narrow on it
    expect(error.constructor.name).toBe('TursoCliError');
  });
});
