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
import { logger } from "@/lib/logger";

// In production, Inngest's cloud mode requires INNGEST_EVENT_KEY (to send events)
// and INNGEST_SIGNING_KEY (to verify signed webhooks). The SDK only throws when
// you try to send — we want a loud startup signal if they're missing so a bad
// deploy surfaces immediately instead of at the first cron fire.
if (process.env.NODE_ENV === "production") {
  if (!process.env.INNGEST_EVENT_KEY) {
    logger.error('[inngest] INNGEST_EVENT_KEY is not set — cloud event sends will fail');
  }
  if (!process.env.INNGEST_SIGNING_KEY) {
    logger.error('[inngest] INNGEST_SIGNING_KEY is not set — /api/inngest cannot verify signed webhooks');
  }
}

export const inngest = new Inngest({ id: "farmtrack" });
