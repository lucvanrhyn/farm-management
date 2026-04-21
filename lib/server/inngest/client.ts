// lib/server/inngest/client.ts — Phase J Inngest client
//
// Single shared Inngest client for the FarmTrack backend. Per the guardrails in
// the J1a brief, this is the ONLY place the Inngest client is instantiated —
// every function and route handler imports from here so we don't accidentally
// construct multiple clients at module scope across the tree.
//
// Event key / signing key are picked up automatically from INNGEST_EVENT_KEY
// and INNGEST_SIGNING_KEY env vars at send-time by the SDK. Missing vars are
// OK in local dev (the SDK targets the Inngest dev server at 127.0.0.1:8288).

import { Inngest } from "inngest";

// In production, Inngest's cloud mode requires INNGEST_EVENT_KEY (to send events)
// and INNGEST_SIGNING_KEY (to verify signed webhooks). The SDK only throws when
// you try to send — we fail-fast at module load time so a bad deploy surfaces
// immediately. Missing INNGEST_SIGNING_KEY would otherwise allow unsigned POSTs
// to /api/inngest to execute functions, which is a real webhook-signature bypass.
//
// Guarded by SKIP_INNGEST_STARTUP_CHECK so one-off scripts (migrations, seeds)
// that load server modules in a production-like env but don't serve webhooks
// can still run. The app runtime never sets this flag.
//
// Also skipped during `next build` (NEXT_PHASE === 'phase-production-build')
// because Next.js collects page data in production mode before the runtime
// env has been wired up on the host — failing here would break the build.
if (
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PHASE !== "phase-production-build" &&
  process.env.SKIP_INNGEST_STARTUP_CHECK !== "1"
) {
  if (!process.env.INNGEST_EVENT_KEY) {
    throw new Error(
      "[inngest] INNGEST_EVENT_KEY is not set in production — refusing to start, cloud event sends will silently fail",
    );
  }
  if (!process.env.INNGEST_SIGNING_KEY) {
    throw new Error(
      "[inngest] INNGEST_SIGNING_KEY is not set in production — refusing to start, /api/inngest cannot verify webhook signatures",
    );
  }
}

export const inngest = new Inngest({ id: "farmtrack" });
