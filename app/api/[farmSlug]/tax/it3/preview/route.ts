/**
 * GET /api/[farmSlug]/tax/it3/preview?taxYear=YYYY
 *
 * Non-persisting preview of the IT3 payload for a tax year. Used by the issue
 * form so the farmer can inspect totals before committing a snapshot.
 */
import { NextRequest, NextResponse } from "next/server";
import { getFarmContextForSlug } from "@/lib/server/farm-context-slug";
import { getFarmCreds } from "@/lib/meta-db";
import { getIt3Payload } from "@/lib/server/sars-it3";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string }> },
) {
  const { farmSlug } = await params;
  const ctx = await getFarmContextForSlug(farmSlug, req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const creds = await getFarmCreds(farmSlug);
  if (!creds || creds.tier !== "advanced") {
    return NextResponse.json(
      { error: "SARS IT3 Tax Export requires an Advanced subscription." },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(req.url);
  const taxYearRaw = searchParams.get("taxYear");
  const taxYear = taxYearRaw ? parseInt(taxYearRaw, 10) : NaN;
  if (!Number.isFinite(taxYear) || taxYear < 2000 || taxYear > 2100) {
    return NextResponse.json(
      { error: "taxYear query parameter must be a number between 2000 and 2100" },
      { status: 400 },
    );
  }

  const payload = await getIt3Payload(ctx.prisma, taxYear, ctx.session.user?.email ?? null);
  return NextResponse.json(payload);
}
