/**
 * DELETE /api/task-templates/[id] — remove a task template (ADMIN only)
 * PATCH  /api/task-templates/[id] — update partial fields (ADMIN only)
 *
 * Both routes are tenant-scoped via getPrismaWithAuth. We explicitly guard
 * against cross-tenant deletes by filtering on tenantSlug when we look up
 * the template, even though Prisma is already pointed at the tenant DB —
 * defence in depth.
 *
 * Error codes (returned in body as `code`):
 *   MISSING_ADMIN_SESSION — no valid session
 *   FORBIDDEN              — session exists but user is not ADMIN
 *   TEMPLATE_NOT_FOUND     — no template with the given id in this tenant
 *   INVALID_JSON           — PATCH body is not valid JSON
 *   INVALID_FIELD          — PATCH body includes a disallowed key or value
 */

import { NextRequest, NextResponse } from "next/server";
import { getFarmContext } from "@/lib/server/farm-context";
import { verifyFreshAdminRole } from "@/lib/auth";
import { revalidateTaskWrite } from "@/lib/server/revalidate";

// ── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getFarmContext(req);
  if (!ctx) {
    return NextResponse.json(
      { error: "Unauthorized", code: "MISSING_ADMIN_SESSION" },
      { status: 401 },
    );
  }
  const { prisma, role, slug: tenantSlug, session } = ctx;

  const { id } = await params;

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

  const existing = await prisma.taskTemplate.findFirst({
    where: { id, tenantSlug },
  });
  if (!existing) {
    return NextResponse.json(
      { error: "Template not found", code: "TEMPLATE_NOT_FOUND" },
      { status: 404 },
    );
  }

  await prisma.taskTemplate.delete({ where: { id } });

  revalidateTaskWrite(tenantSlug);
  return NextResponse.json({ success: true, deleted: id });
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

const STRING_FIELDS = [
  "name",
  "name_af",
  "taskType",
  "description",
  "description_af",
  "priorityDefault",
  "recurrenceRule",
  "species",
] as const;

type StringField = typeof STRING_FIELDS[number];

const VALID_PRIORITIES = new Set(["low", "medium", "high"]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getFarmContext(req);
  if (!ctx) {
    return NextResponse.json(
      { error: "Unauthorized", code: "MISSING_ADMIN_SESSION" },
      { status: 401 },
    );
  }
  const { prisma, role, slug: tenantSlug, session } = ctx;

  const { id } = await params;

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

  const existing = await prisma.taskTemplate.findFirst({
    where: { id, tenantSlug },
  });
  if (!existing) {
    return NextResponse.json(
      { error: "Template not found", code: "TEMPLATE_NOT_FOUND" },
      { status: 404 },
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

  // Build a whitelist of permitted fields. Unknown keys are silently dropped.
  const update: Record<string, unknown> = {};

  for (const field of STRING_FIELDS) {
    if (!(field in body)) continue;
    const value = body[field as StringField];
    if (value === null) {
      // Nullables: name/taskType/priorityDefault are required in schema —
      // reject null for those. Others may be cleared.
      if (field === "name" || field === "taskType") {
        return NextResponse.json(
          { error: `${field} cannot be null`, code: "INVALID_FIELD" },
          { status: 400 },
        );
      }
      update[field] = null;
    } else if (typeof value === "string") {
      if (field === "priorityDefault" && !VALID_PRIORITIES.has(value)) {
        return NextResponse.json(
          { error: "priorityDefault must be low|medium|high", code: "INVALID_FIELD" },
          { status: 400 },
        );
      }
      update[field] = value.trim();
    } else {
      return NextResponse.json(
        { error: `${field} must be a string or null`, code: "INVALID_FIELD" },
        { status: 400 },
      );
    }
  }

  if ("reminderOffset" in body) {
    const v = body.reminderOffset;
    if (v === null) {
      update.reminderOffset = null;
    } else if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
      update.reminderOffset = Math.round(v);
    } else {
      return NextResponse.json(
        { error: "reminderOffset must be a non-negative number or null", code: "INVALID_FIELD" },
        { status: 400 },
      );
    }
  }

  if ("isPublic" in body) {
    if (typeof body.isPublic !== "boolean") {
      return NextResponse.json(
        { error: "isPublic must be a boolean", code: "INVALID_FIELD" },
        { status: 400 },
      );
    }
    update.isPublic = body.isPublic;
  }

  const updated = await prisma.taskTemplate.update({
    where: { id },
    data: update,
  });

  revalidateTaskWrite(tenantSlug);
  return NextResponse.json(updated);
}
