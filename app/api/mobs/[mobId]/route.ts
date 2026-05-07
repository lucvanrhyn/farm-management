/**
 * PATCH  /api/mobs/[mobId] — update a mob (rename and/or move-camp).
 * DELETE /api/mobs/[mobId] — delete a mob (blocked when active animals attached).
 *
 * Wave B (#151) — adapter-only wiring. Business logic lives in
 * `lib/domain/mobs/{update-mob,delete-mob}.ts`. Typed-error envelope maps
 * domain throws onto the existing wire shape via `mapApiDomainError`.
 *
 * Wire shapes:
 *   - PATCH 200    → `{ id, name, current_camp }`
 *   - PATCH 404    → `{ error: "Mob not found" }`            (MobNotFoundError)
 *   - PATCH 422    → `{ error: "CROSS_SPECIES_BLOCKED" }`    (CrossSpeciesBlockedError)
 *   - DELETE 200   → `{ success: true }`
 *   - DELETE 404   → `{ error: "Mob not found" }`            (MobNotFoundError)
 *   - DELETE 409   → `{ error: "Cannot delete mob with N assigned animal(s)..." }`
 */
import { NextResponse } from "next/server";

import { adminWrite } from "@/lib/server/route";
import { revalidateMobWrite } from "@/lib/server/revalidate";
import { updateMob, deleteMob } from "@/lib/domain/mobs";

interface PatchMobBody {
  name?: string;
  currentCamp?: string;
}

export const PATCH = adminWrite<PatchMobBody, { mobId: string }>({
  revalidate: revalidateMobWrite,
  handle: async (ctx, body, _req, params) => {
    const { mobId } = params;
    const result = await updateMob(ctx.prisma, {
      mobId,
      name: body.name,
      currentCamp: body.currentCamp,
      loggedBy: ctx.session.user?.email ?? null,
    });
    return NextResponse.json(result);
  },
});

export const DELETE = adminWrite<unknown, { mobId: string }>({
  revalidate: revalidateMobWrite,
  handle: async (ctx, _body, _req, params) => {
    const { mobId } = params;
    const result = await deleteMob(ctx.prisma, mobId);
    return NextResponse.json(result);
  },
});
