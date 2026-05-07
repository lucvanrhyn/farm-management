/**
 * @vitest-environment node
 *
 * Wave C (#156) — domain op: `attachObservationPhoto`.
 *
 * Persists an `attachmentUrl` onto an existing observation row. Throws
 * `ObservationNotFoundError` when the row does not exist; the adapter
 * envelope maps it onto a 404.
 *
 * Validation of the URL shape (non-empty string) is a transport
 * concern enforced by the route's schema — the domain op assumes a
 * valid string by the time it runs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { attachObservationPhoto } from "../attach-photo";
import { ObservationNotFoundError } from "../errors";

describe("attachObservationPhoto(prisma, input)", () => {
  const findUnique = vi.fn();
  const update = vi.fn();
  const prisma = {
    observation: { findUnique, update },
  } as unknown as PrismaClient;

  beforeEach(() => {
    findUnique.mockReset();
    update.mockReset();
  });

  it("throws ObservationNotFoundError when the row does not exist", async () => {
    findUnique.mockResolvedValue(null);

    await expect(
      attachObservationPhoto(prisma, {
        id: "missing",
        attachmentUrl: "https://cdn/example.jpg",
      }),
    ).rejects.toBeInstanceOf(ObservationNotFoundError);
    expect(update).not.toHaveBeenCalled();
  });

  it("persists attachmentUrl and returns success + url", async () => {
    findUnique.mockResolvedValue({ id: "obs-1" });
    update.mockResolvedValue({
      id: "obs-1",
      attachmentUrl: "https://cdn/example.jpg",
    });

    const result = await attachObservationPhoto(prisma, {
      id: "obs-1",
      attachmentUrl: "https://cdn/example.jpg",
    });

    expect(result).toEqual({
      success: true,
      attachmentUrl: "https://cdn/example.jpg",
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: "obs-1" },
      data: { attachmentUrl: "https://cdn/example.jpg" },
    });
  });
});
