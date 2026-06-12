/**
 * @vitest-environment node
 *
 * __tests__/api/it3-route-prisma-sanitize.test.ts — api-M1 class (S27).
 *
 * POST /api/[farmSlug]/tax/it3 wraps `issueIt3Snapshot` in a route-local
 * catch that (pre-fix) echoed `err.message` verbatim into the 422 body —
 * including raw Prisma messages carrying internal schema text. The catch
 * sits INSIDE the `tenantWriteSlug` adapter, so the adapter's own
 * `mapApiDomainError` sanitization (#483) never saw the throw.
 *
 * Contract after the fix:
 *   - Prisma exception classes (detected by name via `mapApiDomainError`)
 *     collapse to the opaque 500 `{ error: "DB_QUERY_FAILED" }` envelope;
 *     the full error is logged server-side by the mapper.
 *   - The deliberate business-rule throw from `issueIt3Snapshot` (duplicate
 *     active snapshot — its developer-authored message IS the user-facing
 *     toast copy) keeps the verbatim 422 `{ error: "<sentence>" }` shape,
 *     byte-identical to the Wave G8 wire contract.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { issueIt3SnapshotMock, prismaMock } = vi.hoisted(() => ({
  issueIt3SnapshotMock: vi.fn(),
  prismaMock: {
    it3Snapshot: { findMany: vi.fn(), count: vi.fn() },
  },
}));

vi.mock("@/lib/server/farm-context-slug", () => ({
  getFarmContextForSlug: vi.fn(async () => ({
    prisma: prismaMock,
    role: "ADMIN",
    slug: "test-farm",
    session: { user: { id: "user-1", email: "admin@farm.co.za" } },
  })),
}));

vi.mock("@/lib/auth", () => ({
  verifyFreshAdminRole: vi.fn(async () => true),
}));

vi.mock("@/lib/meta-db", () => ({
  getFarmCreds: vi.fn(async () => ({
    tursoUrl: "libsql://x",
    tursoAuthToken: "tkn",
    tier: "advanced",
  })),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true })),
}));

vi.mock("@/lib/server/sars-it3", () => ({
  issueIt3Snapshot: (...args: unknown[]) => issueIt3SnapshotMock(...args),
}));

vi.mock("@/lib/server/revalidate", () => ({
  revalidateObservationWrite: vi.fn(),
}));

// Import AFTER every vi.mock so the handler picks up the doubles.
const { POST } = await import("@/app/api/[farmSlug]/tax/it3/route");
const { logger } = await import("@/lib/logger");

const CTX = { params: Promise.resolve({ farmSlug: "test-farm" }) };

function postReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/test-farm/tax/it3", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

/** Error shaped like a real Prisma exception: name + leaky schema message. */
function makePrismaError(name: string, message: string): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

beforeEach(() => {
  issueIt3SnapshotMock.mockReset();
});

describe("POST /api/[farmSlug]/tax/it3 — Prisma/DB error sanitization (api-M1)", () => {
  it("returns 201 with the snapshot record on success (harness sanity)", async () => {
    issueIt3SnapshotMock.mockResolvedValue({ id: "snap-1", taxYear: 2026 });
    const resp = await POST(postReq({ taxYear: 2026 }), CTX);
    expect(resp.status).toBe(201);
    expect(await resp.json()).toEqual({ id: "snap-1", taxYear: 2026 });
  });

  it("collapses a raw Prisma throw to the opaque DB_QUERY_FAILED envelope (no schema leak)", async () => {
    const spy = vi.spyOn(logger, "error").mockImplementation(() => {});
    try {
      const leak =
        "Invalid `prisma.it3Snapshot.create()` invocation: column `secret_col` does not exist on table `It3Snapshot`";
      issueIt3SnapshotMock.mockRejectedValue(
        makePrismaError("PrismaClientValidationError", leak),
      );
      const resp = await POST(postReq({ taxYear: 2026 }), CTX);
      expect(resp.status).toBe(500);
      const text = await resp.text();
      expect(JSON.parse(text)).toEqual({ error: "DB_QUERY_FAILED" });
      expect(text).not.toContain("secret_col");
      expect(text).not.toContain("It3Snapshot");
      expect(text).not.toContain("prisma.");
      // The full error is preserved server-side (mapApiDomainError logs it).
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("keeps the deliberate duplicate-snapshot business error verbatim on the 422 arm", async () => {
    const sentence =
      "An active IT3 snapshot already exists for tax year 2026. Void it before re-issuing.";
    issueIt3SnapshotMock.mockRejectedValue(new Error(sentence));
    const resp = await POST(postReq({ taxYear: 2026 }), CTX);
    expect(resp.status).toBe(422);
    expect(await resp.json()).toEqual({ error: sentence });
  });
});
