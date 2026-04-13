/**
 * GET /api/[farmSlug]/tax/it3/preview?taxYear=YYYY
 *
 * Non-persisting preview of the IT3 payload for a tax year. Used by the issue
 * form so the farmer can inspect totals before committing a snapshot.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaForSlugWithAuth } from "@/lib/farm-prisma";
import { getFarmCreds } from "@/lib/meta-db";
import { getIt3Payload } from "@/lib/server/sars-it3";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { farmSlug } = await params;
  const _auth = await getPrismaForSlugWithAuth(session, farmSlug);
  if ("error" in _auth) return NextResponse.json({ error: _auth.error }, { status: _auth.status });

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

  const payload = await getIt3Payload(_auth.prisma, taxYear, session.user?.email ?? null);
  return NextResponse.json(payload);
}
