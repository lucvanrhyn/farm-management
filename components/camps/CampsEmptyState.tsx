import Link from "next/link";

/**
 * CampsEmptyState — actionable "no camps yet — get started" guidance shown
 * when the active FarmMode (species) has zero camps.
 *
 * Wave 288 (parent PRD #279). Before this, the sheep camps surface rendered
 * an empty/headerless `<CampsTable>` and the tenant map mounted a blank map
 * with no camps — neither told the user *why* it was empty or *how* to fix
 * it. This component is species-aware (the `speciesLabel` prop) so a user in
 * sheep mode is not confused by cattle camps, and vice-versa.
 *
 * Two surfaces consume it:
 *  - `/[slug]/sheep/camps` — `variant="page"` (inline card under the header).
 *  - `/[slug]/map` — `variant="overlay"` (fills the would-be map area).
 *
 * Pattern mirrors `components/admin/breeding/NoPedigreeEmptyState.tsx`
 * (why/how explainer + a single primary CTA, palette-consistent).
 */
export default function CampsEmptyState({
  farmSlug,
  speciesLabel,
  variant = "page",
}: {
  farmSlug: string;
  /** Human label for the active species, e.g. "sheep", "cattle". */
  speciesLabel: string;
  variant?: "page" | "overlay";
}) {
  const testId = variant === "overlay" ? "map-empty-state" : "camps-empty-state";
  const addCampHref = `/${farmSlug}/${speciesLabel}/camps`;

  const card = (
    <div
      data-testid={testId}
      className="flex flex-col items-center gap-5 rounded-2xl px-8 py-12 text-center"
      style={{
        background: "#FFFFFF",
        border: "1px solid rgba(196,144,48,0.2)",
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        maxWidth: "32rem",
      }}
    >
      <div
        aria-hidden="true"
        className="flex size-14 items-center justify-center rounded-full"
        style={{
          background: "rgba(196,144,48,0.10)",
          border: "1px solid rgba(196,144,48,0.28)",
          color: "#8B6914",
        }}
      >
        {/* Inline paddock / fenced-area glyph, pure CSS — no new asset. */}
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 10h18" />
          <path d="M9 5v14" />
          <path d="M15 5v14" />
        </svg>
      </div>

      <h2 className="text-lg font-semibold" style={{ color: "#1C1815" }}>
        No {speciesLabel} camps yet
      </h2>
      <p
        className="text-sm max-w-md"
        style={{ color: "#6A4E30", lineHeight: 1.55 }}
      >
        You haven&apos;t added any {speciesLabel} camps. Camps are the grazing
        paddocks your {speciesLabel} rotate through — add your first one to
        start mapping boundaries, logging conditions and planning rotations.
      </p>

      <div
        className="w-full max-w-md text-left rounded-xl px-4 py-3 text-xs space-y-2"
        style={{
          background: "#FAFAF8",
          border: "1px solid #E0D5C8",
          color: "#6B5C4E",
          lineHeight: 1.55,
        }}
      >
        <p>
          <strong style={{ color: "#1C1815" }}>Why this is empty:</strong> This
          surface is scoped to your <strong>{speciesLabel}</strong> herd. Camps
          you created for a different species won&apos;t show here — each
          species keeps its own paddocks.
        </p>
        <p>
          <strong style={{ color: "#1C1815" }}>How to get started:</strong> Add
          a camp with a name and size, then draw its boundary on the map. Once
          a camp exists you can move animals into it and log grazing.
        </p>
      </div>

      <Link
        href={addCampHref}
        className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors"
        style={{
          background: "#8B6914",
          color: "#FAFAF8",
          boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
        }}
      >
        Add your first {speciesLabel} camp
        <span aria-hidden="true">→</span>
      </Link>
    </div>
  );

  if (variant === "overlay") {
    return (
      <div
        className="flex items-center justify-center rounded-2xl p-6"
        style={{
          background: "#FAFAF8",
          border: "1px dashed #E0D5C8",
          minHeight: "320px",
          height: "calc(100dvh - 9rem)",
        }}
      >
        {card}
      </div>
    );
  }

  return <div className="mt-6 flex justify-center">{card}</div>;
}
