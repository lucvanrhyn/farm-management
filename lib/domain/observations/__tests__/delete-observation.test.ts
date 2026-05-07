/**
 * @vitest-environment node
 *
 * Wave C (#156) — domain op: `deleteObservation`.
 *
 * Removes an observation row by id. Throws `ObservationNotFoundError`
 * when the row does not exist; the adapter envelope maps it onto a 404.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { deleteObservation } from "../delete-observation";
import { ObservationNotFoundError } from "../errors";

describe("deleteObservation(prisma, id)", () => {
  const findUnique = vi.fn();
  const del = vi.fn();
  const prisma = {
    observation: { findUnique, delete: del },
  } as unknown as PrismaClient;

  beforeEach(() => {
    findUnique.mockReset();
    del.mockReset();
  });

  it("throws ObservationNotFoundError when the row does not exist", async () => {
    findUnique.mockResolvedValue(null);

    await expect(deleteObservation(prisma, "missing")).rejects.toBeInstanceOf(
      ObservationNotFoundError,
    );
    expect(del).not.toHaveBeenCalled();
  });

  it("deletes the row and returns success when it exists", async () => {
    findUnique.mockResolvedValue({ id: "obs-1" });
    del.mockResolvedValue({ id: "obs-1" });

    const result = await deleteObservation(prisma, "obs-1");

    expect(result).toEqual({ success: true });
    expect(del).toHaveBeenCalledWith({ where: { id: "obs-1" } });
  });
});
