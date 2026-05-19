import { NextResponse } from "next/server";
import { adminWrite } from "@/lib/server/route";
import { revalidateAnimalWrite } from "@/lib/server/revalidate";
import { crossSpecies } from "@/lib/server/species-scoped-prisma";

export const DELETE = adminWrite({
  revalidate: revalidateAnimalWrite,
  handle: async (ctx) => {
    const { prisma } = ctx;
    await crossSpecies(prisma, "farm-wide-audit").animal.deleteMany({});
    return NextResponse.json({ success: true });
  },
});
