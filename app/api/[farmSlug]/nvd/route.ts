/**
 * GET  /api/[farmSlug]/nvd  — paginated list of NVDs for this farm
 * POST /api/[farmSlug]/nvd  — issue a new NVD (ADMIN only, rate limited)
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaForSlugWithAuth } from "@/lib/farm-prisma";
import { verifyFreshAdminRole } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { issueNvd } from "@/lib/server/nvd";
import { revalidateObservationWrite } from "@/lib/server/revalidate";

export const dynamic = "force-dynamic";

// ── GET — list NVDs ───────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { farmSlug } = await params;
  const _authGet = await getPrismaForSlugWithAuth(session, farmSlug);
  if ("error" in _authGet) return NextResponse.json({ error: _authGet.error }, { status: _authGet.status });
  const prisma = _authGet.prisma;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = 20;
  const skip = (page - 1) * limit;

  const [records, total] = await Promise.all([
    prisma.nvdRecord.findMany({
      orderBy: { issuedAt: "desc" },
      skip,
      take: limit,
      select: {
        id: true,
        nvdNumber: true,
        issuedAt: true,
        saleDate: true,
        buyerName: true,
        animalIds: true,
        generatedBy: true,
        voidedAt: true,
        voidReason: true,
        transactionId: true,
      },
    }),
    prisma.nvdRecord.count(),
  ]);

  // Compute head count from JSON array without parsing full snapshot
  const withCount = records.map((r) => {
    let headCount = 0;
    try {
      headCount = (JSON.parse(r.animalIds) as string[]).length;
    } catch {
      headCount = 0;
    }
    return { ...r, headCount };
  });

  return NextResponse.json({ records: withCount, total, page, limit });
}

// ── POST — issue NVD ──────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { farmSlug } = await params;
  const _auth = await getPrismaForSlugWithAuth(session, farmSlug);
  if ("error" in _auth) return NextResponse.json({ error: _auth.error }, { status: _auth.status });
  if (_auth.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Phase H.2: defence-in-depth — re-verify ADMIN against meta-db so a
  // demoted ADMIN can't keep issuing NVDs until their JWT expires.
  if (!(await verifyFreshAdminRole(session.user.id, _auth.slug))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Rate limit: 10 NVD issues per 10 minutes per farm
  const rl = checkRateLimit(`nvd-issue:${farmSlug}`, 10, 10 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many NVD requests. Please wait." }, { status: 429 });
  }

  const prisma = _auth.prisma;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate required fields
  const { saleDate, buyerName, animalIds, declarationsJson } = body;

  if (typeof saleDate !== "string" || !saleDate.trim()) {
    return NextResponse.json({ error: "saleDate is required (YYYY-MM-DD)" }, { status: 400 });
  }
  if (typeof buyerName !== "string" || !buyerName.trim()) {
    return NextResponse.json({ error: "buyerName is required" }, { status: 400 });
  }
  if (!Array.isArray(animalIds) || animalIds.length === 0) {
    return NextResponse.json({ error: "animalIds must be a non-empty array" }, { status: 400 });
  }
  if (typeof declarationsJson !== "string") {
    return NextResponse.json({ error: "declarationsJson is required" }, { status: 400 });
  }

  try {
    const record = await issueNvd(prisma, {
      saleDate: saleDate.trim(),
      buyerName: buyerName.trim(),
      buyerAddress: typeof body.buyerAddress === "string" ? body.buyerAddress.trim() : undefined,
      buyerContact: typeof body.buyerContact === "string" ? body.buyerContact.trim() : undefined,
      destinationAddress: typeof body.destinationAddress === "string" ? body.destinationAddress.trim() : undefined,
      animalIds: animalIds as string[],
      declarationsJson,
      generatedBy: session.user?.email ?? undefined,
      transactionId: typeof body.transactionId === "string" ? body.transactionId : undefined,
    });

    revalidateObservationWrite(farmSlug);
    return NextResponse.json(record, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to issue NVD";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
