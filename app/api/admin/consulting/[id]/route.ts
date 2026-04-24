import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import {
  isPlatformAdmin,
  updateConsultingLeadStatus,
  VALID_LEAD_STATUSES,
  type ConsultingLead,
} from "@/lib/meta-db";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Platform-admin endpoint — no farm scoping. The consolidated
  // getFarmContext helpers require an active farm; this endpoint
  // operates on meta-DB consulting-lead rows only, so it retains the
  // legacy getServerSession path. (See EXEMPT set in
  // __tests__/api/session-consolidation-coverage.test.ts.)
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isAdmin = await isPlatformAdmin(email);
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const nextStatus =
    body && typeof body === "object"
      ? (body as Record<string, unknown>).status
      : undefined;

  if (
    typeof nextStatus !== "string" ||
    !VALID_LEAD_STATUSES.includes(nextStatus as ConsultingLead["status"])
  ) {
    return NextResponse.json(
      { error: "Invalid status" },
      { status: 400 },
    );
  }

  const result = await updateConsultingLeadStatus(
    id,
    nextStatus as ConsultingLead["status"],
  );

  if (!result.ok) {
    if (result.error === "not found") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (result.error === "invalid transition") {
      return NextResponse.json(
        { error: "Invalid transition" },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
