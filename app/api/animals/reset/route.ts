import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prisma.animal.deleteMany({});

  revalidatePath("/admin");
  revalidatePath("/admin/animals");
  revalidatePath("/admin/grafieke");
  revalidatePath("/dashboard");

  return NextResponse.json({ success: true });
}
