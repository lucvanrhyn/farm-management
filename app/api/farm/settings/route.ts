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

  // Verify the requesting user has access to this specific farm
  const userFarms = (session.user as { farms?: Array<{ slug: string }> }).farms ?? [];
  if (!userFarms.some((f) => f.slug === farmSlug)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
    targetStockingRate: settings?.targetStockingRate ?? null,
    latitude: settings?.latitude ?? null,
    longitude: settings?.longitude ?? null,
    breedingSeasonStart: settings?.breedingSeasonStart ?? null,
    breedingSeasonEnd: settings?.breedingSeasonEnd ?? null,
    weaningDate: settings?.weaningDate ?? null,
    vaccinationCalendarNotes: settings?.vaccinationCalendarNotes ?? null,
    // Never return the actual API key — only indicate whether one is configured
    openaiApiKeyConfigured: !!(settings?.openaiApiKey),
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

  // Verify the requesting user has access to this specific farm
  const userFarms = (session.user as { farms?: Array<{ slug: string }> }).farms ?? [];
  if (!userFarms.some((f) => f.slug === farmSlug)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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

  // Validate required numeric fields are positive numbers when present
  const positiveNumericFields = [
    "alertThresholdHours",
    "adgPoorDoerThreshold",
    "calvingAlertDays",
    "daysOpenLimit",
    "campGrazingWarningDays",
  ] as const;

  for (const field of positiveNumericFields) {
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

  // Validate optional nullable coordinates when present
  for (const field of ["latitude", "longitude"] as const) {
    if (field in body && body[field] !== null) {
      const val = body[field];
      if (typeof val !== "number" || isNaN(val)) {
        return NextResponse.json(
          { error: `${field} must be a number or null` },
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
    targetStockingRate?: number | null;
    latitude?: number | null;
    longitude?: number | null;
    breedingSeasonStart?: string | null;
    breedingSeasonEnd?: string | null;
    weaningDate?: string | null;
    vaccinationCalendarNotes?: string | null;
    openaiApiKey?: string | null;
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
  if ("targetStockingRate" in body) {
    updateData.targetStockingRate =
      typeof body.targetStockingRate === "number" ? body.targetStockingRate : null;
  }
  if ("latitude" in body) {
    updateData.latitude = typeof body.latitude === "number" ? body.latitude : null;
  }
  if ("longitude" in body) {
    updateData.longitude = typeof body.longitude === "number" ? body.longitude : null;
  }
  if ("breedingSeasonStart" in body) {
    updateData.breedingSeasonStart =
      typeof body.breedingSeasonStart === "string" && body.breedingSeasonStart.trim()
        ? body.breedingSeasonStart.trim()
        : null;
  }
  if ("breedingSeasonEnd" in body) {
    updateData.breedingSeasonEnd =
      typeof body.breedingSeasonEnd === "string" && body.breedingSeasonEnd.trim()
        ? body.breedingSeasonEnd.trim()
        : null;
  }
  if ("weaningDate" in body) {
    updateData.weaningDate =
      typeof body.weaningDate === "string" && body.weaningDate.trim()
        ? body.weaningDate.trim()
        : null;
  }
  if ("vaccinationCalendarNotes" in body) {
    updateData.vaccinationCalendarNotes =
      typeof body.vaccinationCalendarNotes === "string"
        ? body.vaccinationCalendarNotes
        : null;
  }
  if ("openaiApiKey" in body) {
    if (body.openaiApiKey === null) {
      // Explicit null = user wants to clear the key
      updateData.openaiApiKey = null;
    } else if (typeof body.openaiApiKey === "string" && body.openaiApiKey.trim()) {
      // Non-empty string = user is setting a new key
      updateData.openaiApiKey = body.openaiApiKey.trim();
    }
    // Empty string = leave existing key unchanged (blank field on form = no change)
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
      targetStockingRate: updateData.targetStockingRate ?? null,
      latitude: updateData.latitude ?? null,
      longitude: updateData.longitude ?? null,
      breedingSeasonStart: updateData.breedingSeasonStart ?? null,
      breedingSeasonEnd: updateData.breedingSeasonEnd ?? null,
      weaningDate: updateData.weaningDate ?? null,
      vaccinationCalendarNotes: updateData.vaccinationCalendarNotes ?? null,
      openaiApiKey: updateData.openaiApiKey ?? null,
    },
  });

  return NextResponse.json(updated);
}
