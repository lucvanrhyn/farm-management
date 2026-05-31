// @vitest-environment node
import { describe, it, expect } from "vitest";

import {
  auditSource,
  isExternalBoundaryFile,
  offenderKey,
  EXTERNAL_PROVIDER_HOSTS,
  type Offender,
} from "../audit-external-as-cast";

/**
 * Issue #525 — the external-provider boundary `as`-cast guard.
 *
 * Scope (deliberately narrow so legitimate internal casts never trip): an
 * offender requires BOTH (1) the file is an external-API boundary — it
 * `fetch`es a known third-party provider host — AND (2) a `.json()` /
 * `JSON.parse(...)` body is `as`-cast to a CONCRETE type. That is the exact
 * #525 bug class: casting an Open-Meteo body to a hand-written shape instead of
 * routing it through a zod door, so a provider format change degrades silently.
 *
 * NOT offenders (must never trip): `x as const`, internal-value casts, a
 * `.json()`/`JSON.parse` cast in a NON-boundary file (our own routes,
 * sessionStorage caches), a boundary cast to `unknown` / `Promise<unknown>`
 * (the safe door-feeding shape), or any cast carrying an
 * `// audit-allow-external-cast:` pragma on the preceding line.
 *
 * The cast-SHAPE detection (part 2) is exercised with the default
 * `isExternalBoundary = true`; `isExternalBoundaryFile` (part 1) is exercised
 * separately.
 */
describe("auditSource — concrete-type cast on an external boundary", () => {
  it("flags `(await res.json()) as T`", () => {
    const source = `const data = (await res.json()) as WeatherResponse;`;
    const offenders = auditSource("bad.ts", source);
    expect(offenders).toHaveLength(1);
    expect(offenders[0].snippet).toContain("res.json()");
  });

  it("flags `res.json() as Promise<T>` (the old WeatherWidget shape)", () => {
    const source = `return res.json() as Promise<OpenMeteoResponse>;`;
    expect(auditSource("widget.ts", source)).toHaveLength(1);
  });

  it("flags `(await response.json()) as SomeType` on any response identifier", () => {
    const source = `const json = (await response.json()) as ApiShape;`;
    expect(auditSource("resp.ts", source)).toHaveLength(1);
  });

  it("flags `JSON.parse(await res.text()) as T` (text-then-parse boundary)", () => {
    const source = `const v = JSON.parse(await res.text()) as Shape;`;
    expect(auditSource("text-parse.ts", source)).toHaveLength(1);
  });

  it("flags a cast to an inline object type `as { … }`", () => {
    // The provider body cast doesn't have to be a named type — an inline
    // object/tuple shape is the same silent-drift hazard.
    const source = `const d = (await res.json()) as { daily: { precipitation_sum: number[] } };`;
    expect(auditSource("inline-obj.ts", source)).toHaveLength(1);
  });

  it("does NOT flag a `.json()` read routed through a door (no cast)", () => {
    const source = [
      `const raw: unknown = await res.json();`,
      `const parsed = parseOpenMeteoArchive(raw);`,
    ].join("\n");
    expect(auditSource("good.ts", source)).toEqual([]);
  });

  it("does NOT flag `res.json() as Promise<unknown>` (safe door-feeding shape)", () => {
    // The fixed WeatherWidget casts to Promise<unknown> then hands it to the
    // door — a safe widening, NOT a hand-written shape.
    const source = `return res.json() as Promise<unknown>;`;
    expect(auditSource("door-feed.ts", source)).toEqual([]);
  });

  it("does NOT flag `await res.json() as unknown`", () => {
    const source = `const raw = (await res.json()) as unknown;`;
    expect(auditSource("unknown.ts", source)).toEqual([]);
  });

  it("does NOT flag `x as const`", () => {
    const source = `const TUPLE = [1, 2, 3] as const;`;
    expect(auditSource("const.ts", source)).toEqual([]);
  });

  it("does NOT flag an internal-value cast unrelated to a .json() boundary", () => {
    const source = [
      `const node = el as HTMLInputElement;`,
      `const v = (config.value as number) + 1;`,
      `const r = result.data as Record<string, unknown>;`,
    ].join("\n");
    expect(auditSource("internal.ts", source)).toEqual([]);
  });

  it("ignores a boundary cast that appears only inside a // line comment", () => {
    const source = [
      `// historical shape: const data = (await res.json()) as WeatherResponse;`,
      `const raw: unknown = await res.json();`,
    ].join("\n");
    expect(auditSource("commented.ts", source)).toEqual([]);
  });

  it("ignores a boundary cast inside a /* block comment */", () => {
    const source = [
      `/*`,
      `  before #525:`,
      `    return res.json() as Promise<OpenMeteoResponse>;`,
      `*/`,
      `const raw: unknown = await res.json();`,
    ].join("\n");
    expect(auditSource("block.ts", source)).toEqual([]);
  });

  it("respects an audit-allow-external-cast pragma on the preceding line", () => {
    const source = [
      `// audit-allow-external-cast: third-party SDK already validates this body`,
      `const data = (await res.json()) as VendorResponse;`,
    ].join("\n");
    expect(auditSource("allow.ts", source)).toEqual([]);
  });

  it("flags each concrete-type boundary cast separately in one file", () => {
    const source = [
      `const a = (await res.json()) as A;`,
      `const b = await other.json();`,
      `const c = (await res.json()) as C;`,
    ].join("\n");
    const offenders = auditSource("multi.ts", source);
    expect(offenders.map((o) => o.line).sort((x, y) => x - y)).toEqual([1, 3]);
  });

  it("returns [] for a non-boundary file even with a concrete-type cast", () => {
    // Part-1 gate: a file that hits no external provider is out of scope —
    // its `req.json() as Body` is validated downstream, not the #525 class.
    const source = `const body = (await req.json()) as Record<string, unknown>;`;
    expect(auditSource("internal-route.ts", source, false)).toEqual([]);
  });
});

describe("isExternalBoundaryFile — part-1 gate", () => {
  it("is true when the file fetches a known external provider host", () => {
    const source = [
      `const url = \`https://archive-api.open-meteo.com/v1/archive?lat=\${lat}\`;`,
      `const res = await fetch(url);`,
    ].join("\n");
    expect(isExternalBoundaryFile(source)).toBe(true);
  });

  it("is false when the file fetches only our own / relative endpoints", () => {
    const source = [
      `const res = await fetch(\`/api/\${slug}/camps\`);`,
      `const res2 = await fetch("https://app.farmtrack.app/x");`,
    ].join("\n");
    expect(isExternalBoundaryFile(source)).toBe(false);
  });

  it("is false when a provider host appears only in a comment", () => {
    const source = [
      `// see https://api.open-meteo.com/v1/forecast docs`,
      `const res = await fetch("/api/local");`,
    ].join("\n");
    expect(isExternalBoundaryFile(source)).toBe(false);
  });

  it("is false when there is no fetch at all", () => {
    const source = `const x = JSON.parse(localStorage.getItem("k")!) as Cache;`;
    expect(isExternalBoundaryFile(source)).toBe(false);
  });

  it("lists open-meteo as a tracked provider host", () => {
    expect(EXTERNAL_PROVIDER_HOSTS).toContain("open-meteo.com");
  });
});

describe("offenderKey", () => {
  it("composes a stable `path::line` string for baseline diffing", () => {
    const o: Offender = { path: "a/b.ts", line: 7, snippet: "…" };
    expect(offenderKey(o)).toBe("a/b.ts::7");
  });
});
