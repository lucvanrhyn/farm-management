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
import { CrossSpeciesBlockedError } from "@/lib/species/errors";
import { MobNotFoundError } from "@/lib/domain/mobs/move-mob";
import { CampConditionFieldRequiredError } from "@/lib/domain/observations/create-observation";
import { AnimalNotFoundError as ObservationAnimalNotFoundError } from "@/lib/domain/observations/errors";
import { AnimalNotFoundError as AnimalsDomainNotFoundError } from "@/lib/domain/animals/errors";
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

  // ── S5 / OBS-2 — observations-domain AnimalNotFoundError → typed 404 ──────

  it("maps the observations-domain AnimalNotFoundError → 404 { error: 'ANIMAL_NOT_FOUND' } (S5/OBS-2)", async () => {
    // Thrown by the observation door's species-stamping waterfall AND (post-S5)
    // by performAnimalDeath/performAnimalMove when the tag-keyed update hits
    // P2025. The offline replay made missing-animal a REACHABLE wire case
    // (animal deleted server-side while a death/move sat in the queue), so it
    // needs a typed terminal 404 the sync classifier can dead-letter — not the
    // pre-S5 unmapped fall-through to an opaque 500 the queue retried forever.
    const res = mapApiDomainError(new ObservationAnimalNotFoundError("BB-C014"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(404);
    expect(await readBody(res!)).toEqual({ error: "ANIMAL_NOT_FOUND" });
  });

  it("keeps the animals-domain AnimalNotFoundError on the legacy 404 { error: 'Not found' } wire (no contract drift)", async () => {
    // The animals CRUD `[id]` routes pin their PRE-extraction free-text body
    // byte-identical (Wave 309b). The S5 typed code applies ONLY to the
    // observations-domain class — the two same-named classes stay on their
    // separate wire contracts.
    const res = mapApiDomainError(new AnimalsDomainNotFoundError("BB-C014"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(404);
    expect(await readBody(res!)).toEqual({ error: "Not found" });
  });

  it("returns null for a non-Error throwable (string, null, undefined, plain object)", () => {
    expect(mapApiDomainError("not an error")).toBeNull();
    expect(mapApiDomainError(null)).toBeNull();
    expect(mapApiDomainError(undefined)).toBeNull();
    expect(mapApiDomainError({ code: "CROSS_SPECIES_BLOCKED" })).toBeNull();
  });

  it("maps CampConditionFieldRequiredError → 422 with { error: code, details: { field } } (#321)", async () => {
    // Without this arm an incomplete camp_condition submit from a stale
    // offline client falls through to Next.js' default 500 — the data hole
    // is closed by createObservation throwing, but the wire shape must be a
    // typed 422 so clients can surface "select grazing/water/fence".
    const res = mapApiDomainError(new CampConditionFieldRequiredError("grazing"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(422);
    expect(await readBody(res!)).toEqual({
      error: "CAMP_CONDITION_FIELD_REQUIRED",
      details: { field: "grazing" },
    });
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
