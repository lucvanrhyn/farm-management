/**
 * POST /api/csp-report — sink for browser-emitted CSP violation reports.
 *
 * Why this file exists
 * ────────────────────
 * Wave 4 A8 (Codex MEDIUM, 2026-05-02). The CSP shipped on 2026-04-27 in
 * `Content-Security-Policy-Report-Only` mode without a `report-uri` /
 * `report-to` directive — so during the 2-week soak browsers detected
 * violations but had nowhere to POST them. The 2026-05-11 enforce flip is
 * meant to be informed by 2 weeks of telemetry; without a sink we'd be
 * flipping blind.
 *
 * Wire format
 * ───────────
 * Two body shapes hit this endpoint depending on which directive the
 * browser implements:
 *
 *   1. Legacy CSP2 `report-uri`:
 *        Content-Type: application/csp-report
 *        Body: { "csp-report": { ...fields... } }
 *      Spec: https://www.w3.org/TR/CSP3/#deprecated-serialize-violation
 *
 *   2. Modern Reporting API v1 `report-to csp-endpoint`:
 *        Content-Type: application/reports+json
 *        Body: [ { type: "csp-violation", body: { ...fields... }, ... } ]
 *      The array can multiplex other report types (network-error,
 *      deprecation, intervention) — we only log entries with
 *      `type === "csp-violation"`.
 *      Spec: https://www.w3.org/TR/reporting-1/#serialize-reports
 *
 * Auth
 * ────
 * Intentionally unauthenticated. Browsers POST CSP reports without cookies
 * or `Authorization` headers; gating would drop every report. The route is
 * already added to `proxy.ts` public route allowlist (see
 * `__tests__/api/proxy-matcher.test.ts → KNOWN_PUBLIC_ROUTES`) — if it is
 * not, the auth proxy will 307 these to /login.
 *
 * Rate limiting
 * ─────────────
 * Not applied. CSP reports are first-party-triggered by our own pages and
 * the logger write is cheap (stdout — no DB, no external HTTP). If a chatty
 * page produces a flood we'd rather have the data than a silent drop. If
 * log volume becomes a problem during the soak, add an in-memory dedupe
 * keyed on `(documentUri, blockedUri, violatedDirective)` over a short
 * window — but don't over-engineer it preemptively.
 *
 * Response
 * ────────
 * Always 204 No Content — even on malformed bodies. Browsers cannot retry
 * a CSP report usefully (no exponential backoff, no surfacing to user
 * code), so a 4xx just adds log noise without a useful action. We log
 * every parsed violation under `[csp-violation]` for grep + structured
 * field query during the soak.
 */

import { NextResponse, type NextRequest } from "next/server";
import { logger } from "@/lib/logger";

// Force the dynamic Node runtime — the request body must be read every
// invocation and we don't want any caching layer in front.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ── Logged shape ─────────────────────────────────────────────────────────
// Both wire formats normalise into this. Camel-cased so the structured
// log is consistent regardless of which directive the browser used. We
// deliberately limit logged fields to URIs + directives + the disposition
// — the CSP report spec doesn't carry user-identifiable data, but we
// avoid logging arbitrary unbounded strings (the optional `sample` field
// can include script source which we don't want in logs).
interface LoggedViolation {
  source: "report-uri" | "reports+json";
  documentUri?: string;
  referrer?: string;
  blockedUri?: string;
  violatedDirective?: string;
  effectiveDirective?: string;
  disposition?: string;
  statusCode?: number;
  lineNumber?: number;
  columnNumber?: number;
  sourceFile?: string;
}

const NO_CONTENT = new NextResponse(null, { status: 204 });

function pickString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function pickNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Normalise the legacy CSP2 `application/csp-report` body. */
function normaliseLegacy(report: Record<string, unknown>): LoggedViolation {
  return {
    source: "report-uri",
    documentUri: pickString(report["document-uri"]),
    referrer: pickString(report["referrer"]),
    blockedUri: pickString(report["blocked-uri"]),
    violatedDirective: pickString(report["violated-directive"]),
    effectiveDirective: pickString(report["effective-directive"]),
    disposition: pickString(report["disposition"]),
    statusCode: pickNumber(report["status-code"]),
    lineNumber: pickNumber(report["line-number"]),
    columnNumber: pickNumber(report["column-number"]),
    sourceFile: pickString(report["source-file"]),
  };
}

/** Normalise a single Reporting-API-v1 csp-violation entry. */
function normaliseModern(report: Record<string, unknown>): LoggedViolation {
  const body =
    report.body && typeof report.body === "object"
      ? (report.body as Record<string, unknown>)
      : {};
  return {
    source: "reports+json",
    documentUri: pickString(body.documentURL) ?? pickString(report.url),
    referrer: pickString(body.referrer),
    blockedUri: pickString(body.blockedURL),
    // Reporting API v1 collapsed `violated-directive` into
    // `effectiveDirective` only — mirror it into both fields so log
    // queries don't need to know which wire format produced the entry.
    violatedDirective: pickString(body.effectiveDirective),
    effectiveDirective: pickString(body.effectiveDirective),
    disposition: pickString(body.disposition),
    statusCode: pickNumber(body.statusCode),
    lineNumber: pickNumber(body.lineNumber),
    columnNumber: pickNumber(body.columnNumber),
    sourceFile: pickString(body.sourceFile),
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Read the body once as text — we may need to parse it as JSON or treat
  // it as opaque if the browser sent something we don't understand.
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return NO_CONTENT;
  }

  if (!raw) return NO_CONTENT;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Malformed body — return 204 silently. Browsers can't retry usefully
    // and we don't want to fill logs with parse errors.
    return NO_CONTENT;
  }

  // Modern Reporting API: top-level array. Each entry has a `type`; we
  // only care about csp-violation. Other types (network-error,
  // deprecation, intervention) are dropped without logging — they can be
  // routed to their own endpoint later if we ever want them.
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (
        entry &&
        typeof entry === "object" &&
        (entry as Record<string, unknown>).type === "csp-violation"
      ) {
        const violation = normaliseModern(entry as Record<string, unknown>);
        logger.warn("[csp-violation]", violation);
      }
    }
    return NO_CONTENT;
  }

  // Legacy CSP2: `{ "csp-report": { ... } }`.
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const report = obj["csp-report"];
    if (report && typeof report === "object") {
      const violation = normaliseLegacy(report as Record<string, unknown>);
      logger.warn("[csp-violation]", violation);
    }
  }

  return NO_CONTENT;
}
