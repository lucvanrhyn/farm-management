import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaForSlugWithAuth } from "@/lib/farm-prisma";
import { revalidateAlertWrite } from "@/lib/server/revalidate";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function authorize(params: Promise<{ farmSlug: string }>, requireAdmin = false) {
  const session = await getServerSession(authOptions);
  if (!session) return { error: "Unauthorized", status: 401 } as const;

  const { farmSlug } = await params;
  const db = await getPrismaForSlugWithAuth(session, farmSlug);
  if ("error" in db) return db;

  if (requireAdmin && db.role !== "ADMIN") {
    return { error: "Forbidden", status: 403 } as const;
  }

  return { prisma: db.prisma, farmSlug: db.slug } as const;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string }> },
) {
  const auth = await authorize(params);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { prisma } = auth;

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const campId = searchParams.get("campId");

  const where: Record<string, unknown> = {};
  if (from || to) {
    const dateFilter: Record<string, string> = {};
    if (from) dateFilter.gte = from;
    if (to) dateFilter.lte = to;
    where.date = dateFilter;
  }
  if (campId) {
    where.campId = campId;
  }

  const records = await prisma.rainfallRecord.findMany({
    where,
    orderBy: { date: "desc" },
  });

  // Compute monthly summary for chart
  const monthly = new Map<string, number>();
  for (const r of records) {
    const month = r.date.slice(0, 7);
    monthly.set(month, (monthly.get(month) ?? 0) + r.rainfallMm);
  }
  const monthlySummary = Array.from(monthly.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, totalMm]) => ({
      month,
      totalMm: Math.round(totalMm * 10) / 10,
    }));

  return NextResponse.json({ records, monthlySummary });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string }> },
) {
  const auth = await authorize(params, true);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { prisma, farmSlug } = auth;

  const body = await req.json();
  const { date, rainfallMm, campId, stationName } = body;

  if (!date || !DATE_RE.test(date)) {
    return NextResponse.json(
      { error: "date required (YYYY-MM-DD)" },
      { status: 400 },
    );
  }

  const mm = parseFloat(rainfallMm);
  if (isNaN(mm) || mm < 0) {
    return NextResponse.json(
      { error: "rainfallMm must be a non-negative number" },
      { status: 400 },
    );
  }

  const record = await prisma.rainfallRecord.create({
    data: {
      date,
      rainfallMm: mm,
      campId: campId || null,
      stationName: stationName || null,
    },
  });

  revalidateAlertWrite(farmSlug);
  return NextResponse.json(record, { status: 201 });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ farmSlug: string }> },
) {
  const auth = await authorize(params, true);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { prisma, farmSlug } = auth;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  try {
    await prisma.rainfallRecord.delete({ where: { id } });
  } catch (err) {
    // Differentiate the "not found" case from actual DB failures so the
    // operator sees the real error instead of a misleading 404. Prisma's
    // P2025 is the "record to delete does not exist" code — anything else
    // is a connection / permission / constraint problem worth surfacing.
    const code = (err as { code?: string })?.code;
    if (code === "P2025") {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[rainfall DELETE]", message, err instanceof Error ? err.stack : "");
    return NextResponse.json(
      { error: "Could not delete rainfall record" },
      { status: 500 },
    );
  }

  revalidateAlertWrite(farmSlug);
  return NextResponse.json({ ok: true });
}
