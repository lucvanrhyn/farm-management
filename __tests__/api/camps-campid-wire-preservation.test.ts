/**
 * @vitest-environment node
 *
 * __tests__/api/camps-campid-wire-preservation.test.ts
 *
 * Wave 309a (ADR-0001 Wave B, #309) — behaviour-preservation guard for the
 * `app/api/camps/[campId]` PATCH/DELETE extraction into `lib/domain/camps`.
 *
 * Pins the wire contract end-to-end through the REAL `adminWrite` adapter
 * (which owns the try/catch + `mapApiDomainError` envelope) so a future
 * refactor can't silently change status codes or response bodies:
 *
 *   - PATCH 200  → `{ success: true }`
 *   - DELETE 200 → `{ success: true }`
 *   - PATCH/DELETE 404 → `{ error: "CAMP_NOT_FOUND" }`  (canonical code;
 *       status 404 unchanged from the pre-extraction `{error:"Camp not
 *       found"}` — the code body change is the documented, dependency-free
 *       Wave-C-direction adoption)
 *   - DELETE 409 → `{ error: "Cannot delete camp with N active animal(s).
 *       Move or remove them first." }` — byte-identical legacy message,
 *       preserved on the wire (legacy clients display it).
 *
 * Also locks the #28 Phase A semantics: resolve by `campId` via
 * `findFirst`, mutate/delete by the resolved CUID `id`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { campFindFirst, campUpdate, campDelete, animalCount, prismaMock } =
  vi.hoisted(() => {
    const findFirst = vi.fn();
    const update = vi.fn();
    const del = vi.fn();
    const count = vi.fn();
    const prisma = {
      camp: { findFirst, update, delete: del },
      animal: { count },
    };
    return {
      campFindFirst: findFirst,
      campUpdate: update,
      campDelete: del,
      animalCount: count,
      prismaMock: prisma,
    };
  });

vi.mock("@/lib/server/farm-context", () => ({
  getFarmContext: vi.fn().mockResolvedValue({
    prisma: prismaMock,
    role: "ADMIN",
    slug: "test-farm",
    session: { user: { id: "user-1", email: "test@farm.co.za" } },
  }),
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>(
    "@/lib/auth",
  );
  return { ...actual, verifyFreshAdminRole: vi.fn().mockResolvedValue(true) };
});

vi.mock("@/lib/server/revalidate", () => ({
  revalidateCampWrite: vi.fn(),
}));

import { PATCH, DELETE } from "@/app/api/camps/[campId]/route";

function patchReq(body: unknown) {
  return new NextRequest("http://localhost/api/camps/NORTH-01", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function deleteReq() {
  return new NextRequest("http://localhost/api/camps/NORTH-01", {
    method: "DELETE",
  });
}

beforeEach(() => {
  campFindFirst.mockReset();
  campUpdate.mockReset();
  campDelete.mockReset();
  animalCount.mockReset();
});

describe("PATCH /api/camps/[campId] — wire preservation", () => {
  it("200 → { success: true } and mutates by resolved CUID id (#28 Phase A)", async () => {
    campFindFirst.mockResolvedValue({ id: "cuid-1", campId: "NORTH-01" });
    campUpdate.mockResolvedValue({ id: "cuid-1" });

    const res = await PATCH(patchReq({ campName: "Renamed" }), {
      params: Promise.resolve({ campId: "NORTH-01" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(campFindFirst).toHaveBeenCalledWith({
      where: { campId: "NORTH-01" },
    });
    expect(campUpdate).toHaveBeenCalledWith({
      where: { id: "cuid-1" },
      data: { campName: "Renamed" },
    });
  });

  it("404 → { error: 'CAMP_NOT_FOUND' } when camp missing", async () => {
    campFindFirst.mockResolvedValue(null);

    const res = await PATCH(patchReq({ campName: "x" }), {
      params: Promise.resolve({ campId: "NORTH-01" }),
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "CAMP_NOT_FOUND" });
    expect(campUpdate).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/camps/[campId] — wire preservation", () => {
  it("200 → { success: true } and deletes by resolved CUID id (#28 Phase A)", async () => {
    campFindFirst.mockResolvedValue({ id: "cuid-1", campId: "NORTH-01" });
    animalCount.mockResolvedValue(0);
    campDelete.mockResolvedValue({ id: "cuid-1" });

    const res = await DELETE(deleteReq(), {
      params: Promise.resolve({ campId: "NORTH-01" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(campDelete).toHaveBeenCalledWith({ where: { id: "cuid-1" } });
  });

  it("404 → { error: 'CAMP_NOT_FOUND' } when camp missing", async () => {
    campFindFirst.mockResolvedValue(null);

    const res = await DELETE(deleteReq(), {
      params: Promise.resolve({ campId: "NORTH-01" }),
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "CAMP_NOT_FOUND" });
    expect(campDelete).not.toHaveBeenCalled();
  });

  it("409 → byte-identical legacy active-animal message", async () => {
    campFindFirst.mockResolvedValue({ id: "cuid-1", campId: "NORTH-01" });
    animalCount.mockResolvedValue(3);

    const res = await DELETE(deleteReq(), {
      params: Promise.resolve({ campId: "NORTH-01" }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error:
        "Cannot delete camp with 3 active animal(s). Move or remove them first.",
    });
    expect(campDelete).not.toHaveBeenCalled();
  });
});
