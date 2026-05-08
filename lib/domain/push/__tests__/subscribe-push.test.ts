/**
 * @vitest-environment node
 *
 * Wave F (#163) — domain op: `subscribePush`.
 *
 * Upserts a `PushSubscription` row keyed by `endpoint`. Validates the
 * payload (endpoint + p256dh + auth all present) and binds the row to the
 * caller's `userEmail` so unsubscribe scoping is meaningful.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { subscribePush } from "../subscribe-push";
import { InvalidSubscriptionError } from "../errors";

const VALID_INPUT = {
  endpoint: "https://push.example.com/abc",
  keys: { p256dh: "p256dh-key", auth: "auth-key" },
};

describe("subscribePush(prisma, userEmail, input)", () => {
  const upsert = vi.fn();
  const prisma = {
    pushSubscription: { upsert },
  } as unknown as PrismaClient;

  beforeEach(() => {
    upsert.mockReset();
    upsert.mockResolvedValue({});
  });

  it("upserts with where { endpoint } and create payload binding userEmail", async () => {
    await subscribePush(prisma, "alice@example.com", VALID_INPUT);

    expect(upsert).toHaveBeenCalledWith({
      where: { endpoint: "https://push.example.com/abc" },
      create: {
        endpoint: "https://push.example.com/abc",
        p256dh: "p256dh-key",
        auth: "auth-key",
        userEmail: "alice@example.com",
      },
      update: {
        p256dh: "p256dh-key",
        auth: "auth-key",
        userEmail: "alice@example.com",
      },
    });
  });

  it("returns { success: true } on happy path", async () => {
    const result = await subscribePush(
      prisma,
      "alice@example.com",
      VALID_INPUT,
    );

    expect(result).toEqual({ success: true });
  });

  it("throws InvalidSubscriptionError when endpoint is missing", async () => {
    await expect(
      subscribePush(prisma, "alice@example.com", {
        endpoint: "",
        keys: { p256dh: "p", auth: "a" },
      }),
    ).rejects.toBeInstanceOf(InvalidSubscriptionError);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("throws InvalidSubscriptionError when keys.p256dh is missing", async () => {
    await expect(
      subscribePush(prisma, "alice@example.com", {
        endpoint: "https://push.example.com/abc",
        keys: { p256dh: "", auth: "a" },
      }),
    ).rejects.toBeInstanceOf(InvalidSubscriptionError);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("throws InvalidSubscriptionError when keys.auth is missing", async () => {
    await expect(
      subscribePush(prisma, "alice@example.com", {
        endpoint: "https://push.example.com/abc",
        keys: { p256dh: "p", auth: "" },
      }),
    ).rejects.toBeInstanceOf(InvalidSubscriptionError);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("throws InvalidSubscriptionError when keys object is missing", async () => {
    await expect(
      subscribePush(prisma, "alice@example.com", {
        endpoint: "https://push.example.com/abc",
        // @ts-expect-error — testing missing keys
        keys: undefined,
      }),
    ).rejects.toBeInstanceOf(InvalidSubscriptionError);
    expect(upsert).not.toHaveBeenCalled();
  });
});
