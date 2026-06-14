export const dynamic = "force-dynamic";

import { Scissors } from "lucide-react";
import { PageHeader } from "@/components/ds";

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
    <div className="min-w-0 p-4 md:p-8 max-w-5xl bg-[var(--ft-bg)]">
      <PageHeader
        className="px-0 py-0 mb-6"
        title="Wool"
        subtitle="Shearing records, fleece weights, and clip values"
      />

      <div
        className="rounded-2xl border p-8 flex flex-col items-center text-center gap-3"
        style={{ background: "var(--ft-surface)", borderColor: "var(--ft-border)" }}
      >
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center"
          style={{ background: "rgba(156,142,122,0.1)" }}
        >
          <Scissors className="w-6 h-6" style={{ color: "var(--ft-subtle)" }} />
        </div>
        <h2 className="text-lg font-semibold" style={{ color: "var(--ft-text)" }}>
          Coming soon
        </h2>
        <p className="text-sm max-w-md" style={{ color: "var(--ft-muted)" }}>
          Wool tracking is in development. Log shearing events under
          observations today — the dashboard will roll them up here once
          released.
        </p>
      </div>
    </div>
  );
}
