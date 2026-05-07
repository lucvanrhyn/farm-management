/**
 * @vitest-environment node
 *
 * Wave 4 — `mapApiDomainError` shared mapper for API route handlers.
 *
 * Background: PR #60 introduced an inline cross-species 422 in the animals
 * PATCH route; PR #62 was queued to add the symmetric block in the mobs
 * PATCH route. Both routes were going to carry the same `instanceof`/422
 * lump. Wave 4 extracts that into one shared helper so the next domain
 * error (PARENT_NOT_FOUND, MobInUseError, …) plugs in once instead of
 * being duplicated across N routes.
 *
 * Contract: `mapApiDomainError(err): NextResponse | null`
 *   - Returns a typed `NextResponse` if `err` is one of the known domain
 *     errors (`MobNotFoundError`, `CrossSpeciesBlockedError`).
 *   - Returns `null` otherwise so the caller can `throw err` and let
 *     Next.js' default 500 handler kick in.
 *   - The helper inspects the error itself; it never reads route-level
 *     state, which is what makes it safe to share.
 */

import { describe, it, expect } from "vitest";
import {
  CrossSpeciesBlockedError,
  MobNotFoundError,
} from "@/lib/domain/mobs/move-mob";
import { mapApiDomainError } from "@/lib/server/api-errors";

async function readBody(res: Response): Promise<unknown> {
  return JSON.parse(await res.text());
}

describe("mapApiDomainError", () => {
  it("maps MobNotFoundError → 404 with { error: 'Mob not found' }", async () => {
    const res = mapApiDomainError(new MobNotFoundError("mob-123"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(404);
    expect(await readBody(res!)).toEqual({ error: "Mob not found" });
  });

  it("maps CrossSpeciesBlockedError → 422 with { error: 'CROSS_SPECIES_BLOCKED' }", async () => {
    const res = mapApiDomainError(new CrossSpeciesBlockedError("cattle", "sheep"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(422);
    expect(await readBody(res!)).toEqual({ error: "CROSS_SPECIES_BLOCKED" });
  });

  it("returns null for a generic Error so the caller can rethrow", () => {
    expect(mapApiDomainError(new Error("boom"))).toBeNull();
  });

  it("returns null for a non-Error throwable (string, null, undefined, plain object)", () => {
    expect(mapApiDomainError("not an error")).toBeNull();
    expect(mapApiDomainError(null)).toBeNull();
    expect(mapApiDomainError(undefined)).toBeNull();
    expect(mapApiDomainError({ code: "CROSS_SPECIES_BLOCKED" })).toBeNull();
  });

  it("uses the error's `code` field for CrossSpeciesBlockedError, not the string literal", async () => {
    // Guards against drift between the class's `code` constant and the
    // mapper's response body. If someone renames CROSS_SPECIES_BLOCKED in
    // mob-move.ts, this test should fail.
    const err = new CrossSpeciesBlockedError("game", "cattle");
    const res = mapApiDomainError(err);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(422);
    const body = (await readBody(res!)) as { error: string };
    expect(body.error).toBe(err.code);
  });
});
