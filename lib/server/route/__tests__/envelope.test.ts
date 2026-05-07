/**
 * @vitest-environment node
 *
 * Wave A — envelope.ts tests.
 *
 * `routeError(code, message?, status?, details?)` is the SINGLE place that
 * mints typed-error envelope responses. Adapters are forbidden from calling
 * `NextResponse.json({error: ...}, ...)` directly so the envelope shape
 * cannot drift.
 */
import { describe, it, expect } from "vitest";
import { routeError } from "@/lib/server/route/envelope";

describe("routeError — typed-error envelope", () => {
  it("returns a NextResponse with the canonical { error, message } body", async () => {
    const res = routeError("AUTH_REQUIRED", "Unauthorized", 401);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "AUTH_REQUIRED", message: "Unauthorized" });
  });

  it("maps AUTH_REQUIRED to 401 by default", async () => {
    const res = routeError("AUTH_REQUIRED", "Unauthorized");
    expect(res.status).toBe(401);
  });

  it("maps FORBIDDEN to 403 by default", async () => {
    const res = routeError("FORBIDDEN", "Forbidden");
    expect(res.status).toBe(403);
  });

  it("maps VALIDATION_FAILED to 400 by default", async () => {
    const res = routeError("VALIDATION_FAILED", "Invalid body");
    expect(res.status).toBe(400);
  });

  it("maps INVALID_BODY to 400 by default", async () => {
    const res = routeError("INVALID_BODY", "Body must be JSON");
    expect(res.status).toBe(400);
  });

  it("maps DB_QUERY_FAILED to 500 by default", async () => {
    const res = routeError("DB_QUERY_FAILED", "boom");
    expect(res.status).toBe(500);
  });

  it("falls back to 500 for unknown codes when no status is given", async () => {
    const res = routeError("UNCLASSIFIED");
    expect(res.status).toBe(500);
  });

  it("honours an explicit status override regardless of the code mapping", async () => {
    const res = routeError("AUTH_REQUIRED", "Unauthorized", 418);
    expect(res.status).toBe(418);
  });

  it("includes details on the body when provided", async () => {
    const res = routeError("VALIDATION_FAILED", "Invalid body", 400, {
      fieldErrors: { campId: "required" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      error: "VALIDATION_FAILED",
      message: "Invalid body",
      details: { fieldErrors: { campId: "required" } },
    });
  });

  it("omits message when caller supplies undefined", async () => {
    const res = routeError("UNCLASSIFIED", undefined, 500);
    const body = await res.json();
    expect(body).toEqual({ error: "UNCLASSIFIED" });
  });

  it("omits details when caller supplies undefined", async () => {
    const res = routeError("AUTH_REQUIRED", "Unauthorized");
    const body = await res.json();
    expect(body).not.toHaveProperty("details");
  });

  it("preserves the JSON content-type header", () => {
    const res = routeError("AUTH_REQUIRED", "Unauthorized");
    expect(res.headers.get("content-type") ?? "").toMatch(/application\/json/);
  });
});
