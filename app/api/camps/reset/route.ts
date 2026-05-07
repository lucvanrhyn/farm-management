import { NextResponse } from "next/server";
import { adminWrite } from "@/lib/server/route";
import { revalidateCampWrite } from "@/lib/server/revalidate";

export const DELETE = adminWrite({
  revalidate: revalidateCampWrite,
  handle: async (ctx) => {
    const { prisma } = ctx;

    // cross-species by design: reset blocks on any active animal (any species).
    const activeAnimals = await prisma.animal.count({
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

    await prisma.camp.deleteMany({});

    return NextResponse.json({ success: true });
  },
});
