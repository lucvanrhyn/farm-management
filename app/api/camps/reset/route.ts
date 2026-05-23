import { NextResponse } from "next/server";
import { adminWrite } from "@/lib/server/route";
import { revalidateCampWrite } from "@/lib/server/revalidate";
import { crossSpecies } from "@/lib/server/species-scoped-prisma";

export const DELETE = adminWrite({
  revalidate: revalidateCampWrite,
  handle: async (ctx) => {
    const { prisma } = ctx;

    // cross-species by design: reset blocks on any active animal (any species).
    const activeAnimals = await crossSpecies(prisma, "farm-wide-audit").animal.count({
      where: { status: "Active" },
    });
    if (activeAnimals > 0) {
      return NextResponse.json(
        {
          error: `Cannot remove all camps while ${activeAnimals} active animal(s) exist. Clear animals first.`,
        },
        { status: 409 },
      );
    }

    await crossSpecies(prisma, "farm-wide-audit").camp.deleteMany({});

    return NextResponse.json({ success: true });
  },
});
