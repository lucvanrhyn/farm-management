/**
 * lib/server/adapters/openmeteo-door.ts — the Open-Meteo boundary door.
 *
 * Issue #525 (PRD #521 Workstream E / umbrella #115). THE single zod boundary
 * for every Open-Meteo HTTP response the app parses. Mirrors the ADR-0007
 * `details-schemas.ts` door pattern: a single home, `.passthrough()` so
 * upstream-added fields never reject, `z.coerce.number()` for the
 * stringly-typed-numeric ambiguity, and a discriminated `Result`
 * (`{ ok:true, value }` | `{ ok:false, error }`) instead of an unchecked `as`
 * cast at the call site.
 *
 * Why a door (the bug this closes)
 * ────────────────────────────────
 * Both `lib/server/open-meteo.ts` (ARCHIVE API → climatology normals) and
 * `components/dashboard/WeatherWidget.tsx` (FORECAST API → dashboard widget)
 * used to `(await res.json()) as <hand-written shape>` and then read
 * `daily.precipitation_sum` with a `?? []` / `?? 0` fallback. A provider format
 * change that dropped or renamed `precipitation_sum` therefore degraded
 * SILENTLY to all-zero rainfall — which the SPI / drought math in
 * `lib/server/drought.ts` consumed as a genuine drought signal. The door turns
 * that single most-dangerous failure (an absent / mis-typed `precipitation_sum`
 * ARRAY) into a TYPED boundary error so the caller fails loudly / falls back,
 * never fabricates a drought.
 *
 * Two entries, one envelope
 * ─────────────────────────
 * Open-Meteo exposes two different response shapes:
 *   - {@link parseOpenMeteoArchive}  — ERA5 archive (`archive-api`): a `daily`
 *     block with `time` + `precipitation_sum` only.
 *   - {@link parseOpenMeteoForecast} — forecast (`api.open-meteo.com`): a
 *     `current` block plus a richer `daily` block (temps + precip + weathercode).
 * Both return the same {@link OpenMeteoResult} envelope.
 *
 * What is — and isn't — an error
 * ──────────────────────────────
 * A per-element `null` inside `precipitation_sum` is a GENUINE Open-Meteo
 * missing-day marker and is PRESERVED (`number | null`). Mapping those nulls to
 * 0 is the caller's explicit, legible decision (see `open-meteo.ts`). What the
 * door rejects is the *array itself* being absent or the wrong type — the drift
 * that previously vanished into a zero-fill.
 */
import { z } from "zod";

// ────────────────────────────────────────────────────────────────────────────
// Result envelope + typed boundary error.
// ────────────────────────────────────────────────────────────────────────────

/** Wire/log code for a failed Open-Meteo boundary parse. */
export const OPEN_METEO_PARSE_FAILED = "OPEN_METEO_PARSE_FAILED" as const;

/**
 * The typed boundary error carried by a failed {@link OpenMeteoResult}. Carries
 * the zod issue list so a caller / log line can name the offending path
 * (`daily.precipitation_sum`) rather than a generic "weather unavailable".
 */
export class OpenMeteoParseError extends Error {
  readonly code = OPEN_METEO_PARSE_FAILED;
  readonly issues: z.core.$ZodIssue[];
  constructor(issues: z.core.$ZodIssue[]) {
    const first = issues[0];
    super(
      `Open-Meteo response failed boundary validation${
        first ? `: ${first.path.join(".")} — ${first.message}` : ""
      }`,
    );
    this.name = "OpenMeteoParseError";
    this.issues = issues;
  }
}

/**
 * Discriminated parse result. `ok:true` carries the typed, coerced value;
 * `ok:false` carries the typed {@link OpenMeteoParseError}. Mirrors the
 * `{ ok, value } | { ok, error }` shape ADR-0007 standardised so call sites
 * branch explicitly instead of trusting an `as` cast.
 */
export type OpenMeteoResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: OpenMeteoParseError };

// ────────────────────────────────────────────────────────────────────────────
// Shared field schemas.
// ────────────────────────────────────────────────────────────────────────────

/**
 * A precipitation array element: a coerced finite number, OR a genuine
 * Open-Meteo `null` missing-day marker. `z.coerce.number()` reproduces the
 * defensive numeric-string handling (a transport that stringifies a numeric
 * still parses) while a non-numeric string (`"not-a-number"` → `NaN`) is
 * rejected by the `.refine`. `null` short-circuits the coercion and is kept.
 */
const PrecipValue = z.union([
  z.null(),
  z.coerce.number().refine(Number.isFinite, {
    message: "precipitation value must be a finite number",
  }),
]);

/** A coerced finite number (no null allowed) — for temps / weathercodes. */
const CoercedNumber = z.coerce.number().refine(Number.isFinite, {
  message: "expected a finite number",
});

/** An array of coerced finite numbers (temps, weathercodes per day). */
const CoercedNumberArray = z.array(CoercedNumber);

/**
 * The non-negotiable daily-rainfall fields. `precipitation_sum` is REQUIRED and
 * must be an array — its absence is the headline boundary error. `.min(1)` is
 * deliberately NOT applied: a zero-length response (e.g. an out-of-range date
 * window) is a legitimate empty result, distinct from a missing field.
 */
const PrecipDaily = z.object({
  time: z.array(z.string()),
  precipitation_sum: z.array(PrecipValue),
});

// ────────────────────────────────────────────────────────────────────────────
// Archive API door (lib/server/open-meteo.ts).
// ────────────────────────────────────────────────────────────────────────────

/**
 * The archive response shape. `.passthrough()` at every level so provider
 * additions (`generationtime_ms`, `utc_offset_seconds`, future keys) survive
 * untouched. `daily` carries exactly the two fields the climatology fetch
 * reads.
 */
const ArchiveResponseSchema = z
  .object({
    daily: PrecipDaily.passthrough(),
  })
  .passthrough();

export type OpenMeteoArchiveResponse = z.infer<typeof ArchiveResponseSchema> & {
  daily: { time: string[]; precipitation_sum: (number | null)[] };
};

/**
 * Parse a raw Open-Meteo ARCHIVE `res.json()` payload. Returns
 * `{ ok:false }` (NOT a zero-fill) when `daily.precipitation_sum` is absent or
 * mis-typed — the exact drift that previously corrupted SPI silently.
 */
export function parseOpenMeteoArchive(
  raw: unknown,
): OpenMeteoResult<OpenMeteoArchiveResponse> {
  const parsed = ArchiveResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: new OpenMeteoParseError(parsed.error.issues) };
  }
  return { ok: true, value: parsed.data as OpenMeteoArchiveResponse };
}

// ────────────────────────────────────────────────────────────────────────────
// Forecast API door (components/dashboard/WeatherWidget.tsx).
// ────────────────────────────────────────────────────────────────────────────

const ForecastResponseSchema = z
  .object({
    current: z
      .object({
        temperature_2m: CoercedNumber,
        weathercode: CoercedNumber,
      })
      .passthrough(),
    daily: z
      .object({
        time: z.array(z.string()),
        temperature_2m_max: CoercedNumberArray,
        temperature_2m_min: CoercedNumberArray,
        precipitation_sum: z.array(PrecipValue),
        weathercode: CoercedNumberArray,
      })
      .passthrough(),
  })
  .passthrough();

export type OpenMeteoForecastResponse = z.infer<
  typeof ForecastResponseSchema
> & {
  current: { temperature_2m: number; weathercode: number };
  daily: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_sum: (number | null)[];
    weathercode: number[];
  };
};

/**
 * Parse a raw Open-Meteo FORECAST `res.json()` payload (the widget shape).
 * Same boundary guarantee as the archive door: an absent / mis-typed
 * `daily.precipitation_sum` (or an absent `current`) → `{ ok:false }` rather
 * than a silently-degraded widget.
 */
export function parseOpenMeteoForecast(
  raw: unknown,
): OpenMeteoResult<OpenMeteoForecastResponse> {
  const parsed = ForecastResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: new OpenMeteoParseError(parsed.error.issues) };
  }
  return { ok: true, value: parsed.data as OpenMeteoForecastResponse };
}
