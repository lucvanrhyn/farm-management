// @vitest-environment node
/**
 * scripts/__tests__/audit-raw-getsession.test.ts
 *
 * Unit tests for the raw-getServerSession ban-rule script (#522).
 *
 * The script detects `getServerSession(authOptions)` calls outside
 * `lib/auth.ts` that are not covered by the baseline allowlist.
 *
 * Shape mirrors audit-findmany-no-select.test.ts — pure function tests
 * on the exported `auditSource` + `offenderKey` surface, no CLI subprocess.
 */

import { describe, it, expect } from 'vitest';
import { auditSource, offenderKey, type RawSessionOffender } from '../audit-raw-getsession';

describe('auditSource — raw getServerSession detection', () => {
  it('flags a file that calls getServerSession(authOptions)', () => {
    const source = `
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
const session = await getServerSession(authOptions);
`.trim();
    const offenders = auditSource('app/some/page.tsx', source);
    expect(offenders).toHaveLength(1);
    expect(offenders[0].path).toBe('app/some/page.tsx');
  });

  it('returns empty array for a file with no getServerSession call', () => {
    const source = `
import { getSession } from '@/lib/auth';
const session = await getSession();
`.trim();
    expect(auditSource('lib/something.ts', source)).toEqual([]);
  });

  it('returns empty array for lib/auth.ts (the canonical wrapper — always exempt)', () => {
    // lib/auth.ts IS the one permitted place. The script itself skips it.
    const source = `
import { getServerSession } from 'next-auth';
import { authOptions } from './auth-options';
export function getSession() {
  return getServerSession(authOptions);
}
`.trim();
    // lib/auth.ts is checked in the CLI by never scanning it; auditSource
    // itself should still detect the pattern — exemption is path-level,
    // handled by the CLI caller. Test with an arbitrary path:
    const offenders = auditSource('lib/auth.ts', source);
    // The function DOES find it; the CLI skips the file before calling auditSource.
    // This is intentional — mirrors how findmany works.
    expect(offenders).toHaveLength(1);
  });

  it('flags the call even when getServerSession is imported from "next-auth" with double quotes', () => {
    const source = `
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
const s = await getServerSession(authOptions);
`.trim();
    expect(auditSource('app/page.tsx', source)).toHaveLength(1);
  });

  it('does NOT flag a file that only mentions getServerSession in a comment', () => {
    const source = `
// Legacy: const session = await getServerSession(authOptions);
import { getSession } from '@/lib/auth';
const session = await getSession();
`.trim();
    expect(auditSource('app/page.tsx', source)).toEqual([]);
  });

  it('does NOT flag a file that only mentions getServerSession in a block comment', () => {
    const source = `
/*
 * This module previously called getServerSession(authOptions) directly.
 * Now it uses the consolidated getSession() helper from lib/auth.
 */
import { getSession } from '@/lib/auth';
`.trim();
    expect(auditSource('lib/some.ts', source)).toEqual([]);
  });

  it('does NOT flag when getServerSession appears only in a string literal', () => {
    const source = `
const desc = "calls getServerSession(authOptions) internally";
`.trim();
    expect(auditSource('lib/some.ts', source)).toEqual([]);
  });

  it('flags each raw call site separately in the same file', () => {
    const source = `
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
const s1 = await getServerSession(authOptions);
const s2 = await getServerSession(authOptions);
`.trim();
    const offenders = auditSource('app/multi.tsx', source);
    expect(offenders).toHaveLength(2);
    expect(offenders[0].occurrenceIndex).toBe(0);
    expect(offenders[1].occurrenceIndex).toBe(1);
  });

  it('reports the correct line number for the offending call', () => {
    const source = [
      `import { getServerSession } from 'next-auth';`,
      `import { authOptions } from '@/lib/auth-options';`,
      ``,
      `const session = await getServerSession(authOptions);`,
    ].join('\n');
    const offenders = auditSource('app/some/page.tsx', source);
    expect(offenders).toHaveLength(1);
    expect(offenders[0].line).toBe(4);
  });

  it('does NOT flag a file that uses getSession() from lib/auth (the canonical form)', () => {
    const source = `
import { getSession } from '@/lib/auth';
const session = await getSession();
`.trim();
    expect(auditSource('app/page.tsx', source)).toEqual([]);
  });
});

describe('offenderKey', () => {
  it('produces a stable path::occurrenceIndex key for baseline diffing', () => {
    const o: RawSessionOffender = {
      path: 'app/some/page.tsx',
      line: 10,
      snippet: 'const session = await getServerSession(authOptions);',
      occurrenceIndex: 0,
    };
    expect(offenderKey(o)).toBe('app/some/page.tsx::0');
  });
});
