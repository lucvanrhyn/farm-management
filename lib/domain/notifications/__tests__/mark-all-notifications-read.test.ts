/**
 * @vitest-environment node
 *
 * Wave F (#163) — domain op: `markAllNotificationsRead`.
 *
 * The Notification model has no `userEmail` column (single-user-per-farm
 * design preserved from pre-Wave-F). The op marks every unread row in the
 * tenant DB as read. Adding per-user scope would require a schema migration
 * — out of scope for this wave.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { markAllNotificationsRead } from "../mark-all-notifications-read";

describe("markAllNotificationsRead(prisma)", () => {
  const updateMany = vi.fn();
  const prisma = {
    notification: { updateMany },
  } as unknown as PrismaClient;

  beforeEach(() => {
    updateMany.mockReset();
    updateMany.mockResolvedValue({ count: 0 });
  });

  it("calls updateMany with { isRead: false } filter and { isRead: true } data", async () => {
    await markAllNotificationsRead(prisma);

    expect(updateMany).toHaveBeenCalledWith({
      where: { isRead: false },
      data: { isRead: true },
    });
  });

  it("returns { success: true } regardless of how many rows were updated", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    expect(await markAllNotificationsRead(prisma)).toEqual({ success: true });

    updateMany.mockResolvedValue({ count: 17 });
    expect(await markAllNotificationsRead(prisma)).toEqual({ success: true });
  });
});
