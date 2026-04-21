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
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaWithAuth } from "@/lib/farm-prisma";
import {
  DEFAULT_MAP_SETTINGS,
  parseStoredMapSettings,
  type FarmMapSettings,
} from "./schema";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized", code: "MISSING_ADMIN_SESSION" },
      { status: 401 },
    );
  }

  const db = await getPrismaWithAuth(session);
  if ("error" in db) {
    return NextResponse.json({ error: db.error }, { status: db.status });
  }
  const { prisma } = db;

  const row = await prisma.farmSettings.findFirst({ select: { mapSettings: true } });
  return NextResponse.json(parseStoredMapSettings(row?.mapSettings));
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized", code: "MISSING_ADMIN_SESSION" },
      { status: 401 },
    );
  }

  const db = await getPrismaWithAuth(session);
  if ("error" in db) {
    return NextResponse.json({ error: db.error }, { status: db.status });
  }
  const { prisma, role } = db;

  if (role !== "ADMIN") {
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

  return NextResponse.json(next);
}
