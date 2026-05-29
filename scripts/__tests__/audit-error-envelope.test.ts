// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  auditSource,
  offenderKey,
  type Offender,
} from "../audit-error-envelope";

/**
 * `audit-error-envelope` is the API-error-contract structural lock (issue
 * #493, PRD #479 Epic B). It fails CI on any `app/api/**` route handler that
 * either
 *
 *   (a) builds an ad-hoc error envelope whose `error` value is a bare string
 *       LITERAL (e.g. `NextResponse.json({ error: "Unauthorized" })`), or
 *   (b) echoes a raw exception message (`{ error: err.message }`) into the
 *       client-facing envelope — the info-leak class.
 *
 * The canonical contract is the typed envelope minted by `routeError(code,
 * message?, status?)` (lib/server/route/envelope.ts) / `mapApiDomainError`
 * (lib/server/api-errors.ts): `{ error: CODE }` where CODE is a
 * SCREAMING_SNAKE machine-readable string. A `routeError("AUTH_REQUIRED",
 * ...)` call is compliant by construction — the literal lives in the
 * envelope minter, not the route.
 *
 * The analyser only inspects `error:` keys that appear INSIDE a response
 * constructor (`NextResponse.json(...)` / `new Response(JSON.stringify(...))`
 * / `Response.json(...)`). A bare `return { error: "..." }` from an internal
 * validation helper (e.g. `parseBody`'s discriminated-union result) is NOT a
 * wire envelope and must not be flagged.
 */
describe("auditSource — error envelope contract", () => {
  it("flags a NextResponse.json bare-string error literal", () => {
    const source = `return NextResponse.json({ error: "Unauthorized" }, { status: 401 });`;
    const offenders = auditSource("app/api/x/route.ts", source);
    expect(offenders).toHaveLength(1);
    expect(offenders[0].kind).toBe("literal");
  });

  it("flags a raw-exception message echo (err.message)", () => {
    const source = `return NextResponse.json({ error: err.message }, { status: 400 });`;
    const offenders = auditSource("app/api/x/route.ts", source);
    expect(offenders).toHaveLength(1);
    expect(offenders[0].kind).toBe("message-echo");
  });

  it("flags a message echo with a differently-named variable", () => {
    const source = `return NextResponse.json({ error: e.message }, { status: 400 });`;
    const offenders = auditSource("app/api/x/route.ts", source);
    expect(offenders).toHaveLength(1);
    expect(offenders[0].kind).toBe("message-echo");
  });

  it("flags a message echo inside new Response(JSON.stringify(...))", () => {
    const source = `return new Response(JSON.stringify({ error: err.message }), { status: 500 });`;
    const offenders = auditSource("app/api/x/route.ts", source);
    expect(offenders).toHaveLength(1);
    expect(offenders[0].kind).toBe("message-echo");
  });

  it("flags a template-literal error value (interpolated, not typed)", () => {
    const source =
      "return NextResponse.json({ error: `OpenAI request failed: ${status}` }, { status: 502 });";
    const offenders = auditSource("app/api/x/route.ts", source);
    expect(offenders).toHaveLength(1);
    expect(offenders[0].kind).toBe("literal");
  });

  it("permits the canonical routeError minter", () => {
    const source = `return routeError("AUTH_REQUIRED", "Unauthorized", 401);`;
    expect(auditSource("app/api/x/route.ts", source)).toEqual([]);
  });

  it("permits forwarding a typed code via err.code", () => {
    // mapApiDomainError forwards `{ error: err.code }` — a typed code, NOT a
    // literal and NOT a raw message. Must not be flagged.
    const source = `return NextResponse.json({ error: err.code }, { status: 422 });`;
    expect(auditSource("app/api/x/route.ts", source)).toEqual([]);
  });

  it("permits forwarding a typed code via a result discriminator", () => {
    const source = `return NextResponse.json({ error: result.reason }, { status: 422 });`;
    expect(auditSource("app/api/x/route.ts", source)).toEqual([]);
  });

  it("does NOT flag a bare `return { error: ... }` (internal validation result, not a wire envelope)", () => {
    // parseBody-style discriminated unions return `{ error: "<sentence>" }`
    // as an internal result object. These never reach the wire as-is — the
    // route maps them. Only constructor-argument envelopes are in scope.
    const source = [
      `function parseBody(raw) {`,
      `  if (typeof raw !== "object") return { error: "Request body must be a JSON object" };`,
      `  return { value: raw };`,
      `}`,
    ].join("\n");
    expect(auditSource("app/api/x/route.ts", source)).toEqual([]);
  });

  it("ignores error literals inside // line comments", () => {
    const source = [
      `// legacy: return NextResponse.json({ error: "Unauthorized" }, { status: 401 });`,
      `return routeError("AUTH_REQUIRED", "Unauthorized", 401);`,
    ].join("\n");
    expect(auditSource("app/api/x/route.ts", source)).toEqual([]);
  });

  it("ignores error literals inside /* ... */ block comments", () => {
    const source = [
      `/*`,
      `  Old shape: NextResponse.json({ error: "Forbidden" }, { status: 403 })`,
      `*/`,
      `return routeError("FORBIDDEN", "Forbidden", 403);`,
    ].join("\n");
    expect(auditSource("app/api/x/route.ts", source)).toEqual([]);
  });

  it("does not treat a nested message field as the error value", () => {
    // `message: err.message` is the canonical human-readable slot; only the
    // `error:` value is the machine code that must stay typed.
    const source = `return routeError("DB_QUERY_FAILED", err.message, 500);`;
    expect(auditSource("app/api/x/route.ts", source)).toEqual([]);
  });

  it("flags each constructor envelope separately when multiple appear", () => {
    const source = [
      `if (a) return NextResponse.json({ error: "Forbidden" }, { status: 403 });`,
      `if (b) return NextResponse.json({ error: err.message }, { status: 400 });`,
      `return NextResponse.json({ error: ok.code }, { status: 422 });`,
    ].join("\n");
    const offenders = auditSource("app/api/x/route.ts", source);
    expect(offenders.map((o) => o.line).sort((x, y) => x - y)).toEqual([1, 2]);
  });

  it("respects an audit-allow-error-envelope pragma on the preceding line", () => {
    const source = [
      `// audit-allow-error-envelope: legacy wire-shape preserved for offline client`,
      `return NextResponse.json({ error: "Camp not found" }, { status: 404 });`,
    ].join("\n");
    expect(auditSource("app/api/x/route.ts", source)).toEqual([]);
  });

  it("only counts the per-file occurrence index for offenders of the same kind ordering", () => {
    const source = [
      `return NextResponse.json({ error: "Forbidden" }, { status: 403 });`,
      `return NextResponse.json({ error: "Not found" }, { status: 404 });`,
    ].join("\n");
    const offenders = auditSource("app/api/x/route.ts", source);
    expect(offenders).toHaveLength(2);
    expect(offenders[0].occurrenceIndex).toBe(0);
    expect(offenders[1].occurrenceIndex).toBe(1);
  });

  it("does not match error literals in object keys other than `error`", () => {
    const source = `return NextResponse.json({ code: "FORBIDDEN", message: "x" }, { status: 403 });`;
    // No `error:` key → nothing to flag. The audit only governs the `error`
    // slot of the canonical envelope.
    expect(auditSource("app/api/x/route.ts", source)).toEqual([]);
  });
});

describe("offenderKey", () => {
  it("composes a stable `path::kind::occurrenceIndex` string for baseline diffing", () => {
    const o: Offender = {
      path: "app/api/x/route.ts",
      line: 42,
      snippet: "…",
      kind: "literal",
      occurrenceIndex: 3,
    };
    expect(offenderKey(o)).toBe("app/api/x/route.ts::literal::3");
  });
});
