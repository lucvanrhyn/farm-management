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
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaWithAuth } from "@/lib/farm-prisma";
import { verifyFreshAdminRole } from "@/lib/auth";
import {
  DEFAULT_TASK_SETTINGS,
  parseStoredTaskSettings,
  type FarmTaskSettings,
} from "@/lib/farm-settings/defaults";
import { revalidateSettingsWrite } from "@/lib/server/revalidate";

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

  const row = await prisma.farmSettings.findFirst({ select: { taskSettings: true } });
  return NextResponse.json(parseStoredTaskSettings(row?.taskSettings));
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
  // Phase H.2: re-verify ADMIN against meta-db (stale-ADMIN defence).
  if (!(await verifyFreshAdminRole(session.user.id, db.slug))) {
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

  const { defaultReminderOffset, autoObservation, horizonDays } = body;

  if (
    typeof defaultReminderOffset !== "number" ||
    !Number.isFinite(defaultReminderOffset) ||
    defaultReminderOffset < 0 ||
    defaultReminderOffset > 10080
  ) {
    return NextResponse.json(
      { error: "defaultReminderOffset must be a number between 0 and 10080", code: "INVALID_FIELD" },
      { status: 400 },
    );
  }

  if (typeof autoObservation !== "boolean") {
    return NextResponse.json(
      { error: "autoObservation must be a boolean", code: "INVALID_FIELD" },
      { status: 400 },
    );
  }

  if (horizonDays !== 30 && horizonDays !== 60 && horizonDays !== 90) {
    return NextResponse.json(
      { error: "horizonDays must be 30, 60, or 90", code: "INVALID_FIELD" },
      { status: 400 },
    );
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

  revalidateSettingsWrite(db.slug);
  return NextResponse.json(next);
}
