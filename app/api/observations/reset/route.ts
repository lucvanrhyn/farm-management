import { NextRequest, NextResponse } from "next/server";
import { getFarmContext } from "@/lib/server/farm-context";
import { verifyFreshAdminRole } from "@/lib/auth";
import { revalidateObservationWrite } from "@/lib/server/revalidate";

export async function DELETE(request: NextRequest) {
  const ctx = await getFarmContext(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { prisma, role, session, slug } = ctx;
  if (role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await verifyFreshAdminRole(session.user.id, slug))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.observation.deleteMany({});

  revalidateObservationWrite(slug);

  return NextResponse.json({ success: true });
}
