/**
 * @vitest-environment node
 *
 * Wave F (#163) — domain op: `markNotificationRead`.
 *
 * Marks a single notification by id as read. Uses `updateMany` so a missing
 * id is a silent no-op (matches pre-Wave-F behaviour — admin UI relied on
 * the call returning success even when the cached row was stale).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { markNotificationRead } from "../mark-notification-read";

describe("markNotificationRead(prisma, id)", () => {
  const updateMany = vi.fn();
  const prisma = {
    notification: { updateMany },
  } as unknown as PrismaClient;

  beforeEach(() => {
    updateMany.mockReset();
    updateMany.mockResolvedValue({ count: 1 });
  });

  it("calls updateMany with { id } filter and { isRead: true } data", async () => {
    await markNotificationRead(prisma, "notif-abc");

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "notif-abc" },
      data: { isRead: true },
    });
  });

  it("returns { success: true } when row was updated", async () => {
    updateMany.mockResolvedValue({ count: 1 });
    expect(await markNotificationRead(prisma, "notif-1")).toEqual({
      success: true,
    });
  });

  it("returns { success: true } even when no row matches (silent no-op)", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    expect(await markNotificationRead(prisma, "missing-id")).toEqual({
      success: true,
    });
  });
});
