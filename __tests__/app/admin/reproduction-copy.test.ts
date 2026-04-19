import { describe, it, expect } from "vitest";
import {
  COPY_BY_MODE,
  type SpeciesMode,
} from "@/app/[farmSlug]/admin/reproduction/copy";

// Guards the species-aware copy registry that drives the reproduction
// dashboard. Each entry MUST supply every label the page consumes so we
// never accidentally render "undefined" or leak cattle copy onto a sheep
// dashboard (Anika's complaint 2026-04-19).

const MODES: SpeciesMode[] = ["cattle", "sheep", "game"];

describe("reproduction COPY_BY_MODE", () => {
  it("defines an entry for every supported species", () => {
    for (const mode of MODES) {
      expect(COPY_BY_MODE[mode]).toBeDefined();
    }
  });

  it("has non-empty required strings for every mode", () => {
    for (const mode of MODES) {
      const c = COPY_BY_MODE[mode];
      expect(c.pageTitle).toBeTruthy();
      expect(c.birthEvent).toBeTruthy();
      expect(c.birthEventLower).toBeTruthy();
      expect(c.offspring).toBeTruthy();
      expect(c.offspringPlural).toBeTruthy();
      expect(c.dam).toBeTruthy();
      expect(c.intervalLabel).toBeTruthy();
      expect(c.weanedLabel).toBeTruthy();
      expect(c.logHint).toBeTruthy();
      expect(c.benchmarkLine).toBeTruthy();
      expect(c.gestationDays).toBeGreaterThan(0);
    }
  });

  it("maps cattle to calving copy", () => {
    const c = COPY_BY_MODE.cattle;
    expect(c.birthEvent).toBe("Calving");
    expect(c.offspring).toBe("calf");
    expect(c.dam).toBe("cow");
    expect(c.gestationDays).toBe(285);
    expect(c.intervalLabel).toMatch(/calving/i);
  });

  it("maps sheep to lambing copy (Anika's fix)", () => {
    const c = COPY_BY_MODE.sheep;
    expect(c.birthEvent).toBe("Lambing");
    expect(c.birthEventLower).toBe("lambing");
    expect(c.offspring).toBe("lamb");
    expect(c.offspringPlural).toBe("lambs");
    expect(c.dam).toBe("ewe");
    expect(c.intervalLabel).toMatch(/lambing/i);
    expect(c.weanedLabel).toMatch(/lamb/i);
    // Critical: sheep dashboard must NOT show cattle wording.
    expect(c.benchmarkLine).not.toMatch(/calving/i);
    expect(c.logHint).not.toMatch(/calving/i);
  });

  it("maps game to fawning copy", () => {
    const c = COPY_BY_MODE.game;
    expect(c.birthEvent).toBe("Fawning");
    expect(c.offspring).toBe("fawn");
    expect(c.dam).toBe("doe");
    expect(c.intervalLabel).toBe("Drop Rate");
    expect(c.weanedLabel).toMatch(/fawn/i);
    expect(c.benchmarkLine).not.toMatch(/calving/i);
  });

  it("lowercase birth-event is a lowercase form of the title version", () => {
    for (const mode of MODES) {
      const c = COPY_BY_MODE[mode];
      expect(c.birthEventLower).toBe(c.birthEvent.toLowerCase());
    }
  });
});
