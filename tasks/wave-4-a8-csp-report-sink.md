# Wave 4 A8 — CSP report sink (MEDIUM, Codex 2026-05-02)

**Branch:** `wave/4-csp-report-sink` (off `origin/main` at `f5d1491`).
**Worktree:** `.worktrees/wave/4-csp-report-sink/`.
**Unblocks:** 2026-05-11 CSP enforce flip.

---

## Codex finding (verbatim)

> MEDIUM: "CSP report-only soak has no report sink — flip to enforce on
> 2026-05-11 depends on telemetry not being collected."

`lib/security/csp.ts` ships `Content-Security-Policy-Report-Only` with no
`report-uri` or `report-to` directive, so browsers detect violations during
the soak but have nowhere to POST them. The 2026-05-11 enforce flip is meant
to be informed by 2 weeks of telemetry — currently we are flying blind.

---

## Plan

- [x] Read `lib/security/csp.ts` and verify the policy string lacks `report-uri`.
- [x] Read `next.config.ts` to confirm headers are applied via the Next config
  `headers()` plumbing (so a new `Reporting-Endpoints` header from
  `buildSecurityHeaders()` will propagate to every response).
- [x] RED — write `__tests__/security/csp-report.test.ts` covering:
  - `buildCsp()` emits a `report-uri /api/csp-report` directive.
  - `buildCsp()` emits a `report-to csp-endpoint` directive.
  - `buildSecurityHeaders()` emits a `Reporting-Endpoints` header naming
    `csp-endpoint` → `/api/csp-report`.
  - `buildSecurityHeaders()` keeps the prior six headers, so the total is
    seven and `headers.test.ts` would still pass after a one-line update.
  - `POST /api/csp-report` accepts a legacy `application/csp-report` body and
    logs the violation under `[csp-violation]`.
  - `POST /api/csp-report` accepts a modern `application/reports+json` body
    (Reporting API array) and logs each violation.
  - `POST /api/csp-report` returns 204 No Content.
  - `POST /api/csp-report` returns 204 even on malformed body — browsers
    cannot retry usefully and we don't want to fill logs with 4xx noise.
- [x] GREEN — add `report-uri` + `report-to` directives in `buildCsp()`,
  add `Reporting-Endpoints` header in `buildSecurityHeaders()`, and create
  `app/api/csp-report/route.ts`.
- [x] Update `__tests__/security/headers.test.ts` to expect seven headers
  (the new `Reporting-Endpoints` entry).
- [x] Add `api/csp-report` to the `proxy.ts` matcher exclusion list and to
  `KNOWN_PUBLIC_ROUTES` in `__tests__/api/proxy-matcher.test.ts` —
  browsers POST CSP reports without cookies; without this exclusion the
  proxy 307s every report to /login and the route never executes (Phase J
  "proxy matcher blind spot" pattern).
- [x] Verify: `pnpm lint && pnpm tsc && pnpm vitest run __tests__/security
  && pnpm build`.
- [ ] Push branch + open PR. Cite the Codex MEDIUM finding, before/after,
  the 2026-05-11 flip dependency, test evidence, sample logged violation.

## Design rationale — `Reporting-Endpoints` over `Report-To`

The `Report-To` HTTP header (Reporting API v0) is deprecated and Chromium
will eventually drop it. The replacement is `Reporting-Endpoints` (v1),
shipped in Chromium 96 and supported by Firefox + Safari Tech Preview. The
syntax is simpler — a structured-fields dictionary mapping a name to a URL
— and Chromium currently accepts both. Picking `Reporting-Endpoints`
avoids leaving deprecated config on the wire when we flip to enforce.

We also keep `report-uri` in the CSP itself because:
- `report-uri` is universally supported back to Chrome 25 / Firefox 23.
- Older browsers ignore `report-to` entirely; without `report-uri` they
  collect nothing during the soak.
- The cost is one extra directive in the policy string — negligible.

Both `report-uri` and `report-to` point at the same endpoint
(`/api/csp-report`) so the route accepts whichever shape arrives.

## Out of scope

- Flipping `Content-Security-Policy-Report-Only` → `Content-Security-Policy`
  in `next.config.ts` — that is the 2026-05-11 follow-up tracked at
  `lib/security/csp.ts:78`.
- Rate limiting the endpoint. CSP reports are first-party-triggered by our
  own pages and the logger write is cheap (stdout). If a violation fires in
  a tight loop we would prefer the data than a silent drop. Revisit if log
  volume becomes a problem during the soak.
- Authentication. Browsers POST CSP reports without cookies; gating would
  drop every report.

## Review

(filled in after PR opens)
