// @vitest-environment node
/**
 * Tests for scripts/audit-schema-parity.ts — `resolveExpectedPrismaSchema(deps)`
 * helper that decides which `prisma/schema.prisma` content the audit's
 * column-parity check compares tenants against.
 *
 * Motivating bug (issue #215, 2026-05-11): the audit's column-parity arm
 * (`checkPrismaColumnParityAcrossTenants`) was reading `prisma/schema.prisma`
 * from the PR-branch working tree. Any PR that adds a new column to the
 * schema fails the gate by construction: the working tree has the new
 * column, the migration is in the same PR (not yet shipped to tenants),
 * so every tenant reports "missing column" drift. Empirically observed on
 * PR #214 (Observation.clientLocalId).
 *
 * This is exactly the same class of bug PR #185 (2026-05-10) fixed for
 * `resolveExpectedMigrations` — read the source of truth ("what is merged
 * on origin/main") instead of the PR-branch working tree. This helper
 * mirrors that one: dep-injection shape, logger pattern, fallback rules.
 *
 * Fallback semantics:
 *   - git returns `null` (unreachable: forks, shallow clones) → fall back
 *     to working tree (logged).
 *   - git returns empty string (pathological: file exists on main but is
 *     0 bytes — would break Prisma anyway) → fall back to working tree
 *     (logged). Using empty as the answer would yield zero expected
 *     columns and silently pass against any drift, which is the wrong
 *     direction for a structural backstop.
 *   - git returns a non-empty schema → use it as authoritative.
 *
 * Tests use the exported `resolveExpectedPrismaSchema(deps)` with injected
 * fakes — no real `git` invocation, no filesystem read.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  resolveExpectedPrismaSchema,
  type ResolveExpectedPrismaSchemaDeps,
} from '@/scripts/audit-schema-parity';

const SAMPLE_SCHEMA_MAIN = `
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("TURSO_DATABASE_URL")
}

model Animal {
  id        String @id
  species   String
}
`;

const SAMPLE_SCHEMA_WORKING_TREE = `
${SAMPLE_SCHEMA_MAIN}

model Observation {
  id            String  @id
  clientLocalId String?
}
`;

function makeDeps(
  overrides?: Partial<ResolveExpectedPrismaSchemaDeps>,
): ResolveExpectedPrismaSchemaDeps {
  return {
    gitReadBaseRefPrismaSchema: vi.fn(async () => null),
    fsLoadPrismaSchemaFromWorkingTree: vi.fn(async () => ''),
    log: vi.fn(),
    ...overrides,
  };
}

describe('resolveExpectedPrismaSchema — base-ref aware', () => {
  it('returns the schema merged on origin/main, ignoring new-in-PR fields', async () => {
    // Simulates PR #214's scenario: working tree has Observation.clientLocalId,
    // but origin/main doesn't yet. Tenants are only expected to match what's
    // on main, so the new column must be excluded from the drift check.
    const deps = makeDeps({
      gitReadBaseRefPrismaSchema: vi.fn(async () => SAMPLE_SCHEMA_MAIN),
      fsLoadPrismaSchemaFromWorkingTree: vi.fn(async () => SAMPLE_SCHEMA_WORKING_TREE),
    });

    const result = await resolveExpectedPrismaSchema(deps);

    expect(result).toBe(SAMPLE_SCHEMA_MAIN);
    expect(result).not.toContain('clientLocalId');
    expect(deps.gitReadBaseRefPrismaSchema).toHaveBeenCalledTimes(1);
    expect(deps.fsLoadPrismaSchemaFromWorkingTree).not.toHaveBeenCalled();
  });

  it('falls back to the working tree when origin/main is unreachable (forks, fresh clones without fetch-depth: 0)', async () => {
    const deps = makeDeps({
      gitReadBaseRefPrismaSchema: vi.fn(async () => null), // signals "git couldn't read base ref"
      fsLoadPrismaSchemaFromWorkingTree: vi.fn(async () => SAMPLE_SCHEMA_WORKING_TREE),
    });

    const result = await resolveExpectedPrismaSchema(deps);

    expect(result).toBe(SAMPLE_SCHEMA_WORKING_TREE);
    expect(deps.fsLoadPrismaSchemaFromWorkingTree).toHaveBeenCalledTimes(1);
    expect(deps.log).toHaveBeenCalledWith(
      expect.stringMatching(/origin\/main not reachable|falling back to working tree/i),
    );
  });

  it('falls back to the working tree when origin/main returns an empty schema (pathological / file not on main yet)', async () => {
    // Edge case: `git show origin/main:prisma/schema.prisma` returns "" only
    // if the file exists on main but is genuinely 0 bytes — would break
    // Prisma in prod. More likely the impl returned "" via some other path
    // (e.g. a brand-new PR adding the file for the first time). Either way,
    // using empty as the answer yields zero expected columns and silently
    // passes against any drift — the wrong direction for a structural
    // backstop. Fall back to working tree (logged).
    const deps = makeDeps({
      gitReadBaseRefPrismaSchema: vi.fn(async () => ''),
      fsLoadPrismaSchemaFromWorkingTree: vi.fn(async () => SAMPLE_SCHEMA_WORKING_TREE),
    });

    const result = await resolveExpectedPrismaSchema(deps);

    expect(result).toBe(SAMPLE_SCHEMA_WORKING_TREE);
    expect(deps.fsLoadPrismaSchemaFromWorkingTree).toHaveBeenCalledTimes(1);
    expect(deps.log).toHaveBeenCalledWith(
      expect.stringMatching(/empty|falling back to working tree/i),
    );
  });

  it('does not fall back when origin/main returns a non-empty schema (even a short one)', async () => {
    // Defensive: anything non-empty is treated as authoritative. The audit
    // pipeline (parsePrismaSchema → expectedColumnsByTable) gracefully
    // handles a schema with zero models — it just yields an empty
    // column-by-table map, which is the right answer for a fresh repo.
    const minimal = 'datasource db { provider = "sqlite" url = "file:./dev.db" }';
    const deps = makeDeps({
      gitReadBaseRefPrismaSchema: vi.fn(async () => minimal),
      fsLoadPrismaSchemaFromWorkingTree: vi.fn(async () => SAMPLE_SCHEMA_WORKING_TREE),
    });

    const result = await resolveExpectedPrismaSchema(deps);

    expect(result).toBe(minimal);
    expect(deps.fsLoadPrismaSchemaFromWorkingTree).not.toHaveBeenCalled();
    expect(deps.log).not.toHaveBeenCalled();
  });
});
