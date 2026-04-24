import { NextRequest, NextResponse } from "next/server";
import { getFarmContext } from "@/lib/server/farm-context";

interface PushSubscriptionBody {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export async function POST(req: NextRequest) {
  const ctx = await getFarmContext(req);
  const userEmail = ctx?.session.user?.email;
  if (!ctx || !userEmail) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { prisma } = ctx;

  const body = await req.json() as PushSubscriptionBody;
  if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  }

  await prisma.pushSubscription.upsert({
    where: { endpoint: body.endpoint },
    create: {
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      userEmail,
    },
    update: {
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      userEmail,
    },
  });

  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const ctx = await getFarmContext(req);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { prisma, session } = ctx;

  const body = await req.json() as { endpoint: string };
  if (!body.endpoint) {
    return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });
  }

  // Scope to the requesting user's email so no one can unsubscribe another user
  await prisma.pushSubscription.deleteMany({
    where: { endpoint: body.endpoint, userEmail: session.user?.email ?? "" },
  });

  return NextResponse.json({ success: true });
}
