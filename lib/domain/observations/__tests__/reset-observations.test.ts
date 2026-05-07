/**
 * @vitest-environment node
 *
 * Wave C (#156) — domain op: `resetObservations`.
 *
 * Bulk-deletes every observation row for the calling tenant. Used by
 * the admin reset surface. Returns the deleted-row count for observability.
 */
import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { resetObservations } from "../reset-observations";

describe("resetObservations(prisma)", () => {
  it("deletes every row in the tenant and returns success", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 42 });
    const prisma = {
      observation: { deleteMany },
    } as unknown as PrismaClient;

    const result = await resetObservations(prisma);

    expect(deleteMany).toHaveBeenCalledWith({});
    expect(result).toEqual({ success: true, count: 42 });
  });
});
