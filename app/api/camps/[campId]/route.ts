import { NextResponse } from "next/server";
import { adminWrite, RouteValidationError } from "@/lib/server/route";
import { revalidateCampWrite } from "@/lib/server/revalidate";

interface PatchCampBody {
  campName?: string;
  sizeHectares?: number | null;
  waterSource?: string | null;
  geojson?: string | null;
  color?: string | null;
  veldType?: string | null;
  restDaysOverride?: number | null;
  maxGrazingDaysOverride?: number | null;
  rotationNotes?: string | null;
}

const VELD_TYPES = new Set(["sweetveld", "sourveld", "mixedveld", "cultivated"]);

const patchCampSchema = {
  parse(input: unknown): PatchCampBody {
    const body = (input ?? {}) as Record<string, unknown>;
    const errors: Record<string, string> = {};

    if (
      body.color !== undefined &&
      body.color !== null &&
      (typeof body.color !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(body.color))
    ) {
      errors.color = "color must be a valid hex color (e.g. #2563EB)";
    }

    if (
      body.veldType !== undefined &&
      body.veldType !== null &&
      (typeof body.veldType !== "string" || !VELD_TYPES.has(body.veldType))
    ) {
      errors.veldType =
        "veldType must be one of: sweetveld, sourveld, mixedveld, cultivated";
    }

    for (const field of ["restDaysOverride", "maxGrazingDaysOverride"] as const) {
      const val = body[field];
      if (val !== undefined && val !== null) {
        if (
          typeof val !== "number" ||
          !Number.isFinite(val) ||
          val <= 0 ||
          !Number.isInteger(val)
        ) {
          errors[field] = `${field} must be a positive integer or null`;
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      throw new RouteValidationError(
        Object.values(errors)[0] ?? "Invalid body",
        { fieldErrors: errors },
      );
    }
    return body as unknown as PatchCampBody;
  },
};

export const PATCH = adminWrite<PatchCampBody, { campId: string }>({
  schema: patchCampSchema,
  revalidate: revalidateCampWrite,
  handle: async (ctx, body, _req, params) => {
    const { prisma } = ctx;
    const { campId } = params;

    // Phase A of #28: campId is no longer globally unique (composite UNIQUE on
    // species+campId). findFirst is single-species-safe; Phase B will scope by
    // species and use the compound key.
    const camp = await prisma.camp.findFirst({ where: { campId } });
    if (!camp) {
      return NextResponse.json({ error: "Camp not found" }, { status: 404 });
    }

    // Phase A of #28: campId is no longer globally unique. Update via the
    // CUID primary key resolved above; Phase B will switch to the compound
    // key once the API layer carries a `species` discriminator.
    await prisma.camp.update({
      where: { id: camp.id },
      data: {
        ...(body.campName !== undefined && { campName: body.campName }),
        ...(body.sizeHectares !== undefined && { sizeHectares: body.sizeHectares }),
        ...(body.waterSource !== undefined && { waterSource: body.waterSource }),
        ...(body.geojson !== undefined && { geojson: body.geojson }),
        ...(body.color !== undefined && { color: body.color }),
        ...(body.veldType !== undefined && { veldType: body.veldType }),
        ...(body.restDaysOverride !== undefined && {
          restDaysOverride: body.restDaysOverride,
        }),
        ...(body.maxGrazingDaysOverride !== undefined && {
          maxGrazingDaysOverride: body.maxGrazingDaysOverride,
        }),
        ...(body.rotationNotes !== undefined && {
          rotationNotes: body.rotationNotes,
        }),
      },
    });

    return NextResponse.json({ success: true });
  },
});

export const DELETE = adminWrite<unknown, { campId: string }>({
  revalidate: revalidateCampWrite,
  handle: async (ctx, _body, _req, params) => {
    const { prisma } = ctx;
    const { campId } = params;

    // Phase A of #28: campId is no longer globally unique (composite UNIQUE on
    // species+campId). findFirst is single-species-safe; Phase B will scope.
    const camp = await prisma.camp.findFirst({ where: { campId } });
    if (!camp) {
      return NextResponse.json({ error: "Camp not found" }, { status: 404 });
    }

    // cross-species by design: deletion guard must block on any species in camp.
    const activeAnimals = await prisma.animal.count({
      where: { currentCamp: campId, status: "Active" },
    });
    if (activeAnimals > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete camp with ${activeAnimals} active animal(s). Move or remove them first.`,
        },
        { status: 409 },
      );
    }

    // Phase A of #28: delete via the resolved CUID primary key (campId is no
    // longer globally unique). Phase B will switch to the compound key.
    await prisma.camp.delete({ where: { id: camp.id } });

    return NextResponse.json({ success: true });
  },
});
