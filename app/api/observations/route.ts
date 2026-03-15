import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const camp = searchParams.get("camp");
  const type = searchParams.get("type");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 200);
  const offset = parseInt(searchParams.get("offset") ?? "0");

  const where: Record<string, unknown> = {};
  if (camp) where.campId = camp;
  if (type) where.type = type;

  try {
    const observations = await prisma.observation.findMany({
      where,
      orderBy: { observedAt: "desc" },
      take: limit,
      skip: offset,
    });
    return NextResponse.json(observations);
  } catch (err) {
    console.error("[observations GET] DB error:", err);
    return NextResponse.json({ error: "Failed to fetch observations" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { type, camp_id, animal_id, details, created_at } = body;

  if (!type || !camp_id) {
    return NextResponse.json(
      { error: "Missing required fields: type and camp_id" },
      { status: 400 }
    );
  }

  const observedAt = created_at ? new Date(created_at) : new Date();
  if (isNaN(observedAt.getTime())) {
    return NextResponse.json(
      { error: "Invalid created_at timestamp" },
      { status: 400 }
    );
  }

  try {
    const record = await prisma.observation.create({
      data: {
        type,
        campId: camp_id,
        animalId: animal_id ?? null,
        details: details ?? "",
        observedAt,
        loggedBy: session.user?.email ?? null,
      },
    });
    return NextResponse.json({ success: true, id: record.id });
  } catch (err) {
    console.error("[observations] DB error:", err);
    return NextResponse.json({ error: "Failed to save observation" }, { status: 500 });
  }
}
