// app/api/inngest/route.ts — Phase J1a Inngest serve endpoint.
//
// Inngest's Next.js adapter exposes { GET, POST, PUT } handlers from its
// serve() helper. GET is used by the Inngest dev-server sync; POST receives
// function invocations; PUT is the production registration call.
//
// Cron fallback: per vercel.json, Vercel Cron pokes POST /api/inngest with
// the X-Inngest-Signature header absent — the adapter detects this and runs
// the registered cron function, which means we retain a "even if Inngest
// cloud goes down, Vercel still fires the cron" safety net per the research
// brief §A migration note.

import { serve } from "inngest/next";
import { inngest } from "@/lib/server/inngest/client";
import { ALL_FUNCTIONS } from "@/lib/server/inngest/functions";
import { ALL_TASK_FUNCTIONS } from "@/lib/server/inngest/tasks";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [...ALL_FUNCTIONS, ...ALL_TASK_FUNCTIONS],
});
