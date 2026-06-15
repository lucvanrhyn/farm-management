/**
 * @vitest-environment node
 *
 * lib/species/cattle/poor-doer.ts — the pure per-animal poor-doer detector,
 * extracted from cattleModule.getAlerts so BOTH the aggregate alert (count)
 * and Herd Triage (per-animal findings) read the SAME detection. The alert's
 * observable output must stay byte-identical: getAlerts now COUNTs the ids
 * this helper returns.
 */
import { describe, it, expect } from "vitest";
import { detectPoorDoers, type WeighingObs } from "@/lib/species/cattle/poor-doer";

const day = (d: string) => new Date(`${d}T00:00:00.000Z`);

function obs(animalId: string | null, date: string, weightKg: number | string | null): WeighingObs {
  return {
    animalId,
    observedAt: day(date),
    details:
      weightKg === null ? "{}" : JSON.stringify({ weight_kg: weightKg }),
  };
}

describe("detectPoorDoers", () => {
  it("flags an animal whose long-run ADG is below the threshold", () => {
    // 10 kg gain over 100 days = 0.1 kg/day < 0.7
    const ids = detectPoorDoers(
      [obs("A1", "2026-01-01", 400), obs("A1", "2026-04-11", 410)],
      0.7,
    );
    expect(ids).toEqual(["A1"]);
  });

  it("does NOT flag an animal at or above the threshold", () => {
    // 100 kg over 100 days = 1.0 kg/day >= 0.7
    const ids = detectPoorDoers(
      [obs("A1", "2026-01-01", 400), obs("A1", "2026-04-11", 500)],
      0.7,
    );
    expect(ids).toEqual([]);
  });

  it("ignores animals with fewer than 2 readings", () => {
    expect(detectPoorDoers([obs("A1", "2026-01-01", 400)], 0.7)).toEqual([]);
  });

  it("ignores readings with non-numeric / missing weight", () => {
    expect(
      detectPoorDoers([obs("A1", "2026-01-01", null), obs("A1", "2026-04-11", 410)], 0.7),
    ).toEqual([]);
  });

  it("ignores unparseable details JSON", () => {
    const bad: WeighingObs = { animalId: "A1", observedAt: day("2026-01-01"), details: "{not json" };
    expect(detectPoorDoers([bad, obs("A1", "2026-04-11", 410)], 0.7)).toEqual([]);
  });

  it("skips records with a null animalId", () => {
    expect(
      detectPoorDoers([obs(null, "2026-01-01", 400), obs(null, "2026-04-11", 410)], 0.7),
    ).toEqual([]);
  });

  it("skips when first and last reading are on the same day (no elapsed time)", () => {
    expect(
      detectPoorDoers([obs("A1", "2026-01-01", 400), obs("A1", "2026-01-01", 410)], 0.7),
    ).toEqual([]);
  });

  it("uses first vs last reading by chronological order (long-run ADG)", () => {
    // Out-of-order input; first=Jan(400) last=Apr(410) → 0.1 kg/day < 0.7
    const ids = detectPoorDoers(
      [obs("A1", "2026-04-11", 410), obs("A1", "2026-01-01", 400)],
      0.7,
    );
    expect(ids).toEqual(["A1"]);
  });
});
