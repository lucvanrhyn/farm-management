import { NextRequest, NextResponse } from "next/server";
import { getFarmContextForSlug } from "@/lib/server/farm-context-slug";
import { verifyFreshAdminRole } from "@/lib/auth";
import { revalidateSettingsWrite } from "@/lib/server/revalidate";

function getFarmSlugFromRequest(req: NextRequest): string | null {
  return req.nextUrl.searchParams.get("farmSlug");
}

export async function GET(req: NextRequest) {
  const farmSlug = getFarmSlugFromRequest(req);
  if (!farmSlug) {
    return NextResponse.json({ error: "farmSlug query param required" }, { status: 400 });
  }

  const ctx = await getFarmContextForSlug(farmSlug, req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const settings = await ctx.prisma.farmSettings.findFirst();

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
    // Never return the actual API key — only indicate whether one is configured
    openaiApiKeyConfigured: !!(settings?.openaiApiKey),
    // NVD seller identity
    ownerName: settings?.ownerName ?? "",
    ownerIdNumber: settings?.ownerIdNumber ?? "",
    taxReferenceNumber: settings?.taxReferenceNumber ?? "",
    physicalAddress: settings?.physicalAddress ?? "",
    postalAddress: settings?.postalAddress ?? "",
    contactPhone: settings?.contactPhone ?? "",
    contactEmail: settings?.contactEmail ?? "",
    propertyRegNumber: settings?.propertyRegNumber ?? "",
    aiaIdentificationMark: settings?.aiaIdentificationMark ?? "",
    farmRegion: settings?.farmRegion ?? "",
  });
}

export async function PATCH(req: NextRequest) {
  const farmSlug = getFarmSlugFromRequest(req);
  if (!farmSlug) {
    return NextResponse.json({ error: "farmSlug query param required" }, { status: 400 });
  }

  const ctx = await getFarmContextForSlug(farmSlug, req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { prisma, role, session } = ctx;

  if (role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Defence-in-depth: re-verify against meta-db (fresh role) to close the
  // JWT staleness window where a revoked ADMIN could still mutate settings.
  // See lib/auth.ts::verifyFreshAdminRole for the full rationale.
  const freshOk = await verifyFreshAdminRole(session.user.id, farmSlug);
  if (!freshOk) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
    "defaultRestDays",
    "defaultMaxGrazingDays",
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

  if ("rotationSeasonMode" in body) {
    const mode = body.rotationSeasonMode;
    if (mode !== "auto" && mode !== "growing" && mode !== "dormant") {
      return NextResponse.json(
        { error: "rotationSeasonMode must be one of: auto, growing, dormant" },
        { status: 400 }
      );
    }
  }

  if ("dormantSeasonMultiplier" in body) {
    const m = body.dormantSeasonMultiplier;
    if (typeof m !== "number" || !isFinite(m) || m < 1) {
      return NextResponse.json(
        { error: "dormantSeasonMultiplier must be a finite number ≥ 1" },
        { status: 400 }
      );
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
    defaultRestDays?: number;
    defaultMaxGrazingDays?: number;
    rotationSeasonMode?: "auto" | "growing" | "dormant";
    dormantSeasonMultiplier?: number;
    openaiApiKey?: string | null;
    // NVD seller identity
    ownerName?: string | null;
    ownerIdNumber?: string | null;
    taxReferenceNumber?: string | null;
    physicalAddress?: string | null;
    postalAddress?: string | null;
    contactPhone?: string | null;
    contactEmail?: string | null;
    propertyRegNumber?: string | null;
    aiaIdentificationMark?: string | null;
    farmRegion?: string | null;
    biomeType?: string | null;
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
  if (typeof body.defaultRestDays === "number") {
    updateData.defaultRestDays = Math.round(body.defaultRestDays);
  }
  if (typeof body.defaultMaxGrazingDays === "number") {
    updateData.defaultMaxGrazingDays = Math.round(body.defaultMaxGrazingDays);
  }
  if (
    body.rotationSeasonMode === "auto" ||
    body.rotationSeasonMode === "growing" ||
    body.rotationSeasonMode === "dormant"
  ) {
    updateData.rotationSeasonMode = body.rotationSeasonMode;
  }
  if (typeof body.dormantSeasonMultiplier === "number") {
    updateData.dormantSeasonMultiplier = body.dormantSeasonMultiplier;
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

  // biomeType — validated enum or null
  const BIOMES = new Set(['highveld', 'bushveld', 'lowveld', 'karoo', 'mixedveld']);
  if ('biomeType' in body) {
    if (body.biomeType != null && !BIOMES.has(body.biomeType as string)) {
      return NextResponse.json({ error: 'invalid biomeType' }, { status: 400 });
    }
    updateData.biomeType = (body.biomeType as string | null) ?? null;
  }

  // NVD seller identity — nullable text fields, empty string = clear to null.
  // taxReferenceNumber added for wave/26c (refs #26, audit finding #7) — see
  // lib/server/sars-it3.ts and sars-it3-pdf.ts for the PDF surfacing.
  for (const field of [
    "ownerName",
    "ownerIdNumber",
    "taxReferenceNumber",
    "physicalAddress",
    "postalAddress",
    "contactPhone",
    "contactEmail",
    "propertyRegNumber",
    "farmRegion",
  ] as const) {
    if (field in body) {
      const val = body[field];
      (updateData as Record<string, unknown>)[field] =
        typeof val === "string" && val.trim() ? val.trim() : null;
    }
  }

  // AIA identification mark — Animal Identification Act 6 of 2002 caps the
  // BrandsAIS-issued mark at 3 characters and uppercase-normalises it. We
  // accept any case + whitespace on input, then trim → uppercase → slice 3,
  // matching how DALRRD prints the mark on the registration certificate.
  if ("aiaIdentificationMark" in body) {
    const val = body.aiaIdentificationMark;
    if (typeof val !== "string" || !val.trim()) {
      updateData.aiaIdentificationMark = null;
    } else {
      const normalised = val.trim().toUpperCase().slice(0, 3);
      // Reject anything that contains characters outside the AIA charset
      // (alpha-numeric only, no punctuation/diacritics).
      if (!/^[A-Z0-9]{1,3}$/.test(normalised)) {
        return NextResponse.json(
          { error: "aiaIdentificationMark must be 1-3 alphanumeric characters" },
          { status: 400 }
        );
      }
      updateData.aiaIdentificationMark = normalised;
    }
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
      defaultRestDays: updateData.defaultRestDays ?? 60,
      defaultMaxGrazingDays: updateData.defaultMaxGrazingDays ?? 7,
      rotationSeasonMode: updateData.rotationSeasonMode ?? "auto",
      dormantSeasonMultiplier: updateData.dormantSeasonMultiplier ?? 1.4,
      openaiApiKey: updateData.openaiApiKey ?? null,
    },
  });

  revalidateSettingsWrite(farmSlug);
  // Never return the raw API key — mirror the GET response shape
  return NextResponse.json({
    ...updated,
    openaiApiKey: undefined,
    openaiApiKeyConfigured: !!(updated.openaiApiKey),
  });
}
