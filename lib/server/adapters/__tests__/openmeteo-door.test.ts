/**
 * @vitest-environment node
 *
 * Issue #525 (PRD #521 Workstream E / umbrella #115) — the Open-Meteo boundary
 * door.
 *
 * THE single zod boundary for every Open-Meteo response the app parses. Both
 * the server climatology fetch (`lib/server/open-meteo.ts`, ARCHIVE API) and
 * the dashboard widget (`components/dashboard/WeatherWidget.tsx`, FORECAST API)
 * route the raw `res.json()` through one of the two door entries below instead
 * of an unchecked `as` cast.
 *
 * The headline regression this suite locks: a provider format change that drops
 * or mis-shapes `daily.precipitation_sum` used to be silently coerced to
 * all-zero rainfall (`sums[i] ?? 0`), corrupting the SPI / drought math
 * downstream (`lib/server/drought.ts`). The door turns that into a TYPED
 * boundary error (`ok:false`) so the caller can fail loudly / fall back, never
 * persist a fabricated drought.
 *
 * Contract proven here:
 *   1. A good archive / forecast payload → `{ ok:true, value }` with a typed,
 *      coerced shape.
 *   2. A payload missing `daily.precipitation_sum` → `{ ok:false, error }`
 *      (NOT a zero-fill). ← headline lock.
 *   3. `.passthrough()`: an unknown upstream-added top-level field survives.
 *   4. Coercion: a stringly-typed numeric (`"12.3"`) is coerced to a number.
 *   5. Individual `null` array elements (genuine Open-Meteo missing-day marker)
 *      are PRESERVED as `null` — only an absent/mis-typed ARRAY is an error.
 */
import { describe, it, expect } from "vitest";

import {
  parseOpenMeteoArchive,
  parseOpenMeteoForecast,
  OpenMeteoParseError,
  type OpenMeteoResult,
  type OpenMeteoArchiveResponse,
} from "../openmeteo-door";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function goodArchivePayload(): unknown {
  return {
    latitude: -29.0,
    longitude: 24.0,
    daily: {
      time: ["2020-01-01", "2020-01-02", "2020-01-03"],
      precipitation_sum: [0, 4.2, 0],
    },
  };
}

function goodForecastPayload(): unknown {
  return {
    latitude: -29.0,
    longitude: 24.0,
    current: { temperature_2m: 21.4, weathercode: 1 },
    daily: {
      time: ["2026-05-30", "2026-05-31"],
      temperature_2m_max: [22, 24],
      temperature_2m_min: [9, 10],
      precipitation_sum: [0, 1.2],
      weathercode: [1, 61],
    },
  };
}

// ── Archive door — happy path + passthrough + coercion ────────────────────────

describe("parseOpenMeteoArchive — happy path", () => {
  it("parses a good archive payload to ok:true with a typed daily block", () => {
    const result: OpenMeteoResult<OpenMeteoArchiveResponse> =
      parseOpenMeteoArchive(goodArchivePayload());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.daily.time).toEqual([
      "2020-01-01",
      "2020-01-02",
      "2020-01-03",
    ]);
    expect(result.value.daily.precipitation_sum).toEqual([0, 4.2, 0]);
  });

  it("passes through an unknown upstream-added top-level field (.passthrough)", () => {
    const payload = {
      ...(goodArchivePayload() as Record<string, unknown>),
      generationtime_ms: 0.42, // a real Open-Meteo field we don't model
      utc_offset_seconds: 7200,
    };
    const result = parseOpenMeteoArchive(payload);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    // Survives — extra keys must never reject (provider adds fields freely).
    expect((result.value as Record<string, unknown>).generationtime_ms).toBe(
      0.42,
    );
  });

  it("coerces a stringly-typed numeric precipitation value to a number", () => {
    // Defensive: if a transport ever stringifies the numeric (proxy / cache
    // round-trip), coercion reproduces the number rather than rejecting.
    const payload = {
      daily: {
        time: ["2020-01-01", "2020-01-02"],
        precipitation_sum: ["12.3", 4],
      },
    };
    const result = parseOpenMeteoArchive(payload);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.daily.precipitation_sum).toEqual([12.3, 4]);
  });

  it("preserves genuine null missing-day markers in precipitation_sum", () => {
    // Open-Meteo returns null for a day with no data. That is a VALID array;
    // only an absent/mis-typed ARRAY is a boundary error. The caller (open-
    // meteo.ts) maps these per-element nulls to 0 — that is a legitimate,
    // explicit decision, NOT the silent all-array zero-fill this door prevents.
    const payload = {
      daily: {
        time: ["2020-01-01", "2020-01-02", "2020-01-03"],
        precipitation_sum: [1.5, null, 3.0],
      },
    };
    const result = parseOpenMeteoArchive(payload);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.daily.precipitation_sum).toEqual([1.5, null, 3.0]);
  });
});

// ── Archive door — the headline regression lock ───────────────────────────────

describe("parseOpenMeteoArchive — missing precipitation_sum is a boundary error", () => {
  it("returns ok:false (NOT a zero-fill) when daily.precipitation_sum is absent", () => {
    // THE bug: provider format change drops precipitation_sum → old code did
    // `json.daily?.precipitation_sum ?? []` → empty/zero rainfall → wrong SPI.
    const payload = {
      latitude: -29.0,
      longitude: 24.0,
      daily: {
        time: ["2020-01-01", "2020-01-02"],
        // precipitation_sum INTENTIONALLY ABSENT
      },
    };
    const result = parseOpenMeteoArchive(payload);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a boundary error, got ok");
    expect(result.error).toBeInstanceOf(OpenMeteoParseError);
    expect(result.error.code).toBe("OPEN_METEO_PARSE_FAILED");
    expect(result.error.issues.length).toBeGreaterThan(0);
  });

  it("returns ok:false when daily is absent entirely", () => {
    const result = parseOpenMeteoArchive({ latitude: -29, longitude: 24 });
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when precipitation_sum is the wrong type (object, not array)", () => {
    const payload = {
      daily: {
        time: ["2020-01-01"],
        precipitation_sum: { not: "an array" },
      },
    };
    const result = parseOpenMeteoArchive(payload);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when a precipitation value is a non-numeric string", () => {
    const payload = {
      daily: {
        time: ["2020-01-01"],
        precipitation_sum: ["not-a-number"],
      },
    };
    const result = parseOpenMeteoArchive(payload);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false for a null / non-object root payload", () => {
    expect(parseOpenMeteoArchive(null).ok).toBe(false);
    expect(parseOpenMeteoArchive("garbage").ok).toBe(false);
    expect(parseOpenMeteoArchive(undefined).ok).toBe(false);
  });
});

// ── Forecast door — widget shape ──────────────────────────────────────────────

describe("parseOpenMeteoForecast — widget shape", () => {
  it("parses a good forecast payload to ok:true with current + daily blocks", () => {
    const result = parseOpenMeteoForecast(goodForecastPayload());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.current.temperature_2m).toBe(21.4);
    expect(result.value.current.weathercode).toBe(1);
    expect(result.value.daily.temperature_2m_max).toEqual([22, 24]);
    expect(result.value.daily.precipitation_sum).toEqual([0, 1.2]);
    expect(result.value.daily.weathercode).toEqual([1, 61]);
  });

  it("returns ok:false (NOT a zero-fill) when daily.precipitation_sum is absent", () => {
    const payload = {
      current: { temperature_2m: 20, weathercode: 0 },
      daily: {
        time: ["2026-05-30"],
        temperature_2m_max: [22],
        temperature_2m_min: [9],
        // precipitation_sum ABSENT
        weathercode: [1],
      },
    };
    const result = parseOpenMeteoForecast(payload);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a boundary error, got ok");
    expect(result.error).toBeInstanceOf(OpenMeteoParseError);
    expect(result.error.code).toBe("OPEN_METEO_PARSE_FAILED");
  });

  it("returns ok:false when current is absent", () => {
    const payload = {
      daily: {
        time: ["2026-05-30"],
        temperature_2m_max: [22],
        temperature_2m_min: [9],
        precipitation_sum: [0],
        weathercode: [1],
      },
    };
    expect(parseOpenMeteoForecast(payload).ok).toBe(false);
  });

  it("passes through an unknown upstream-added top-level field", () => {
    const payload = {
      ...(goodForecastPayload() as Record<string, unknown>),
      timezone_abbreviation: "SAST",
    };
    const result = parseOpenMeteoForecast(payload);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect((result.value as Record<string, unknown>).timezone_abbreviation).toBe(
      "SAST",
    );
  });

  it("coerces stringly-typed forecast numerics", () => {
    const payload = {
      current: { temperature_2m: "19.8", weathercode: "2" },
      daily: {
        time: ["2026-05-30"],
        temperature_2m_max: ["22"],
        temperature_2m_min: ["9"],
        precipitation_sum: ["0.4"],
        weathercode: ["61"],
      },
    };
    const result = parseOpenMeteoForecast(payload);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.current.temperature_2m).toBe(19.8);
    expect(result.value.daily.precipitation_sum).toEqual([0.4]);
  });
});
