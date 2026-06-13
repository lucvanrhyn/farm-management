/**
 * @vitest-environment node
 *
 * Write-path coverage for the POST /api/animals typed-error route boundary.
 *
 * Closes a residual-closeout gap: the only route-level animals test asserts
 * the happy-path 201 (__tests__/cache-invalidation/shared-routes.test.ts), and
 * the idempotency tests call the createAnimal DOOR directly — both bypass the
 * route's try/catch that maps CreateAnimalValidationError → 400
 * VALIDATION_FAILED and AnimalRoleForbiddenError → 403 FORBIDDEN. A live replay
 * submitting a bad field or as a non-creator role hits exactly that un-tested
 * mapping. This drives the REAL createAnimal so the instanceof→envelope mapping
 * is genuine, not stubbed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const hoisted = vi.hoisted(() => ({
  getFarmContext: vi.fn(),
  animal: { create: vi.fn(), upsert: vi.fn() },
}));

vi.mock("@/lib/server/farm-context", () => ({
  getFarmContext: hoisted.getFarmContext,
}));
vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

import { POST } from "@/app/api/animals/route";

const prisma = { animal: hoisted.animal };

function ctx(role = "ADMIN") {
  return {
    session: { user: { id: "u1", email: "u@x", farms: [{ slug: "farm-a", role }] } },
    prisma,
    slug: "farm-a",
    role,
  };
}
function req(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/animals", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}
const routeCtx = { params: Promise.resolve({}) };
const validBody = {
  animalId: "A1",
  sex: "Female",
  category: "Cow",
  currentCamp: "C1",
  species: "cattle",
};

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.getFarmContext.mockResolvedValue(ctx("ADMIN"));
});

describe("POST /api/animals — typed error boundary", () => {
  it("unauthenticated → 401 AUTH_REQUIRED", async () => {
    hoisted.getFarmContext.mockResolvedValue(null);
    const res = await POST(req(validBody), routeCtx);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("AUTH_REQUIRED");
    expect(hoisted.animal.create).not.toHaveBeenCalled();
    expect(hoisted.animal.upsert).not.toHaveBeenCalled();
  });

  it("missing required fields → 400 VALIDATION_FAILED (no write)", async () => {
    const res = await POST(
      req({ sex: "Female", category: "Cow", currentCamp: "C1" }),
      routeCtx,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("VALIDATION_FAILED");
    expect(body.message).toBeTruthy();
    expect(body.details?.field).toBe("required");
    expect(hoisted.animal.create).not.toHaveBeenCalled();
    expect(hoisted.animal.upsert).not.toHaveBeenCalled();
  });

  it("invalid sex → 400 VALIDATION_FAILED with details.field='sex'", async () => {
    const res = await POST(
      req({ animalId: "A1", sex: "Unknown", category: "Cow", currentCamp: "C1" }),
      routeCtx,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("VALIDATION_FAILED");
    expect(body.details?.field).toBe("sex");
    expect(hoisted.animal.create).not.toHaveBeenCalled();
  });

  it("non-creator role (VIEWER) → 403 FORBIDDEN (no write)", async () => {
    hoisted.getFarmContext.mockResolvedValue(ctx("VIEWER"));
    const res = await POST(req(validBody), routeCtx);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("FORBIDDEN");
    expect(hoisted.animal.create).not.toHaveBeenCalled();
    expect(hoisted.animal.upsert).not.toHaveBeenCalled();
  });

  it("valid body with clientLocalId → 201 via upsert, idempotent on retry", async () => {
    hoisted.animal.upsert.mockResolvedValue({ animalId: "A1", id: "row-1" });
    const body = { ...validBody, clientLocalId: "uuid-1" };

    const r1 = await POST(req(body), routeCtx);
    const r2 = await POST(req(body), routeCtx);

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(hoisted.animal.upsert).toHaveBeenCalledTimes(2);
    expect(hoisted.animal.create).not.toHaveBeenCalled();
    expect((await r1.json()).animal).toMatchObject({ animalId: "A1" });
  });
});
