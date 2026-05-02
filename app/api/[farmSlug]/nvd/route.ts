/**
 * GET  /api/[farmSlug]/nvd  — paginated list of NVDs for this farm
 * POST /api/[farmSlug]/nvd  — issue a new NVD (ADMIN only, rate limited)
 */
import { NextRequest, NextResponse } from "next/server";
import { getFarmContextForSlug } from "@/lib/server/farm-context-slug";
import { verifyFreshAdminRole } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { issueNvd, type NvdTransportDetails } from "@/lib/server/nvd";
import { revalidateObservationWrite } from "@/lib/server/revalidate";

/**
 * Validate `body.transport` per Stock Theft Act 57/1959 §8 — when present,
 * the driver/transporter name AND vehicle reg are mandatory non-empty
 * strings. The whole field is optional (some movements are on-foot), but
 * we never want to persist a half-populated transport object that would
 * embarrass the farmer at a SAPS roadblock.
 *
 * Returns the trimmed `NvdTransportDetails` or null when the field was
 * absent/null. Throws `Error` with a user-facing message on invalid input
 * (the route translates that to a 400 response).
 */
function parseTransport(raw: unknown): NvdTransportDetails | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("transport must be an object with driverName and vehicleRegNumber");
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.driverName !== "string" || obj.driverName.trim().length === 0) {
    throw new Error("transport.driverName is required (non-empty string)");
  }
  if (typeof obj.vehicleRegNumber !== "string" || obj.vehicleRegNumber.trim().length === 0) {
    throw new Error("transport.vehicleRegNumber is required (non-empty string)");
  }
  if (
    obj.vehicleMakeModel !== undefined &&
    obj.vehicleMakeModel !== null &&
    typeof obj.vehicleMakeModel !== "string"
  ) {
    throw new Error("transport.vehicleMakeModel must be a string when provided");
  }

  const transport: NvdTransportDetails = {
    driverName: obj.driverName.trim(),
    vehicleRegNumber: obj.vehicleRegNumber.trim(),
  };
  if (typeof obj.vehicleMakeModel === "string" && obj.vehicleMakeModel.trim().length > 0) {
    transport.vehicleMakeModel = obj.vehicleMakeModel.trim();
  }
  return transport;
}

export const dynamic = "force-dynamic";

// ── GET — list NVDs ───────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string }> }
) {
  const { farmSlug } = await params;
  const ctx = await getFarmContextForSlug(farmSlug, req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { prisma } = ctx;

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

  return NextResponse.json({ records: withCount, total, page, limit: limit });
}

// ── POST — issue NVD ──────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string }> }
) {
  const { farmSlug } = await params;
  const ctx = await getFarmContextForSlug(farmSlug, req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { prisma, role, slug, session } = ctx;
  if (role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Phase H.2: defence-in-depth — re-verify ADMIN against meta-db so a
  // demoted ADMIN can't keep issuing NVDs until their JWT expires.
  if (!(await verifyFreshAdminRole(session.user.id, slug))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Rate limit: 10 NVD issues per 10 minutes per farm
  const rl = checkRateLimit(`nvd-issue:${farmSlug}`, 10, 10 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many NVD requests. Please wait." }, { status: 429 });
  }

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

  // Stock Theft Act §8 — driver + vehicle reg required when conveyed by
  // vehicle. Optional at the route boundary (on-foot is legal); validate
  // shape if present so we never persist a half-populated transport blob.
  let transport: NvdTransportDetails | null;
  try {
    transport = parseTransport(body.transport);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid transport";
    return NextResponse.json({ error: message }, { status: 400 });
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
      ...(transport ? { transport } : {}),
    });

    revalidateObservationWrite(farmSlug);
    return NextResponse.json(record, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to issue NVD";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
