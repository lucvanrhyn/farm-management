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
//
// Wave H4 (#176) — wrapped in `publicHandler` per ADR-0001 8/8 part 4. The
// adapter adds Server-Timing instrumentation + a typed-error fallback if the
// Inngest serve handler throws; signature verification + cron fallback stay
// inside the framework-managed handler verbatim.

import { serve } from "inngest/next";
import { inngest } from "@/lib/server/inngest/client";
import { ALL_FUNCTIONS } from "@/lib/server/inngest/functions";
import { ALL_TASK_FUNCTIONS } from "@/lib/server/inngest/tasks";
import { ALL_EINSTEIN_FUNCTIONS } from "@/lib/server/inngest/einstein";
import { publicHandler } from "@/lib/server/route";

const inngestHandlers = serve({
  client: inngest,
  functions: [
    ...ALL_FUNCTIONS,
    ...ALL_TASK_FUNCTIONS,
    ...ALL_EINSTEIN_FUNCTIONS,
  ],
});

// Inngest's `RequestHandler` is `(req: NextRequest, res: unknown) => Promise<Response>`
// — the second arg is intentionally `unknown` because Next.js's signature varies
// across major versions (12 = NextApiResponse, 13/14 = omitted, 15+ = RouteContext).
// publicHandler awaits `ctx.params` and forwards the resolved object as the second
// arg; Inngest's adapter ignores it under Next 16 (it reads everything from `req`).
export const GET = publicHandler({
  handle: async (req, params) => inngestHandlers.GET(req, params),
});

export const POST = publicHandler({
  handle: async (req, params) => inngestHandlers.POST(req, params),
});

export const PUT = publicHandler({
  handle: async (req, params) => inngestHandlers.PUT(req, params),
});
