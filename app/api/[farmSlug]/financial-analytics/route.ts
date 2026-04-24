import { NextRequest, NextResponse } from "next/server";
import { getFarmContextForSlug } from "@/lib/server/farm-context-slug";
import { getFinancialAnalytics } from "@/lib/server/financial-analytics";
import { getFarmCreds } from "@/lib/meta-db";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string }> },
) {
  const { farmSlug } = await params;
  const ctx = await getFarmContextForSlug(farmSlug, req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Tier must be read live from meta DB — session JWT is cached at login
  // and would lie about recently-upgraded farms until the user re-logs in.
  const creds = await getFarmCreds(farmSlug);
  if (!creds) return NextResponse.json({ error: "Farm not found" }, { status: 404 });
  if (creds.tier === "basic") {
    return NextResponse.json({ error: "Advanced plan required" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");

  const to = toParam ? new Date(toParam) : new Date();
  const from = fromParam ? new Date(fromParam) : new Date(0); // epoch = all-time

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return NextResponse.json({ error: "Invalid date params" }, { status: 400 });
  }

  const result = await getFinancialAnalytics(ctx.prisma, from, to);
  return NextResponse.json(result);
}
