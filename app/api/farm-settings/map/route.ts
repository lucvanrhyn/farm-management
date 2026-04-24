/**
 * GET /api/farm-settings/map — read the current map settings JSON blob
 * PUT /api/farm-settings/map — persist map GIS settings (eskomAreaId, etc.)
 *
 * Backed by `FarmSettings.mapSettings` (String? JSON) on the active tenant.
 *
 * Body (PUT):
 *   {
 *     eskomAreaId?: string | null   // EskomSePush area id; null to clear
 *   }
 *
 * Error codes:
 *   MISSING_ADMIN_SESSION — no valid session
 *   FORBIDDEN              — session exists but user is not ADMIN
 *   INVALID_JSON           — body is not valid JSON
 *   INVALID_FIELD          — body has an invalid value
 */

import { NextRequest, NextResponse } from "next/server";
import { getFarmContext } from "@/lib/server/farm-context";
import { verifyFreshAdminRole } from "@/lib/auth";
import {
  DEFAULT_MAP_SETTINGS,
  parseStoredMapSettings,
  type FarmMapSettings,
} from "@/lib/farm-settings/defaults";
import { revalidateSettingsWrite } from "@/lib/server/revalidate";

export async function GET(req: NextRequest) {
  const ctx = await getFarmContext(req);
  if (!ctx) {
    return NextResponse.json(
      { error: "Unauthorized", code: "MISSING_ADMIN_SESSION" },
      { status: 401 },
    );
  }
  const { prisma } = ctx;

  const row = await prisma.farmSettings.findFirst({ select: { mapSettings: true } });
  return NextResponse.json(parseStoredMapSettings(row?.mapSettings));
}

export async function PUT(req: NextRequest) {
  const ctx = await getFarmContext(req);
  if (!ctx) {
    return NextResponse.json(
      { error: "Unauthorized", code: "MISSING_ADMIN_SESSION" },
      { status: 401 },
    );
  }
  const { prisma, role, slug, session } = ctx;

  if (role !== "ADMIN") {
    return NextResponse.json(
      { error: "Forbidden", code: "FORBIDDEN" },
      { status: 403 },
    );
  }
  // Phase H.2: re-verify ADMIN against meta-db (stale-ADMIN defence).
  if (!(await verifyFreshAdminRole(session.user.id, slug))) {
    return NextResponse.json(
      { error: "Forbidden", code: "FORBIDDEN" },
      { status: 403 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body", code: "INVALID_JSON" },
      { status: 400 },
    );
  }

  const next: FarmMapSettings = { ...DEFAULT_MAP_SETTINGS };

  if ("eskomAreaId" in body) {
    const v = body.eskomAreaId;
    if (v === null) {
      next.eskomAreaId = null;
    } else if (typeof v === "string") {
      const trimmed = v.trim();
      // Basic sanity: EskomSePush area ids are slash-separated slugs. Reject
      // obviously-bogus input without being overly restrictive.
      if (!trimmed) {
        next.eskomAreaId = null;
      } else if (trimmed.length > 200) {
        return NextResponse.json(
          { error: "eskomAreaId too long", code: "INVALID_FIELD" },
          { status: 400 },
        );
      } else {
        next.eskomAreaId = trimmed;
      }
    } else {
      return NextResponse.json(
        { error: "eskomAreaId must be a string or null", code: "INVALID_FIELD" },
        { status: 400 },
      );
    }
  }

  await prisma.farmSettings.upsert({
    where: { id: "singleton" },
    update: { mapSettings: JSON.stringify(next) },
    create: {
      id: "singleton",
      mapSettings: JSON.stringify(next),
    },
  });

  revalidateSettingsWrite(slug);
  return NextResponse.json(next);
}
