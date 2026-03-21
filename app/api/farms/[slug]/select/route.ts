import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import type { SessionFarm } from "@/types/next-auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.redirect(new URL("/login", process.env.NEXTAUTH_URL ?? "http://localhost:3001"));
  }

  // Verify the user actually has access to this farm
  const accessible = (session.user.farms as SessionFarm[]).some((f) => f.slug === slug);
  if (!accessible) {
    return NextResponse.redirect(new URL("/farms", process.env.NEXTAUTH_URL ?? "http://localhost:3001"));
  }

  // Set the active farm cookie and send the user to their farm's home
  const response = NextResponse.redirect(
    new URL(`/${slug}/home`, process.env.NEXTAUTH_URL ?? "http://localhost:3001"),
  );
  response.cookies.set("active_farm_slug", slug, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 1 week
  });

  return response;
}
