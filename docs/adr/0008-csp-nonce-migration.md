# CSP nonce migration + `unsafe-eval`/`unsafe-inline` removal — soak-gated wave; a Report-Only candidate ships first

**Status:** Accepted (2026-06-13) — **Phase 0 (additive Report-Only candidate) ships in this PR**; the enforced-policy changes (Phases 2–3) are DEFERRED and require an explicit Luc prod sign-off per the auth-surface rule. Recorded as the closure of the `auth-L1` stress-test residual.

> Phase 0 changes no enforced policy and no auth/payment wire shape — it only
> adds a parallel, browser-advisory `Content-Security-Policy-Report-Only`
> header. Phases 1–3 (token removals + nonces) are design-only here and must
> not ship without the soak gate below and a real-browser pass.

## Context

The Content-Security-Policy is **enforced** (header key `Content-Security-Policy`, not Report-Only) since 2026-05-11, and it is emitted **statically**:

```
next.config.ts:34-41  async headers() → { source: "/:path*", headers: buildSecurityHeaders() }
lib/security/csp.ts   buildSecurityHeaders() → buildCsp()  (a zero-arg pure function → one constant string)
```

`script-src` carries `'self' 'unsafe-inline' 'unsafe-eval'`; `style-src` carries `'unsafe-inline'`. `lib/security/csp.ts` (notes block + the `Future refactor` comment) has long tracked the removal of these tokens as a **separate** wave and explicitly warns: *"do NOT bundle into the header-key flip."* This ADR is that wave's design + its safe first step.

### Why this cannot be a blind token edit

1. **Nonces are structurally impossible in the current wiring.** A nonce must be generated **per request** and injected into **every** emitted `<script>` / `<style>` tag. A static `next.config.ts` `headers()` rule produces one constant header for all responses — a "nonce" there would be a constant, which defeats the entire mechanism. Doing it properly requires: (a) moving CSP emission into per-request middleware (`proxy.ts`), (b) **reworking the proxy matcher** (`proxy.ts:439`), which today excludes `login|register|verify-email|subscribe|api/auth|...|_next/static|_next/image|*.png|*.jpg|...` — i.e. several auth pages and all `_next` assets, the exact place Next 16's inline bootstrap lives — and (c) **forcing dynamic rendering** on those routes so the nonce can be threaded into the document (read via `headers()` in a root server component). That is a multi-file architectural change with a real perf cost (loss of static optimization), not a token edit.

   > Correction vs the initial analysis: the matcher excludes `login`, `register`, `verify-email`, `subscribe`, `api/auth` — it does **not** exclude `reset-password` / `forgot-password`, which already pass through the proxy. Only `login`/`register`/`verify-email` need adding to matcher coverage in Phase 3. The proxy already returns a real `NextResponse` on every branch, so emitting a per-request **header** is feasible there today; the hard part is threading the nonce into the rendered tags (forced dynamic render), not header emission.

2. **A blind drop can only be validated at runtime, and our safety net is blind to the failure mode.** Removing `'unsafe-eval'` / `'unsafe-inline'` from the enforced policy is verifiable only in a real browser: a CSP violation does **not** throw a 500 — the browser silently refuses to run the offending script, producing a white-screen / failed hydration. The prod auto-rollback smoke hits `/api/health` (a JSON route that runs no client JS and is itself matcher-excluded), so it returns `200` while every interactive page could be dead. There is **no runnable local env** (`.env.example` only). And the tokens are plausibly load-bearing — Next 16's inline webpack bootstrap, the React 19 hydration shim (`new Function`, cited in `csp.ts`), Tailwind + 5 `next/font` faces (`app/layout.tsx`), `mapbox-gl` / `mapbox-gl-draw` (`components/map/*`), and the Serwist service worker (`app/sw.ts`). This is the **auth surface** — a hydration break = users locked out of login.

3. **The prior "clean soak" is weaker evidence than it looks.** Code comments cite a clean Report-Only soak 2026-04-27 → 2026-05-11, but the `/api/csp-report` sink was only added 2026-05-02 (Wave 4 A8) — for the first ~5 days of that window browsers had nowhere to POST violations. So the historical precedent is not fully trustworthy; each token removal here re-runs a *properly-instrumented* soak rather than leaning on it.

## Decision

**Defer** the nonce migration and any change to the **enforced** CSP. Do **not** drop `'unsafe-eval'` / `'unsafe-inline'` from the live policy in a blind change. Ship only the safe additive first phase now: a parallel `Content-Security-Policy-Report-Only` header carrying a **stricter candidate** (`script-src` minus `'unsafe-eval'`), soaked through the existing `/api/csp-report` sink. Promote a candidate to enforce mode only after a clean, properly-instrumented Report-Only soak verified in a real browser across the auth surface.

## Consequences

**Positive.** The enforced policy stays stable (no white-screen / lockout risk on login). The additive candidate generates real violation telemetry via the already-wired sink with zero blocking. The eventual tightening is data-driven, not blind. No auth/payment wire shape changes; no migration.

**Costs.** `'unsafe-inline'` + `'unsafe-eval'` remain in the enforced `script-src`/`style-src` in the interim, so the CSP's XSS mitigation is weaker than a nonce-based policy until the wave completes. The full wave is multi-file (`csp.ts` + `next.config.ts`/`proxy.ts` + matcher + dynamic-rendering audit + every inline-emission point) and cannot be verified by the CI gate alone — it needs a browser pass and a soak window.

**Risk if rushed.** Dropping a token blind = a silent prod lockout the auto-rollback smoke cannot catch.

## Implementation plan

- **Phase 0 — SAFE, ships in this PR.** `buildCspCandidate()` in `lib/security/csp.ts` returns `buildCsp()` with `'unsafe-eval'` removed from `script-src` (keeps `'unsafe-inline'` this round). `buildSecurityHeaders()` appends an 8th header `{ key: "Content-Security-Policy-Report-Only", value: buildCspCandidate() }` **alongside** the unchanged enforced CSP. `__tests__/security/headers.test.ts` pins 8 headers + asserts the candidate lacks `'unsafe-eval'` while the enforced policy still has it. `report-uri`/`report-to` + `Reporting-Endpoints` already exist. Changes no wire shape, no migration.
- **Phase 1 — SOAK.** Leave the Report-Only candidate live ≥ 14 days; monitor `/api/csp-report` for `script-src`/`eval` blocked-URI reports from mapbox, the SW, and hydration. If log volume becomes a problem, add the in-memory dedupe keyed on `(documentUri, blockedUri, violatedDirective)` already suggested in `app/api/csp-report/route.ts`.
- **Phase 2 — if clean, drop `'unsafe-eval'` from the ENFORCED policy** in a dedicated PR with **explicit Luc prod sign-off** + a real-browser smoke across login / register / verify-email / reset-password / map / dashboard / PWA. (The `/api/health` probe is blind to CSP breaks — a human/Playwright visual check is mandatory.) Optionally soak dropping `style-src`'s `'unsafe-inline'` concurrently via the same candidate (separable axis: Tailwind + `next/font`).
- **Phase 3 — nonces (the hard part).** Add a per-request nonce generator in middleware; move CSP emission out of static `next.config.ts headers()` into `proxy.ts` so it can interpolate `'nonce-<value>'` per response; expand the proxy matcher so it also runs on `login`/`register`/`verify-email` (today excluded) without breaking the unauth-redirect / signed-`x-farm-slug` logic; thread the nonce into the rendered document (forces those routes to dynamic rendering); then remove `'unsafe-inline'` from `script-src` (and later `style-src` once Tailwind/`next/font` inline styles are nonce'd or hashed). Each token removal re-soaks via the Phase-0 mechanism before enforce.

## Soak gate (binding for every enforce-mode tightening)

For each candidate change (drop `unsafe-eval`; later drop `unsafe-inline`; later add nonce + drop the remaining `unsafe-*`): ship it FIRST as `Content-Security-Policy-Report-Only` alongside the still-enforced policy, run ≥ 14 days, and require **zero** production-impacting violation reports at `/api/csp-report` (filter extension/noise) **AND** a green real-browser pass (Playwright or manual) across login, register, reset-password, the mapbox map page, the dashboard weather widget, and the installed PWA service-worker path. Only after that clean window may the candidate replace the enforced `buildCsp()` — and that enforce-flip PR needs explicit prod sign-off because it touches the auth surface, with the explicit understanding that the `/api/health` auto-rollback smoke **cannot** detect a CSP white-screen and is not a substitute for the browser check.
