import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { publicHandler } from "@/lib/server/route";
import type { SessionFarm } from "@/types/next-auth";

export const GET = publicHandler<{ slug: string }>({
  handle: async (req: NextRequest, { slug }: { slug: string }) => {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.redirect(new URL("/login", req.url));
    }

    // Verify the user actually has access to this farm
    const accessible = (session.user.farms as SessionFarm[]).some((f) => f.slug === slug);
    if (!accessible) {
      return NextResponse.redirect(new URL("/farms", req.url));
    }

    // Set the active farm cookie and send the user to their farm's home
    const response = NextResponse.redirect(
      new URL(`/${slug}/home`, req.url),
    );
    response.cookies.set("active_farm_slug", slug, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 1 week
    });

    return response;
  },
});
