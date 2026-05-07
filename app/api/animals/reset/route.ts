import { NextResponse } from "next/server";
import { adminWrite } from "@/lib/server/route";
import { revalidateAnimalWrite } from "@/lib/server/revalidate";

export const DELETE = adminWrite({
  revalidate: revalidateAnimalWrite,
  handle: async (ctx) => {
    const { prisma } = ctx;
    await prisma.animal.deleteMany({});
    return NextResponse.json({ success: true });
  },
});
