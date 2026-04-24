/**
 * POST /api/task-templates/install
 *
 * ADMIN-only. Upserts all 20 SA-native seed templates for the active tenant.
 * Idempotent — safe to call multiple times; existing templates are not modified.
 *
 * Response: { installed: number, skipped: number }
 *
 * Error codes:
 *   MISSING_ADMIN_SESSION — no valid session
 *   FORBIDDEN              — session exists but user is not ADMIN
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getPrismaWithAuth } from "@/lib/farm-prisma";
import { verifyFreshAdminRole } from "@/lib/auth";
import { SEED_TEMPLATES } from "@/lib/tasks/seed-templates";
import { revalidateTaskWrite } from "@/lib/server/revalidate";

export async function POST(req: NextRequest) {
  // Suppress unused parameter warning — no body needed for this route
  void req;

  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized", code: "MISSING_ADMIN_SESSION" },
      { status: 401 },
    );
  }

  const db = await getPrismaWithAuth(session);
  if ("error" in db) return NextResponse.json({ error: db.error }, { status: db.status });
  const { prisma, role, slug: tenantSlug } = db;

  if (role !== "ADMIN") {
    return NextResponse.json(
      { error: "Forbidden", code: "FORBIDDEN" },
      { status: 403 },
    );
  }
  // Phase H.2: re-verify ADMIN against meta-db (stale-ADMIN defence).
  if (!(await verifyFreshAdminRole(session.user.id, tenantSlug))) {
    return NextResponse.json(
      { error: "Forbidden", code: "FORBIDDEN" },
      { status: 403 },
    );
  }

  let installed = 0;
  let skipped = 0;

  for (const template of SEED_TEMPLATES) {
    const { name, name_af, taskType, description, description_af, priorityDefault, recurrenceRule, reminderOffset, species, isPublic } = template;

    const result = await prisma.taskTemplate.upsert({
      where: { tenantSlug_name: { tenantSlug, name } },
      create: {
        tenantSlug,
        name,
        name_af,
        taskType,
        description: description ?? null,
        description_af: description_af ?? null,
        priorityDefault,
        recurrenceRule: recurrenceRule ?? null,
        reminderOffset: reminderOffset ?? null,
        species: species ?? null,
        isPublic,
      },
      update: {}, // idempotent — don't overwrite existing customised templates
    });

    // upsert always returns a record. We track whether it was a create by checking
    // if createdAt ≈ updatedAt (within 1 second). Simpler: count upsert calls.
    // Since update is {}, the record is unchanged on collision — we count via a
    // separate flag approach. For simplicity we track by attempting to detect new
    // vs existing via the created/updatedAt diff.
    const diffMs = Math.abs(
      new Date(result.updatedAt).getTime() - new Date(result.createdAt).getTime(),
    );
    if (diffMs < 1000) {
      installed++;
    } else {
      skipped++;
    }
  }

  revalidateTaskWrite(db.slug);
  return NextResponse.json({ installed, skipped });
}
