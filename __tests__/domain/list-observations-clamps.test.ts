/**
 * @vitest-environment node
 *
 * __tests__/domain/list-observations-clamps.test.ts — pagination clamps for
 * the `listObservations` domain op (lib/domain/observations/list-observations.ts).
 *
 * api-L1: `clampOffset` rejected NaN/negative but — unlike `clampLimit` — left
 * the offset UNBOUNDED, so `?offset=99999999` reached Prisma as a multi-million
 * `skip` (scan-and-discard). These lock the symmetric upper bound.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

const { mockFindMany } = vi.hoisted(() => ({ mockFindMany: vi.fn() }));

vi.mock("@/lib/server/species-scoped-prisma", () => ({
  crossSpecies: () => ({ observation: { findMany: mockFindMany } }),
}));

import {
  listObservations,
  OBSERVATIONS_MAX_OFFSET,
  OBSERVATIONS_MAX_LIMIT,
  OBSERVATIONS_DEFAULT_LIMIT,
} from "@/lib/domain/observations/list-observations";

const prisma = {} as unknown as PrismaClient;

beforeEach(() => {
  mockFindMany.mockReset();
  mockFindMany.mockResolvedValue([]);
});

describe("listObservations pagination clamps", () => {
  it("caps an absurd offset at MAX_OFFSET (api-L1)", async () => {
    await listObservations(prisma, { offset: 99_999_999 });
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: OBSERVATIONS_MAX_OFFSET }),
    );
  });

  it("clamps a negative offset to 0", async () => {
    await listObservations(prisma, { offset: -5 });
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0 }),
    );
  });

  it("clamps a NaN offset to 0", async () => {
    await listObservations(prisma, { offset: Number.NaN });
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0 }),
    );
  });

  it("passes a valid in-range offset through unchanged", async () => {
    await listObservations(prisma, { offset: 42 });
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 42 }),
    );
  });

  it("still caps limit at MAX_LIMIT (regression guard for the sibling clamp)", async () => {
    await listObservations(prisma, { limit: 9_999 });
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: OBSERVATIONS_MAX_LIMIT }),
    );
  });

  it("defaults an omitted limit to DEFAULT_LIMIT and offset to 0", async () => {
    await listObservations(prisma, {});
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: OBSERVATIONS_DEFAULT_LIMIT,
        skip: 0,
      }),
    );
  });
});
