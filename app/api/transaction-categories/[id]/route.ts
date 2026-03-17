import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const category = await prisma.transactionCategory.findUnique({
    where: { id },
  });

  if (!category) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (category.isDefault) {
    return NextResponse.json(
      { error: "Verstekategorieë kan nie geskrap word nie" },
      { status: 400 }
    );
  }

  await prisma.transactionCategory.delete({ where: { id } });
  revalidatePath('/admin/finansies');
  return NextResponse.json({ ok: true });
}
