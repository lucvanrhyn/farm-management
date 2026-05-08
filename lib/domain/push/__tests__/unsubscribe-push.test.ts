/**
 * @vitest-environment node
 *
 * Wave F (#163) — domain op: `unsubscribePush`.
 *
 * Removes a `PushSubscription` row identified by `endpoint`, scoped by
 * `userEmail` so no caller can unsubscribe another user's device. Uses
 * `deleteMany` so a missing row is a silent no-op (idempotent unsubscribe).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { unsubscribePush } from "../unsubscribe-push";
import { MissingEndpointError } from "../errors";

describe("unsubscribePush(prisma, userEmail, endpoint)", () => {
  const deleteMany = vi.fn();
  const prisma = {
    pushSubscription: { deleteMany },
  } as unknown as PrismaClient;

  beforeEach(() => {
    deleteMany.mockReset();
    deleteMany.mockResolvedValue({ count: 1 });
  });

  it("calls deleteMany with where { endpoint, userEmail }", async () => {
    await unsubscribePush(
      prisma,
      "alice@example.com",
      "https://push.example.com/abc",
    );

    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        endpoint: "https://push.example.com/abc",
        userEmail: "alice@example.com",
      },
    });
  });

  it("returns { success: true } on happy path", async () => {
    const result = await unsubscribePush(
      prisma,
      "alice@example.com",
      "https://push.example.com/abc",
    );

    expect(result).toEqual({ success: true });
  });

  it("returns { success: true } when no row matched (idempotent)", async () => {
    deleteMany.mockResolvedValue({ count: 0 });

    const result = await unsubscribePush(
      prisma,
      "alice@example.com",
      "https://push.example.com/missing",
    );

    expect(result).toEqual({ success: true });
  });

  it("throws MissingEndpointError when endpoint is empty", async () => {
    await expect(
      unsubscribePush(prisma, "alice@example.com", ""),
    ).rejects.toBeInstanceOf(MissingEndpointError);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("scopes deletion by userEmail (cannot drop another user's subscription)", async () => {
    await unsubscribePush(
      prisma,
      "bob@example.com",
      "https://push.example.com/abc",
    );

    const where = deleteMany.mock.calls[0][0].where;
    expect(where.userEmail).toBe("bob@example.com");
  });
});
