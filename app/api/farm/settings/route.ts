import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaForFarm } from "@/lib/farm-prisma";

function getFarmSlugFromRequest(req: NextRequest): string | null {
  return req.nextUrl.searchParams.get("farmSlug");
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const farmSlug = getFarmSlugFromRequest(req);
  if (!farmSlug) {
    return NextResponse.json({ error: "farmSlug query param required" }, { status: 400 });
  }

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) {
    return NextResponse.json({ error: "Farm not found" }, { status: 404 });
  }

  const settings = await prisma.farmSettings.findFirst();

  return NextResponse.json({
    farmName: settings?.farmName ?? "My Farm",
    breed: settings?.breed ?? "Mixed",
    alertThresholdHours: settings?.alertThresholdHours ?? 48,
    adgPoorDoerThreshold: settings?.adgPoorDoerThreshold ?? 0.7,
    calvingAlertDays: settings?.calvingAlertDays ?? 14,
    daysOpenLimit: settings?.daysOpenLimit ?? 365,
    campGrazingWarningDays: settings?.campGrazingWarningDays ?? 7,
  });
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const farmSlug = getFarmSlugFromRequest(req);
  if (!farmSlug) {
    return NextResponse.json({ error: "farmSlug query param required" }, { status: 400 });
  }

  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) {
    return NextResponse.json({ error: "Farm not found" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate numeric fields are positive numbers when present
  const numericFields = [
    "alertThresholdHours",
    "adgPoorDoerThreshold",
    "calvingAlertDays",
    "daysOpenLimit",
    "campGrazingWarningDays",
  ] as const;

  for (const field of numericFields) {
    if (field in body) {
      const val = body[field];
      if (typeof val !== "number" || isNaN(val) || val <= 0) {
        return NextResponse.json(
          { error: `${field} must be a positive number` },
          { status: 400 }
        );
      }
    }
  }

  const updateData: {
    farmName?: string;
    breed?: string;
    alertThresholdHours?: number;
    adgPoorDoerThreshold?: number;
    calvingAlertDays?: number;
    daysOpenLimit?: number;
    campGrazingWarningDays?: number;
  } = {};

  if (typeof body.farmName === "string" && body.farmName.trim()) {
    updateData.farmName = body.farmName.trim();
  }
  if (typeof body.breed === "string" && body.breed.trim()) {
    updateData.breed = body.breed.trim();
  }
  if (typeof body.alertThresholdHours === "number") {
    updateData.alertThresholdHours = Math.round(body.alertThresholdHours);
  }
  if (typeof body.adgPoorDoerThreshold === "number") {
    updateData.adgPoorDoerThreshold = body.adgPoorDoerThreshold;
  }
  if (typeof body.calvingAlertDays === "number") {
    updateData.calvingAlertDays = Math.round(body.calvingAlertDays);
  }
  if (typeof body.daysOpenLimit === "number") {
    updateData.daysOpenLimit = Math.round(body.daysOpenLimit);
  }
  if (typeof body.campGrazingWarningDays === "number") {
    updateData.campGrazingWarningDays = Math.round(body.campGrazingWarningDays);
  }

  const updated = await prisma.farmSettings.upsert({
    where: { id: "singleton" },
    update: updateData,
    create: {
      id: "singleton",
      farmName: updateData.farmName ?? "My Farm",
      breed: updateData.breed ?? "Mixed",
      alertThresholdHours: updateData.alertThresholdHours ?? 48,
      adgPoorDoerThreshold: updateData.adgPoorDoerThreshold ?? 0.7,
      calvingAlertDays: updateData.calvingAlertDays ?? 14,
      daysOpenLimit: updateData.daysOpenLimit ?? 365,
      campGrazingWarningDays: updateData.campGrazingWarningDays ?? 7,
    },
  });

  return NextResponse.json(updated);
}
