import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth-options";
import { getPrismaForRequest } from "@/lib/farm-prisma";

export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role?.toUpperCase() !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getPrismaForRequest();
  if ("error" in db) return NextResponse.json({ error: db.error }, { status: db.status });
  const { prisma } = db;

  await prisma.observation.deleteMany({});

  revalidatePath("/admin");
  revalidatePath("/admin/observations");
  revalidatePath("/admin/grafieke");

  return NextResponse.json({ success: true });
}
