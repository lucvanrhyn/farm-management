/**
 * @vitest-environment node
 *
 * Wave C (#156) — domain op: `updateObservation`.
 *
 * Mutates `details` on an existing observation, appending an entry to
 * `editHistory` so prior `details` payloads are recoverable. The
 * audit-trail array is capped at 50 entries to prevent unbounded
 * growth.
 *
 * Throws `ObservationNotFoundError` when the row does not exist.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { updateObservation } from "../update-observation";
import { ObservationNotFoundError } from "../errors";

describe("updateObservation(prisma, input)", () => {
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
      updateObservation(prisma, {
        id: "missing",
        details: "{}",
        editedBy: "u@x.co.za",
      }),
    ).rejects.toBeInstanceOf(ObservationNotFoundError);
    expect(update).not.toHaveBeenCalled();
  });

  it("appends to editHistory and persists new details", async () => {
    findUnique.mockResolvedValue({
      id: "obs-1",
      details: "{\"v\":1}",
      editHistory: null,
    });
    const updated = { id: "obs-1", details: "{\"v\":2}" };
    update.mockResolvedValue(updated);

    const result = await updateObservation(prisma, {
      id: "obs-1",
      details: "{\"v\":2}",
      editedBy: "u@x.co.za",
    });

    expect(result).toBe(updated);
    expect(update).toHaveBeenCalledTimes(1);
    const call = update.mock.calls[0][0];
    expect(call.where).toEqual({ id: "obs-1" });
    expect(call.data.details).toBe("{\"v\":2}");
    expect(call.data.editedBy).toBe("u@x.co.za");
    expect(call.data.editedAt).toBeInstanceOf(Date);
    const history = JSON.parse(call.data.editHistory);
    expect(Array.isArray(history)).toBe(true);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      editedBy: "u@x.co.za",
      previousDetails: "{\"v\":1}",
    });
  });

  it("caps editHistory at 50 entries (drops oldest)", async () => {
    const oldHistory = Array.from({ length: 50 }, (_, i) => ({
      editedBy: `u${i}@x.co.za`,
      editedAt: new Date(2026, 0, i + 1).toISOString(),
      previousDetails: `{\"v\":${i}}`,
    }));
    findUnique.mockResolvedValue({
      id: "obs-1",
      details: "{\"v\":50}",
      editHistory: JSON.stringify(oldHistory),
    });
    update.mockResolvedValue({});

    await updateObservation(prisma, {
      id: "obs-1",
      details: "{\"v\":51}",
      editedBy: "newu@x.co.za",
    });

    const call = update.mock.calls[0][0];
    const history = JSON.parse(call.data.editHistory);
    expect(history).toHaveLength(50);
    // Oldest entry (u0) dropped; newest entry kept.
    expect(history[0].editedBy).toBe("u1@x.co.za");
    expect(history[history.length - 1].editedBy).toBe("newu@x.co.za");
  });
});
