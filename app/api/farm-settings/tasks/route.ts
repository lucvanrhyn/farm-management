/**
 * GET  /api/farm-settings/tasks — read the current task settings JSON blob
 * PUT  /api/farm-settings/tasks — persist task-related farm settings
 *
 * Backed by `FarmSettings.taskSettings` (String? JSON) on the active tenant.
 * Per Phase K Wave 3F we store task prefs as a JSON blob to avoid adding one
 * column per preference; the shape below is the contract.
 *
 * Body (PUT):
 *   {
 *     defaultReminderOffset: number,   // minutes, 0..10080 (1 week)
 *     autoObservation:       boolean,  // create obs from completion payload
 *     horizonDays:           30|60|90  // materialisation window for occurrences
 *   }
 *
 * Error codes:
 *   MISSING_ADMIN_SESSION — no valid session
 *   FORBIDDEN              — session exists but user is not ADMIN
 *   INVALID_JSON           — body is not valid JSON
 *   INVALID_FIELD          — body has an invalid value
 *   FARM_NOT_FOUND         — tenant prisma not resolved
 */

import { NextRequest, NextResponse } from "next/server";
import { getFarmContext } from "@/lib/server/farm-context";
import { verifyFreshAdminRole } from "@/lib/auth";
import {
  parseStoredTaskSettings,
  type FarmTaskSettings,
} from "@/lib/farm-settings/defaults";
import { revalidateSettingsWrite } from "@/lib/server/revalidate";
import { routeError } from "@/lib/server/route/envelope";

export async function GET(req: NextRequest) {
  const ctx = await getFarmContext(req);
  if (!ctx) {
    return routeError("MISSING_ADMIN_SESSION", "Unauthorized", 401);
  }
  const { prisma } = ctx;

  const row = await prisma.farmSettings.findFirst({ select: { taskSettings: true } });
  return NextResponse.json(parseStoredTaskSettings(row?.taskSettings));
}

export async function PUT(req: NextRequest) {
  const ctx = await getFarmContext(req);
  if (!ctx) {
    return routeError("MISSING_ADMIN_SESSION", "Unauthorized", 401);
  }
  const { prisma, role, slug, session } = ctx;

  if (role !== "ADMIN") {
    return routeError("FORBIDDEN", "Forbidden");
  }
  // Phase H.2: re-verify ADMIN against meta-db (stale-ADMIN defence).
  if (!(await verifyFreshAdminRole(session.user.id, slug))) {
    return routeError("FORBIDDEN", "Forbidden");
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return routeError("INVALID_JSON", "Invalid JSON body", 400);
  }

  const { defaultReminderOffset, autoObservation, horizonDays } = body;

  if (
    typeof defaultReminderOffset !== "number" ||
    !Number.isFinite(defaultReminderOffset) ||
    defaultReminderOffset < 0 ||
    defaultReminderOffset > 10080
  ) {
    return routeError(
      "INVALID_FIELD",
      "defaultReminderOffset must be a number between 0 and 10080",
      400,
    );
  }

  if (typeof autoObservation !== "boolean") {
    return routeError("INVALID_FIELD", "autoObservation must be a boolean", 400);
  }

  if (horizonDays !== 30 && horizonDays !== 60 && horizonDays !== 90) {
    return routeError("INVALID_FIELD", "horizonDays must be 30, 60, or 90", 400);
  }

  const next: FarmTaskSettings = {
    defaultReminderOffset: Math.round(defaultReminderOffset),
    autoObservation,
    horizonDays,
  };

  // FarmSettings is a singleton — upsert handles the "no row yet" case.
  await prisma.farmSettings.upsert({
    where: { id: "singleton" },
    update: { taskSettings: JSON.stringify(next) },
    create: {
      id: "singleton",
      taskSettings: JSON.stringify(next),
    },
  });

  revalidateSettingsWrite(slug);
  return NextResponse.json(next);
}

