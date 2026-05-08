/**
 * Wave F (#163) — `/api/push/subscribe` POST + DELETE migrated onto
 * `tenantWrite`.
 *
 * POST has a unique constraint: it requires `userEmail` to be present (not
 * just authenticated). `tenantWrite` only checks for `ctx`, not
 * `userEmail`, so the route handler still emits its own 401 when email is
 * missing. This stays in the route layer rather than the op so the op's
 * signature stays simple.
 *
 * DELETE scopes deletion by `userEmail` — when the session somehow has no
 * email (unusual but possible after token rotation), pass through an empty
 * string so the where-clause cannot match any subscription, preserving the
 * pre-Wave-F semantic.
 */
import { NextResponse } from "next/server";

import { tenantWrite } from "@/lib/server/route";
import { subscribePush, unsubscribePush } from "@/lib/domain/push";
import type { SubscribePushInput } from "@/lib/domain/push";

interface UnsubscribeBody {
  endpoint: string;
}

export const POST = tenantWrite<SubscribePushInput>({
  handle: async (ctx, body) => {
    const userEmail = ctx.session.user?.email;
    if (!userEmail) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await subscribePush(ctx.prisma, userEmail, body);
    return NextResponse.json({ success: true });
  },
});

export const DELETE = tenantWrite<UnsubscribeBody>({
  handle: async (ctx, body) => {
    const userEmail = ctx.session.user?.email ?? "";
    await unsubscribePush(ctx.prisma, userEmail, body.endpoint);
    return NextResponse.json({ success: true });
  },
});
