/**
 * @vitest-environment node
 *
 * __tests__/api/camps-post-species.test.ts
 *
 * Wave 4 — issue #232: Camp creation forces explicit species pick.
 *
 * Background
 * ----------
 * `Camp.species` is a NOT-NULL column with a Prisma-level `@default("cattle")`
 * (see `prisma/schema.prisma` model Camp). Before this change, `POST /api/camps`
 * did not validate `species`, so any client that forgot the field silently
 * created a CATTLE camp — even when the user was working in sheep mode. This
 * mirrors the #28 root cause that motivated the species-required contract on
 * `POST /api/mobs` (Wave 4 A2, PR #57): when the schema default fills a gap
 * the user didn't explicitly resolve, the resulting row breaks the multi-
 * species hard-block downstream (e.g. you can't assign a sheep to a "sheep"
 * camp that's actually persisted as cattle).
 *
 * Contract enforced
 * -----------------
 *   - `species` is required on POST (cattle | sheep | game).
 *   - Missing `species` → 422 with envelope `{ error: "MISSING_SPECIES" }`.
 *     422 (not 400) because the field is structurally present in the schema
 *     but semantically required — matching the SARS/animal-domain pattern of
 *     typed business errors using 422.
 *   - Invalid `species` (not in the registry) → 400 VALIDATION_FAILED.
 *   - Happy path → 201 with `species` persisted on the new row.
 *
 * Spec: memory/multi-species-spec-2026-04-27.md ("Each species fully isolated")
 *       + #28 acceptance criterion "Camp creation UI forces species pick".
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { campFindFirstMock, campCreateMock, campCountMock, prismaMock } = vi.hoisted(() => {
  const findFirst = vi.fn();
  const create = vi.fn();
  const count = vi.fn();
  const prisma = {
    camp: { findFirst, create, count },
  };
  return {
    campFindFirstMock: findFirst,
    campCreateMock: create,
    campCountMock: count,
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
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return { ...actual, verifyFreshAdminRole: vi.fn().mockResolvedValue(true) };
});

vi.mock("@/lib/server/revalidate", () => ({
  revalidateCampWrite: vi.fn(),
}));

import { POST } from "@/app/api/camps/route";

function postReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/camps", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/camps — species contract (#232)", () => {
  beforeEach(() => {
    campFindFirstMock.mockReset();
    campCreateMock.mockReset();
    campCountMock.mockReset();
    // Default: no duplicate, palette index = 0.
    campFindFirstMock.mockResolvedValue(null);
    campCountMock.mockResolvedValue(0);
  });

  it("returns 422 MISSING_SPECIES when species is omitted (no silent cattle default)", async () => {
    const res = await POST(
      postReq({ campId: "K1", campName: "Kamp 1" }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("MISSING_SPECIES");
    expect(campCreateMock).not.toHaveBeenCalled();
  });

  it("returns 400 VALIDATION_FAILED when species is not in the registry", async () => {
    const res = await POST(
      postReq({ campId: "K1", campName: "Kamp 1", species: "ostrich" }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("VALIDATION_FAILED");
    expect(body.message).toMatch(/species/i);
    expect(campCreateMock).not.toHaveBeenCalled();
  });

  it("creates the camp with the supplied species and returns 201 (happy path)", async () => {
    campCreateMock.mockResolvedValue({
      id: "camp-1",
      campId: "K1",
      campName: "Kamp 1",
      sizeHectares: null,
      waterSource: null,
      geojson: null,
      color: "#2563EB",
      species: "sheep",
    });

    const res = await POST(
      postReq({ campId: "K1", campName: "Kamp 1", species: "sheep" }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(201);
    expect(campCreateMock).toHaveBeenCalledTimes(1);
    const callArg = campCreateMock.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(callArg.data.species).toBe("sheep");
    expect(callArg.data.campId).toBe("K1");
  });

  it("allows the same campId across species (composite UNIQUE — Phase A of #28)", async () => {
    // First call: cattle camp K12 exists for species=cattle but not species=sheep.
    // findFirst is scoped by (campId, species) in the new contract — the route
    // must pass `species` into the duplicate check, not just `campId`.
    campFindFirstMock.mockResolvedValueOnce(null); // sheep K12 — not found
    campCreateMock.mockResolvedValueOnce({
      id: "camp-sheep-12",
      campId: "K12",
      campName: "Sheep K12",
      sizeHectares: null,
      waterSource: null,
      geojson: null,
      color: "#2563EB",
      species: "sheep",
    });

    const res = await POST(
      postReq({ campId: "K12", campName: "Sheep K12", species: "sheep" }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(201);
    // Duplicate-check must be species-scoped so the composite UNIQUE survives.
    const findFirstCall = campFindFirstMock.mock.calls[0][0] as {
      where: { campId: string; species?: string };
    };
    expect(findFirstCall.where.campId).toBe("K12");
    expect(findFirstCall.where.species).toBe("sheep");
  });

  it("returns 409 when a duplicate campId exists for the SAME species", async () => {
    campFindFirstMock.mockResolvedValueOnce({
      id: "existing",
      campId: "K1",
      species: "cattle",
    });

    const res = await POST(
      postReq({ campId: "K1", campName: "Kamp 1", species: "cattle" }),
      { params: Promise.resolve({}) },
    );

    expect(res.status).toBe(409);
    expect(campCreateMock).not.toHaveBeenCalled();
  });
});
