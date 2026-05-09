import { NextResponse, type NextRequest } from "next/server";
import { getMetaClient } from "@/lib/meta-db";
import { logger } from "@/lib/logger";
import { publicHandler } from "@/lib/server/route";

// Allowlist matches the web-vitals library's metric names. Any other
// value is rejected — prevents arbitrary keys from polluting the table.
const METRIC_NAMES = new Set(["CLS", "FCP", "INP", "LCP", "TTFB", "FID"]);
const RATINGS = new Set(["good", "needs-improvement", "poor"]);

const MAX_VALUE = 120_000; // 2 minutes of TTFB is already absurd
const MAX_ROUTE_LEN = 256;
const MAX_UA_LEN = 256;

export const POST = publicHandler({
  handle: async (req: NextRequest) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid json" }, { status: 400 });
    }

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }

    const {
      id,
      name,
      value,
      rating,
      delta,
      navigationType,
      route,
    } = body as Record<string, unknown>;

    if (typeof id !== "string" || id.length === 0 || id.length > 128) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    if (typeof name !== "string" || !METRIC_NAMES.has(name)) {
      return NextResponse.json({ error: "invalid name" }, { status: 400 });
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_VALUE) {
      return NextResponse.json({ error: "invalid value" }, { status: 400 });
    }
    if (typeof rating !== "string" || !RATINGS.has(rating)) {
      return NextResponse.json({ error: "invalid rating" }, { status: 400 });
    }

    const safeRoute =
      typeof route === "string" ? route.slice(0, MAX_ROUTE_LEN) : "";
    const safeNav =
      typeof navigationType === "string" ? navigationType.slice(0, 32) : "";
    const safeDelta =
      typeof delta === "number" && Number.isFinite(delta) ? delta : 0;
    const ua = (req.headers.get("user-agent") ?? "").slice(0, MAX_UA_LEN);

    // Fire-and-forget write. Telemetry should never block or fail user flows,
    // so we never throw; the `try` isolates libSQL errors from the client.
    try {
      const client = getMetaClient();
      await client.execute({
        sql: `INSERT INTO vitals_events
                (id, metric_name, value, rating, delta, navigation_type, route, user_agent, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        args: [id, name, value, rating, safeDelta, safeNav, safeRoute, ua],
      });
    } catch (err) {
      logger.warn('[telemetry/vitals] write failed', err);
    }

    return NextResponse.json({ ok: true }, { status: 202 });
  },
});
