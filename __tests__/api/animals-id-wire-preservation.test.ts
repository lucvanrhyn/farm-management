/**
 * @vitest-environment node
 *
 * __tests__/api/animals-id-wire-preservation.test.ts
 *
 * Wave 309b (ADR-0001 Wave B, #309) — behaviour-preservation guard for
 * the `app/api/animals/[id]` GET/PATCH extraction into
 * `lib/domain/animals`.
 *
 * This route carries authorization (LOGGER vs ADMIN field allowlist) +
 * validation, so the extraction is strictly behaviour-preserving. This
 * test pins the wire contract end-to-end through the REAL `tenantRead` /
 * `tenantWrite` adapters (which own the try/catch + `mapApiDomainError`
 * envelope) so a future refactor can't silently change a status code or
 * response body — ESPECIALLY the authz 403 path:
 *
 *   - GET 200   → the animal row
 *   - GET 404   → `{ error: "Not found" }`
 *   - PATCH 200 → the updated animal row
 *   - PATCH 403 → `{ error: "FORBIDDEN", message: "Forbidden" }`
 *                 (LOGGER disallowed key AND non-ADMIN non-LOGGER)
 *   - PATCH 400 → `{ error: "status must be one of: Active, Deceased,
 *                   Sold, Culled" }`
 *   - PATCH 400 → `{ error: "sex must be one of: Male, Female, Unknown" }`
 *   - PATCH 422 → `{ error: "PARENT_NOT_FOUND" }`
 *   - PATCH 422 → `{ error: "CROSS_SPECIES_BLOCKED" }`
 *   - PATCH 422 → `{ error: "NOT_FOUND" }` / `{ error: "WRONG_SPECIES" }`
 *
 * Every body below is asserted byte-identical to the pre-extraction
 * handler.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  animalFindUnique,
  animalUpdate,
  prismaMock,
  requireSpeciesScopedCampMock,
} = vi.hoisted(() => {
  const findUnique = vi.fn();
  const update = vi.fn();
  return {
    animalFindUnique: findUnique,
    animalUpdate: update,
    prismaMock: { animal: { findUnique, update } },
    requireSpeciesScopedCampMock: vi.fn(),
  };
});

let mockRole = "ADMIN";

vi.mock("@/lib/server/farm-context", () => ({
  getFarmContext: vi.fn().mockImplementation(async () => ({
    prisma: prismaMock,
    role: mockRole,
    slug: "test-farm",
    session: { user: { id: "user-1", email: "test@farm.co.za" } },
  })),
}));

vi.mock("@/lib/server/revalidate", () => ({
  revalidateAnimalWrite: vi.fn(),
}));

vi.mock("@/lib/server/species/require-species-scoped-camp", () => ({
  requireSpeciesScopedCamp: requireSpeciesScopedCampMock,
}));

import { GET, PATCH } from "@/app/api/animals/[id]/route";

function getReq() {
  return new NextRequest("http://localhost/api/animals/A-1", {
    method: "GET",
  });
}

function patchReq(body: unknown) {
  return new NextRequest("http://localhost/api/animals/A-1", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const params = { params: Promise.resolve({ id: "A-1" }) };

beforeEach(() => {
  animalFindUnique.mockReset();
  animalUpdate.mockReset();
  requireSpeciesScopedCampMock.mockReset();
  mockRole = "ADMIN";
});

describe("GET /api/animals/[id] — wire preservation", () => {
  it("200 → the animal row", async () => {
    const row = { animalId: "A-1", species: "cattle", status: "Active" };
    animalFindUnique.mockResolvedValue(row);

    const res = await GET(getReq(), params);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(row);
    expect(animalFindUnique).toHaveBeenCalledWith({
      where: { animalId: "A-1" },
    });
  });

  it("404 → byte-identical `{ error: \"Not found\" }`", async () => {
    animalFindUnique.mockResolvedValue(null);

    const res = await GET(getReq(), params);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });
});

describe("PATCH /api/animals/[id] — authz wire preservation", () => {
  it("403 → byte-identical FORBIDDEN envelope when LOGGER touches a disallowed key", async () => {
    mockRole = "LOGGER";

    const res = await PATCH(patchReq({ name: "Hax" }), params);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "FORBIDDEN",
      message: "Forbidden",
    });
    expect(animalUpdate).not.toHaveBeenCalled();
  });

  it("403 → byte-identical FORBIDDEN envelope for a non-ADMIN non-LOGGER role", async () => {
    mockRole = "VIEWER";

    const res = await PATCH(patchReq({ status: "Active" }), params);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "FORBIDDEN",
      message: "Forbidden",
    });
    expect(animalUpdate).not.toHaveBeenCalled();
  });

  it("200 → LOGGER may update an allowed key", async () => {
    mockRole = "LOGGER";
    animalUpdate.mockResolvedValue({ animalId: "A-1", status: "Sold" });

    const res = await PATCH(patchReq({ status: "Sold" }), params);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ animalId: "A-1", status: "Sold" });
  });
});

describe("PATCH /api/animals/[id] — validation wire preservation", () => {
  it("400 → byte-identical status enum message", async () => {
    const res = await PATCH(patchReq({ status: "Zombie" }), params);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "status must be one of: Active, Deceased, Sold, Culled",
    });
    expect(animalUpdate).not.toHaveBeenCalled();
  });

  it("400 → byte-identical sex enum message", async () => {
    const res = await PATCH(patchReq({ sex: "Helicopter" }), params);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "sex must be one of: Male, Female, Unknown",
    });
    expect(animalUpdate).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/animals/[id] — guard wire preservation", () => {
  it("422 → byte-identical PARENT_NOT_FOUND", async () => {
    animalFindUnique.mockImplementation(
      async ({ where }: { where: { animalId: string } }) => {
        if (where.animalId === "A-1") return { species: "cattle" };
        return null;
      },
    );

    const res = await PATCH(patchReq({ motherId: "MISSING" }), params);

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "PARENT_NOT_FOUND" });
    expect(animalUpdate).not.toHaveBeenCalled();
  });

  it("422 → byte-identical CROSS_SPECIES_BLOCKED on parent species mismatch", async () => {
    animalFindUnique.mockImplementation(
      async ({ where }: { where: { animalId: string } }) => {
        if (where.animalId === "A-1") return { species: "cattle" };
        if (where.animalId === "S-100") return { species: "sheep" };
        return null;
      },
    );

    const res = await PATCH(patchReq({ motherId: "S-100" }), params);

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "CROSS_SPECIES_BLOCKED" });
    expect(animalUpdate).not.toHaveBeenCalled();
  });

  it("422 → byte-identical NOT_FOUND from the #98 camp guard", async () => {
    animalFindUnique.mockResolvedValue({ species: "cattle" });
    requireSpeciesScopedCampMock.mockResolvedValue({
      ok: false,
      reason: "NOT_FOUND",
    });

    const res = await PATCH(patchReq({ currentCamp: "Ghost" }), params);

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "NOT_FOUND" });
    expect(animalUpdate).not.toHaveBeenCalled();
  });

  it("422 → byte-identical WRONG_SPECIES from the #98 camp guard", async () => {
    animalFindUnique.mockResolvedValue({ species: "cattle" });
    requireSpeciesScopedCampMock.mockResolvedValue({
      ok: false,
      reason: "WRONG_SPECIES",
    });

    const res = await PATCH(patchReq({ currentCamp: "Sheep-Paddock" }), params);

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "WRONG_SPECIES" });
    expect(animalUpdate).not.toHaveBeenCalled();
  });

  it("200 → happy PATCH returns the updated row (no guard branch)", async () => {
    animalUpdate.mockResolvedValue({ animalId: "A-1", name: "Renamed" });

    const res = await PATCH(patchReq({ name: "Renamed" }), params);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ animalId: "A-1", name: "Renamed" });
    expect(animalFindUnique).not.toHaveBeenCalled();
  });
});
