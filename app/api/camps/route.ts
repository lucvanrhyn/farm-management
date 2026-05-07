import { NextResponse } from "next/server";
import { tenantRead, adminWrite, RouteValidationError } from "@/lib/server/route";
import { revalidateCampWrite } from "@/lib/server/revalidate";
import { getCachedCampList } from "@/lib/server/cached";
import { CAMP_COLOR_PALETTE } from "@/lib/camp-colors";
import { timeAsync } from "@/lib/server/server-timing";

interface CreateCampBody {
  campId: string;
  campName: string;
  sizeHectares?: number | string | null;
  waterSource?: string | null;
  geojson?: string | null;
  color?: string | null;
}

const createCampSchema = {
  parse(input: unknown): CreateCampBody {
    const body = (input ?? {}) as Record<string, unknown>;
    const errors: Record<string, string> = {};
    if (typeof body.campId !== "string" || !body.campId) {
      errors.campId = "campId is required";
    }
    if (typeof body.campName !== "string" || !body.campName) {
      errors.campName = "campName is required";
    }
    if (
      body.color !== undefined &&
      body.color !== null &&
      (typeof body.color !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(body.color))
    ) {
      errors.color = "color must be a valid hex color (e.g. #2563EB)";
    }
    if (Object.keys(errors).length > 0) {
      throw new RouteValidationError(
        Object.values(errors)[0] ?? "Invalid body",
        { fieldErrors: errors },
      );
    }
    return body as unknown as CreateCampBody;
  },
};

export const GET = tenantRead({
  handle: async (ctx, req) => {
    const { searchParams } = new URL(req.url);
    const species = searchParams.get("species") ?? undefined;
    const result = await timeAsync("query", () =>
      getCachedCampList(ctx.slug, species),
    );
    return NextResponse.json(result);
  },
});

export const POST = adminWrite<CreateCampBody>({
  schema: createCampSchema,
  revalidate: revalidateCampWrite,
  handle: async (ctx, body) => {
    const { prisma } = ctx;
    const { campId, campName, sizeHectares, waterSource, geojson, color } = body;

    // Phase A of #28: campId is no longer globally unique (composite UNIQUE on
    // species+campId). findFirst preserves the single-species duplicate-block
    // semantics; Phase D wires the species-aware compound key + typed
    // `DUPLICATE_CAMP_ID_FOR_SPECIES` error.
    const existing = await prisma.camp.findFirst({ where: { campId } });
    if (existing) {
      return NextResponse.json(
        { error: "A camp with this ID already exists" },
        { status: 409 },
      );
    }

    // Auto-assign a color from the palette if not provided.
    let assignedColor = color as string | undefined | null;
    if (!assignedColor) {
      const campCount = await prisma.camp.count();
      assignedColor = CAMP_COLOR_PALETTE[campCount % CAMP_COLOR_PALETTE.length];
    }

    const camp = await prisma.camp.create({
      data: {
        campId,
        campName,
        sizeHectares: sizeHectares ? Number(sizeHectares) : null,
        waterSource: waterSource || null,
        geojson: geojson || null,
        color: assignedColor ?? null,
      },
    });

    // Return snake_case to match the GET /api/camps response shape.
    return NextResponse.json(
      {
        camp_id: camp.campId,
        camp_name: camp.campName,
        size_hectares: camp.sizeHectares,
        water_source: camp.waterSource,
        geojson: camp.geojson,
        color: camp.color,
        animal_count: 0,
      },
      { status: 201 },
    );
  },
});
