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

  const activeAnimals = await prisma.animal.count({ where: { status: "Active" } });
  if (activeAnimals > 0) {
    return NextResponse.json(
      { error: `Cannot remove all camps while ${activeAnimals} active animal(s) exist. Clear animals first.` },
      { status: 409 }
    );
  }

  await prisma.camp.deleteMany({});

  revalidatePath("/admin/camps");
  revalidatePath("/admin");
  revalidatePath("/dashboard");

  return NextResponse.json({ success: true });
}
