import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

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
      },
    });
    return NextResponse.json({ success: true, id: record.id });
  } catch (err) {
    console.error("[observations] DB error:", err);
    return NextResponse.json({ error: "Failed to save observation" }, { status: 500 });
  }
}
