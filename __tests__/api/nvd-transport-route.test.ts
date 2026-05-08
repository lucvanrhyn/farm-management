/**
 * __tests__/api/nvd-transport-route.test.ts
 *
 * Wave 4 A7 — TDD red-green-refactor for the NVD transport-forwarding bug.
 *
 * Bug (Codex adversarial review 2026-05-02, HIGH):
 *   POST /api/[farmSlug]/nvd was not extracting `body.transport`. The UI
 *   form (`components/nvd/NvdIssueForm.tsx`) sends
 *     transport: { driverName, vehicleRegNumber, vehicleMakeModel? }
 *   when either driver or vehicle reg is filled, but the route handler
 *   never read that field — so `issueNvd()` got called without `transport`,
 *   `NvdRecord.transportJson` ended up null, and the rendered PDF was
 *   missing the Stock Theft Act 57/1959 §8 transport rows. That is a
 *   regulatory non-compliance: a SAPS roadblock inspector cannot match the
 *   driver/vehicle to the NVD declaration.
 *
 * Class-of-bug: route-level forwarding regression — the field is defined
 * in `NvdIssueInput`, persisted by `issueNvd()`, and rendered by
 * `buildNvdPdf()`; only the HTTP boundary dropped it. See
 * `~/.claude/.../memory/feedback-regulatory-output-validate-against-spec.md`.
 *
 * These tests pin the round trip:
 *   1. UI shape → route extraction → `issueNvd` argument shape (assert
 *      the persisted call carries `transport` exactly).
 *   2. Field is OPTIONAL — POST without `transport` still returns 201 and
 *      `issueNvd` is called WITHOUT the property (route does not
 *      manufacture an empty object). Some movements are on-foot.
 *   3. When `transport` IS present, validate it: driverName must be a
 *      non-empty trimmed string and vehicleRegNumber must be a non-empty
 *      trimmed string. Garbage input → 400, no DB write.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mocks ────────────────────────────────────────────────────────────────

const mockGetServerSession = vi.fn();
vi.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

vi.mock("next-auth/providers/credentials", () => ({
  default: () => ({ id: "credentials" }),
}));

const mockPrisma = {
  // The issueNvd mock below intercepts before any prisma method is touched,
  // so this object only exists to satisfy the FarmContext shape.
} as const;

const mockGetPrismaForSlugWithAuth = vi.fn();
const mockGetPrismaWithAuth = vi.fn().mockResolvedValue({ error: "Forbidden", status: 403 });
const mockGetPrismaForFarm = vi.fn();
vi.mock("@/lib/farm-prisma", () => ({
  getPrismaForSlugWithAuth: (...args: unknown[]) => mockGetPrismaForSlugWithAuth(...args),
  // Per the alerts.test.ts pattern: tests don't set signed headers so the
  // fast path never fires; force the cookie lookup to error so the helper
  // falls through to the slug-validated legacy fallback.
  getPrismaWithAuth: (...args: unknown[]) => mockGetPrismaWithAuth(...args),
  getPrismaForFarm: (...args: unknown[]) => mockGetPrismaForFarm(...args),
  // PR #96/#119: slug-fallback path now wraps prisma in wrapPrismaWithRetry
  // to survive transient Turso disconnects. Test pass-through.
  wrapPrismaWithRetry: (_slug: string, client: unknown) => client,
}));

const mockVerifyFreshAdminRole = vi.fn();
vi.mock("@/lib/auth", () => ({
  verifyFreshAdminRole: (...args: unknown[]) => mockVerifyFreshAdminRole(...args),
}));

const mockIssueNvd = vi.fn();

// Wave G1 (#165) — mock the domain barrel that the route now imports from.
// `lib/server/nvd.ts` is a re-export shim, so we still mock both paths to
// keep any indirect importers covered. Critically, the route imports the
// real `InvalidTransportError` / `MissingRequiredFieldError` symbols from
// `@/lib/domain/nvd` for `instanceof` checks inside `mapApiDomainError`,
// so we re-export the actual modules and only spy `issueNvd`.
vi.mock("@/lib/domain/nvd", async () => {
  const actual = await vi.importActual<typeof import("@/lib/domain/nvd")>(
    "@/lib/domain/nvd",
  );
  return {
    ...actual,
    issueNvd: (...args: unknown[]) => mockIssueNvd(...args),
  };
});
vi.mock("@/lib/server/nvd", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/nvd")>(
    "@/lib/server/nvd",
  );
  return {
    ...actual,
    issueNvd: (...args: unknown[]) => mockIssueNvd(...args),
  };
});

const mockRevalidateObservationWrite = vi.fn();
vi.mock("@/lib/server/revalidate", () => ({
  revalidateObservationWrite: (...args: unknown[]) => mockRevalidateObservationWrite(...args),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true, retryAfterMs: 0 }),
}));

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));

// ── Helpers ──────────────────────────────────────────────────────────────

const FARM_SLUG = "delta-livestock";

const params = (): Promise<{ farmSlug: string }> =>
  Promise.resolve({ farmSlug: FARM_SLUG });

function req(body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/${FARM_SLUG}/nvd`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function sessionAdmin() {
  mockGetServerSession.mockResolvedValue({
    user: {
      id: "user-1",
      email: "admin@test.farm",
      farms: [{ slug: FARM_SLUG, role: "ADMIN" }],
    },
  });
  mockGetPrismaForSlugWithAuth.mockResolvedValue({
    prisma: mockPrisma,
    slug: FARM_SLUG,
    role: "ADMIN",
  });
  mockVerifyFreshAdminRole.mockResolvedValue(true);
}

function validBody(extra: Record<string, unknown> = {}) {
  return {
    saleDate: "2026-05-01",
    buyerName: "John Buyer",
    animalIds: ["ZA-001", "ZA-002"],
    declarationsJson: JSON.stringify({
      noEid: true,
      noWithdrawal: true,
      noDisease: true,
      noSymptoms: true,
      noPests: true,
      properlyIdentified: true,
      accurateInfo: true,
      notes: "",
    }),
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIssueNvd.mockResolvedValue({ id: "nvd-1", nvdNumber: "NVD-2026-0001" });
});

// ── Tests ────────────────────────────────────────────────────────────────

describe("POST /api/[farmSlug]/nvd — transport forwarding (Wave 4 A7)", () => {
  it("forwards body.transport into issueNvd when UI submits driver + vehicle reg", async () => {
    sessionAdmin();
    const { POST } = await import("@/app/api/[farmSlug]/nvd/route");

    const transport = {
      driverName: "Pieter Botha",
      vehicleRegNumber: "CA 123-456",
      vehicleMakeModel: "Toyota Hilux",
    };

    const res = await POST(req(validBody({ transport })), { params: params() });
    expect(res.status).toBe(201);

    expect(mockIssueNvd).toHaveBeenCalledOnce();
    const call = mockIssueNvd.mock.calls[0];
    // call[0] is prisma; call[1] is the input object
    expect(call[1]).toMatchObject({
      saleDate: "2026-05-01",
      buyerName: "John Buyer",
      animalIds: ["ZA-001", "ZA-002"],
      transport: {
        driverName: "Pieter Botha",
        vehicleRegNumber: "CA 123-456",
        vehicleMakeModel: "Toyota Hilux",
      },
    });
  });

  it("forwards transport with vehicleMakeModel omitted (optional within transport)", async () => {
    sessionAdmin();
    const { POST } = await import("@/app/api/[farmSlug]/nvd/route");

    const transport = {
      driverName: "Pieter Botha",
      vehicleRegNumber: "CA 123-456",
    };

    const res = await POST(req(validBody({ transport })), { params: params() });
    expect(res.status).toBe(201);
    expect(mockIssueNvd.mock.calls[0][1].transport).toEqual({
      driverName: "Pieter Botha",
      vehicleRegNumber: "CA 123-456",
    });
  });

  it("trims whitespace inside transport fields before persisting", async () => {
    sessionAdmin();
    const { POST } = await import("@/app/api/[farmSlug]/nvd/route");

    const transport = {
      driverName: "  Pieter Botha  ",
      vehicleRegNumber: "  CA 123-456  ",
      vehicleMakeModel: "  Toyota Hilux  ",
    };

    const res = await POST(req(validBody({ transport })), { params: params() });
    expect(res.status).toBe(201);
    expect(mockIssueNvd.mock.calls[0][1].transport).toEqual({
      driverName: "Pieter Botha",
      vehicleRegNumber: "CA 123-456",
      vehicleMakeModel: "Toyota Hilux",
    });
  });

  it("calls issueNvd WITHOUT transport when body.transport is absent (on-foot movement)", async () => {
    sessionAdmin();
    const { POST } = await import("@/app/api/[farmSlug]/nvd/route");

    const res = await POST(req(validBody()), { params: params() });
    expect(res.status).toBe(201);
    expect(mockIssueNvd).toHaveBeenCalledOnce();
    expect(mockIssueNvd.mock.calls[0][1].transport).toBeUndefined();
  });

  it("returns 400 when transport.driverName is not a string", async () => {
    sessionAdmin();
    const { POST } = await import("@/app/api/[farmSlug]/nvd/route");

    const res = await POST(
      req(validBody({ transport: { driverName: 123, vehicleRegNumber: "CA 1" } })),
      { params: params() },
    );
    expect(res.status).toBe(400);
    expect(mockIssueNvd).not.toHaveBeenCalled();
  });

  it("returns 400 when transport.driverName is empty/whitespace", async () => {
    sessionAdmin();
    const { POST } = await import("@/app/api/[farmSlug]/nvd/route");

    const res = await POST(
      req(validBody({ transport: { driverName: "   ", vehicleRegNumber: "CA 1" } })),
      { params: params() },
    );
    expect(res.status).toBe(400);
    expect(mockIssueNvd).not.toHaveBeenCalled();
  });

  it("returns 400 when transport.vehicleRegNumber is empty/whitespace", async () => {
    sessionAdmin();
    const { POST } = await import("@/app/api/[farmSlug]/nvd/route");

    const res = await POST(
      req(validBody({ transport: { driverName: "Pieter", vehicleRegNumber: "  " } })),
      { params: params() },
    );
    expect(res.status).toBe(400);
    expect(mockIssueNvd).not.toHaveBeenCalled();
  });

  it("returns 400 when transport is not an object (array passed)", async () => {
    sessionAdmin();
    const { POST } = await import("@/app/api/[farmSlug]/nvd/route");

    const res = await POST(
      req(validBody({ transport: ["driverName", "vehicleRegNumber"] })),
      { params: params() },
    );
    expect(res.status).toBe(400);
    expect(mockIssueNvd).not.toHaveBeenCalled();
  });

  it("returns 400 when transport.vehicleMakeModel is set to non-string (when present)", async () => {
    sessionAdmin();
    const { POST } = await import("@/app/api/[farmSlug]/nvd/route");

    const res = await POST(
      req(
        validBody({
          transport: {
            driverName: "Pieter",
            vehicleRegNumber: "CA 1",
            vehicleMakeModel: 999,
          },
        }),
      ),
      { params: params() },
    );
    expect(res.status).toBe(400);
    expect(mockIssueNvd).not.toHaveBeenCalled();
  });

  it("revalidates the observation cache after a successful issue with transport", async () => {
    sessionAdmin();
    const { POST } = await import("@/app/api/[farmSlug]/nvd/route");

    const res = await POST(
      req(
        validBody({
          transport: { driverName: "Pieter", vehicleRegNumber: "CA 1" },
        }),
      ),
      { params: params() },
    );
    expect(res.status).toBe(201);
    expect(mockRevalidateObservationWrite).toHaveBeenCalledWith(FARM_SLUG);
  });
});
