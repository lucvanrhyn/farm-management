export const dynamic = "force-dynamic";

import { Scissors } from "lucide-react";

/**
 * Stub for the wool-tracking dashboard.
 *
 * Issue #204 — the sheep-shearing-due alert in
 * `lib/species/sheep/index.ts` links to `/${farmSlug}/sheep/wool`. Until the
 * real feature ships, this stub reserves the route so the alert click-through
 * resolves to a placeholder instead of a 404.
 *
 * Styling mirrors `app/[farmSlug]/sheep/reproduction/page.tsx` — same brand
 * palette, same card container, same heading hierarchy — so the SheepSubNav
 * frame from `app/[farmSlug]/sheep/layout.tsx` reads as one continuous area.
 */
export default async function SheepWoolPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  // farmSlug is unused in the stub but awaiting it satisfies the Next 16
  // page contract and keeps the signature aligned with the eventual
  // wool-tracking implementation, which will need it for Prisma scoping.
  await params;

  return (
    <div className="min-w-0 p-4 md:p-8 max-w-5xl bg-[#FAFAF8]">
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "#1C1815" }}>
          Wool
        </h1>
        <p className="text-sm mt-1" style={{ color: "#9C8E7A" }}>
          Shearing records, fleece weights, and clip values
        </p>
      </div>

      <div
        className="rounded-2xl border p-8 flex flex-col items-center text-center gap-3"
        style={{ background: "#FFFFFF", borderColor: "#E0D5C8" }}
      >
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center"
          style={{ background: "rgba(156,142,122,0.1)" }}
        >
          <Scissors className="w-6 h-6" style={{ color: "#9C8E7A" }} />
        </div>
        <h2 className="text-lg font-semibold" style={{ color: "#1C1815" }}>
          Coming soon
        </h2>
        <p className="text-sm max-w-md" style={{ color: "#6B5E50" }}>
          Wool tracking is in development. Log shearing events under
          observations today — the dashboard will roll them up here once
          released.
        </p>
      </div>
    </div>
  );
}
