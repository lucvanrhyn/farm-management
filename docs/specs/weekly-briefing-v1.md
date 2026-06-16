# Weekly Farm Briefing v1 — build-ready spec

**Wave:** `wave/weekly-briefing-v1` (off `main`)
**Status:** specced 2026-06-14 (grilling session); build paused pending GitHub access
**Terms:** CONTEXT.md → Farm Briefing. **ADR:** none — additive evolution of the
existing digest mechanism (no surprising/hard-to-reverse architectural fork).

## Why (one line)
Quick win #3 and the weekly retention loop: an AI-narrated "Farm Briefing"
(what changed · what to watch · what to do) that composes the Triage + nudge
features just specced — reinforcing the AI-leader wedge every week.

## What exists already (so this is ~few days–1wk)
- `sendDailyDigest` (J4b): per-tenant, daily, unread-notifications, category
  grouping, `alert-digest` email template, via the Inngest dispatcher.
- Schema: `digestMode` (default `realtime`) + `digestDispatchedAt`.
- `dispatch.ts`: stamp-before-flush idempotency; calls the digest at cadence.

## What ships (the four deltas)
1. **Weekly cadence** — new `digestMode = 'weekly'`; the dispatcher branches on
   mode (realtime / daily / weekly). 7-day lookback. Reuses `digestDispatchedAt`.
2. **Briefing payload** — deterministic aggregator pulling: recent notifications
   + top Attention Items (Triage) + top Recommended Actions (nudges) + key
   changes (weights logged, repro events, deaths/sales via `getDeathsAndSales`,
   veld/rotation status, drought).
3. **AI narration** — Einstein composes the payload into a "Farm Briefing"
   (what changed / watch / do); deterministic templated fallback so a Briefing
   always sends.
4. **Two channels** — upgraded email template + a new in-app **"This week"**
   briefing surface on the dashboard (persists the last Briefing).

## Scope boundaries
- Weekly mode is **additive**: `realtime` and `daily` digests are untouched.
- Narration is rules-aggregate / LLM-narrate (same split as Triage + nudges);
  the payload is the source of truth, the LLM never invents facts.
- In-app briefing shows last-synced content (offline-safe).
- Default cadence for new trials: `weekly` (so the 7-day trial gets a Briefing);
  the in-app "This week" surface is always visible regardless of email mode.

## Reuse leverage
- Dispatcher, `digestMode`, `digestDispatchedAt`, email send path, Einstein,
  and the Triage/nudge payloads all already exist.
- Net-new: the `'weekly'` mode + dispatcher branch, the briefing-payload
  aggregator, Einstein narration + fallback, the briefing email template, the
  in-app "This week" surface, tests.

## Dependencies / sequencing
- Composes **Herd Triage** (#1) and **Nudges** (#2) — best built after both,
  but the payload degrades gracefully if a source is absent (an empty Triage
  section just omits). Build order: Triage → Nudges → Briefing.

## TDD order (when build resumes)
1. briefing-payload aggregator tests (each source → payload section).
2. `digestMode='weekly'` dispatcher branch (cadence + idempotency).
3. narration + templated fallback (Briefing always renders).
4. email template + in-app "This week" surface.
