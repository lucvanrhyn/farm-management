import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { evictFarmClient } from "@/lib/farm-prisma";
import { getUserRoleForFarm } from "@/lib/auth";

// Platform-dev endpoint: evicts the cached Prisma client for any farm
// the caller is an ADMIN of. Needs the full session.user.farms list
// (not scoped to the active farm the way getFarmContext is), so it
// retains getServerSession here. Exempt via the
// session-consolidation-coverage allowlist.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const slug = typeof body?.slug === "string" ? body.slug.trim() : "";
  if (!slug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  if (getUserRoleForFarm(session, slug) !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  evictFarmClient(slug);
  return NextResponse.json({ success: true, slug });
}
