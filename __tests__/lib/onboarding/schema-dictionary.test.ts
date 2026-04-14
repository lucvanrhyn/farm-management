import { describe, it, expect } from "vitest";
import {
  SYSTEM_PROMPT,
  SYSTEM_PROMPT_APPROX_TOKEN_COUNT,
  SYSTEM_PROMPT_VERSION,
  AFRIKAANS_MONTH_MAP,
  AFRIKAANS_CATTLE_CATEGORY_MAP,
  AFRIKAANS_SHEEP_CATEGORY_MAP,
  AFRIKAANS_SEX_MAP,
  CANONICAL_LSU_WEIGHTS,
} from "@/lib/onboarding/schema-dictionary";

// The schema dictionary is the cached system prompt for the Sonnet 4.6 AI
// Import Wizard. These tests assert that every rule lifted from the Acme
// onboarding script survives into the prompt, so that accidentally deleting
// one fails CI instead of silently corrupting imports.

describe("SYSTEM_PROMPT — language dictionary", () => {
  it("defines Afrikaans sex normalization", () => {
    expect(SYSTEM_PROMPT).toContain("Manlik");
    expect(SYSTEM_PROMPT).toContain("Vroulik");
    expect(SYSTEM_PROMPT).toMatch(/Manlik[^\n]*Male/);
    expect(SYSTEM_PROMPT).toMatch(/Vroulik[^\n]*Female/);
  });

  it("defines Afrikaans cattle category normalization", () => {
    for (const word of ["Koei", "Bul", "Vers", "Kalf", "Os"]) {
      expect(SYSTEM_PROMPT).toContain(word);
    }
  });

  it("defines Afrikaans sheep category normalization", () => {
    for (const word of ["Ooi", "Lam", "Hamel"]) {
      expect(SYSTEM_PROMPT).toContain(word);
    }
  });

  it("includes Afrikaans status words", () => {
    expect(SYSTEM_PROMPT).toContain("Verkoop");
    expect(SYSTEM_PROMPT).toContain("Gevrek");
  });

  it("maps common Afrikaans column headers to schema fields", () => {
    const headers = [
      "Oormerk",
      "Registrasienommer",
      "Ras",
      "Geslag",
      "Kategorie",
      "Geboortedatum",
      "Moeder",
      "Vader",
      "Kamp",
    ];
    for (const h of headers) {
      expect(SYSTEM_PROMPT).toContain(h);
    }
  });
});

describe("SYSTEM_PROMPT — date rules", () => {
  it("mandates DD/MM/YYYY as the default SA format", () => {
    expect(SYSTEM_PROMPT).toContain("DD/MM/YYYY");
    expect(SYSTEM_PROMPT).toMatch(/NEVER parse as MM\/DD\/YYYY/);
  });

  it("handles approximate month-year dates with mid-month collapse", () => {
    // "Jan 2018" -> "2018-01-15"
    expect(SYSTEM_PROMPT).toMatch(/YYYY-MM-15/);
    expect(SYSTEM_PROMPT).toContain("approximate: true");
  });

  it("lists all Afrikaans month abbreviations", () => {
    const months = [
      "jan",
      "feb",
      "mrt",
      "apr",
      "mei",
      "jun",
      "jul",
      "aug",
      "sep",
      "okt",
      "nov",
      "des",
    ];
    for (const m of months) {
      expect(SYSTEM_PROMPT).toContain(m);
    }
  });
});

describe("SYSTEM_PROMPT — LSU weights", () => {
  it("documents cattle LSU weights exactly", () => {
    expect(SYSTEM_PROMPT).toMatch(/Cow 1\.0/);
    expect(SYSTEM_PROMPT).toMatch(/Bull 1\.5/);
    expect(SYSTEM_PROMPT).toMatch(/Heifer 0\.75/);
    expect(SYSTEM_PROMPT).toMatch(/Calf 0\.25/);
  });

  it("documents sheep LSU weights", () => {
    expect(SYSTEM_PROMPT).toMatch(/Ewe 0\.15/);
  });

  it("documents game LSU weights", () => {
    expect(SYSTEM_PROMPT).toMatch(/Kudu 0\.4/);
    expect(SYSTEM_PROMPT).toMatch(/Wildebeest 0\.6/);
  });
});

describe("SYSTEM_PROMPT — pedigree resolution", () => {
  it("documents the two-pass resolution pattern", () => {
    expect(SYSTEM_PROMPT).toMatch(/Pass 1/);
    expect(SYSTEM_PROMPT).toMatch(/Pass 2/);
    expect(SYSTEM_PROMPT).toMatch(/two-pass/);
  });

  it("defines sireNote and damNote as free-text fallbacks", () => {
    expect(SYSTEM_PROMPT).toContain("sireNote");
    expect(SYSTEM_PROMPT).toContain("damNote");
    expect(SYSTEM_PROMPT).toMatch(/free.text/i);
  });
});

describe("SYSTEM_PROMPT — output format", () => {
  it("specifies the strict JSON response shape", () => {
    expect(SYSTEM_PROMPT).toContain('"mapping"');
    expect(SYSTEM_PROMPT).toContain('"unmapped"');
    expect(SYSTEM_PROMPT).toContain('"warnings"');
    expect(SYSTEM_PROMPT).toContain('"row_count"');
    expect(SYSTEM_PROMPT).toContain('"confidence"');
    expect(SYSTEM_PROMPT).toContain("upsell_hint");
  });

  it("encodes confidence bands from the master plan", () => {
    expect(SYSTEM_PROMPT).toMatch(/0\.85/);
    expect(SYSTEM_PROMPT).toMatch(/0\.60/);
  });
});

describe("SYSTEM_PROMPT — principles", () => {
  it("asserts spine over completeness", () => {
    expect(SYSTEM_PROMPT).toMatch(/[Ss]pine over completeness/);
  });

  it("asserts farmer-privacy — file bytes discarded after parse", () => {
    expect(SYSTEM_PROMPT).toMatch(/discarded/);
  });
});

describe("SYSTEM_PROMPT — budget", () => {
  it("stays under the 5,000 token cache budget", () => {
    expect(SYSTEM_PROMPT_APPROX_TOKEN_COUNT).toBeLessThanOrEqual(5_000);
  });

  it("has a semver version", () => {
    expect(SYSTEM_PROMPT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("AFRIKAANS_MONTH_MAP", () => {
  it("includes every Afrikaans month", () => {
    expect(AFRIKAANS_MONTH_MAP.jan).toBe(1);
    expect(AFRIKAANS_MONTH_MAP.feb).toBe(2);
    expect(AFRIKAANS_MONTH_MAP.mrt).toBe(3);
    expect(AFRIKAANS_MONTH_MAP.apr).toBe(4);
    expect(AFRIKAANS_MONTH_MAP.mei).toBe(5);
    expect(AFRIKAANS_MONTH_MAP.jun).toBe(6);
    expect(AFRIKAANS_MONTH_MAP.jul).toBe(7);
    expect(AFRIKAANS_MONTH_MAP.aug).toBe(8);
    expect(AFRIKAANS_MONTH_MAP.sep).toBe(9);
    expect(AFRIKAANS_MONTH_MAP.okt).toBe(10);
    expect(AFRIKAANS_MONTH_MAP.nov).toBe(11);
    expect(AFRIKAANS_MONTH_MAP.des).toBe(12);
  });

  it("aliases English month abbreviations for case-insensitive lookup", () => {
    expect(AFRIKAANS_MONTH_MAP.mar).toBe(3);
    expect(AFRIKAANS_MONTH_MAP.may).toBe(5);
    expect(AFRIKAANS_MONTH_MAP.oct).toBe(10);
    expect(AFRIKAANS_MONTH_MAP.dec).toBe(12);
  });
});

describe("AFRIKAANS_CATTLE_CATEGORY_MAP", () => {
  it("normalizes every Afrikaans cattle category", () => {
    expect(AFRIKAANS_CATTLE_CATEGORY_MAP.koei).toBe("Cow");
    expect(AFRIKAANS_CATTLE_CATEGORY_MAP.bul).toBe("Bull");
    expect(AFRIKAANS_CATTLE_CATEGORY_MAP.vers).toBe("Heifer");
    expect(AFRIKAANS_CATTLE_CATEGORY_MAP.kalf).toBe("Calf");
    expect(AFRIKAANS_CATTLE_CATEGORY_MAP.os).toBe("Ox");
  });

  it("passes through English values unchanged", () => {
    expect(AFRIKAANS_CATTLE_CATEGORY_MAP.cow).toBe("Cow");
    expect(AFRIKAANS_CATTLE_CATEGORY_MAP.bull).toBe("Bull");
  });
});

describe("AFRIKAANS_SHEEP_CATEGORY_MAP", () => {
  it("normalizes every Afrikaans sheep category", () => {
    expect(AFRIKAANS_SHEEP_CATEGORY_MAP.ooi).toBe("Ewe");
    expect(AFRIKAANS_SHEEP_CATEGORY_MAP.ram).toBe("Ram");
    expect(AFRIKAANS_SHEEP_CATEGORY_MAP.lam).toBe("Lamb");
    expect(AFRIKAANS_SHEEP_CATEGORY_MAP.hamel).toBe("Wether");
  });
});

describe("AFRIKAANS_SEX_MAP", () => {
  it("maps Afrikaans sex words to canonical English", () => {
    expect(AFRIKAANS_SEX_MAP.manlik).toBe("Male");
    expect(AFRIKAANS_SEX_MAP.vroulik).toBe("Female");
  });

  it("accepts single-letter abbreviations", () => {
    expect(AFRIKAANS_SEX_MAP.m).toBe("Male");
    expect(AFRIKAANS_SEX_MAP.v).toBe("Female");
  });
});

describe("CANONICAL_LSU_WEIGHTS", () => {
  it("matches cattle config exactly", () => {
    expect(CANONICAL_LSU_WEIGHTS.Cow).toBe(1.0);
    expect(CANONICAL_LSU_WEIGHTS.Bull).toBe(1.5);
    expect(CANONICAL_LSU_WEIGHTS.Heifer).toBe(0.75);
    expect(CANONICAL_LSU_WEIGHTS.Calf).toBe(0.25);
    expect(CANONICAL_LSU_WEIGHTS.Ox).toBe(1.0);
  });

  it("matches sheep defaults", () => {
    expect(CANONICAL_LSU_WEIGHTS.Ewe).toBe(0.15);
    expect(CANONICAL_LSU_WEIGHTS.Ram).toBe(0.2);
  });

  it("matches game defaults", () => {
    expect(CANONICAL_LSU_WEIGHTS.Impala).toBe(0.15);
    expect(CANONICAL_LSU_WEIGHTS.Kudu).toBe(0.4);
    expect(CANONICAL_LSU_WEIGHTS.Eland).toBe(0.9);
    expect(CANONICAL_LSU_WEIGHTS.Giraffe).toBe(1.5);
  });
});
