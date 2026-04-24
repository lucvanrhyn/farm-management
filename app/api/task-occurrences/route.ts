/**
 * GET /api/task-occurrences
 *
 * Returns TaskOccurrence rows joined to their parent Task, scoped to the active
 * tenant. Ordered by occurrenceAt ASC.
 *
 * Query params:
 *   from  - ISO datetime string (default: start of today UTC)
 *   to    - ISO datetime string (default: end of today UTC + 1 day)
 *
 * Error codes:
 *   MISSING_SESSION — no valid session
 */

import { NextRequest, NextResponse } from "next/server";
import { getFarmContext } from "@/lib/server/farm-context";

export async function GET(req: NextRequest) {
  const ctx = await getFarmContext(req);
  if (!ctx) {
    return NextResponse.json(
      { error: "Unauthorized", code: "MISSING_SESSION" },
      { status: 401 },
    );
  }
  const { prisma } = ctx;

  const { searchParams } = new URL(req.url);

  // Default: today UTC (midnight to midnight+1d)
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");

  const from = fromParam ? new Date(fromParam) : todayStart;
  const to = toParam ? new Date(toParam) : todayEnd;

  const occurrences = await prisma.taskOccurrence.findMany({
    where: {
      occurrenceAt: {
        gte: from,
        lte: to,
      },
    },
    include: {
      task: true,
    },
    orderBy: { occurrenceAt: "asc" },
  });

  return NextResponse.json(occurrences);
}
