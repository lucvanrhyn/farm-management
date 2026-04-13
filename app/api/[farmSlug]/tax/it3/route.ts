/**
 * GET  /api/[farmSlug]/tax/it3  — paginated list of issued IT3 snapshots
 * POST /api/[farmSlug]/tax/it3  — issue a new snapshot (ADMIN only, rate limited)
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaForSlugWithAuth } from "@/lib/farm-prisma";
import { getFarmCreds } from "@/lib/meta-db";
import { checkRateLimit } from "@/lib/rate-limit";
import { issueIt3Snapshot } from "@/lib/server/sars-it3";

export const dynamic = "force-dynamic";

// ── GET — list issued snapshots ───────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { farmSlug } = await params;
  const _auth = await getPrismaForSlugWithAuth(session, farmSlug);
  if ("error" in _auth) return NextResponse.json({ error: _auth.error }, { status: _auth.status });
  const prisma = _auth.prisma;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = 20;
  const skip = (page - 1) * limit;

  const [records, total] = await Promise.all([
    prisma.it3Snapshot.findMany({
      orderBy: { issuedAt: "desc" },
      skip,
      take: limit,
      select: {
        id: true,
        taxYear: true,
        issuedAt: true,
        periodStart: true,
        periodEnd: true,
        generatedBy: true,
        voidedAt: true,
        voidReason: true,
      },
    }),
    prisma.it3Snapshot.count(),
  ]);

  return NextResponse.json({ records, total, page, limit });
}

// ── POST — issue a new snapshot ───────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { farmSlug } = await params;
  const _auth = await getPrismaForSlugWithAuth(session, farmSlug);
  if ("error" in _auth) return NextResponse.json({ error: _auth.error }, { status: _auth.status });
  if (_auth.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Tier gate: advanced+ only
  const creds = await getFarmCreds(farmSlug);
  if (!creds || creds.tier !== "advanced") {
    return NextResponse.json(
      { error: "SARS IT3 Tax Export requires an Advanced subscription." },
      { status: 403 },
    );
  }

  // Rate limit: 5 IT3 issues per 10 minutes per farm (heavy aggregation)
  const rl = checkRateLimit(`it3-issue:${farmSlug}`, 5, 10 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many IT3 export requests. Please wait." },
      { status: 429 },
    );
  }

  const prisma = _auth.prisma;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const taxYearRaw = body.taxYear;
  const taxYear = typeof taxYearRaw === "number"
    ? taxYearRaw
    : typeof taxYearRaw === "string"
      ? parseInt(taxYearRaw, 10)
      : NaN;
  if (!Number.isFinite(taxYear) || taxYear < 2000 || taxYear > 2100) {
    return NextResponse.json(
      { error: "taxYear must be a number between 2000 and 2100" },
      { status: 400 },
    );
  }

  try {
    const record = await issueIt3Snapshot(prisma, {
      taxYear,
      generatedBy: session.user?.email ?? null,
    });
    return NextResponse.json(record, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to issue IT3 snapshot";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
