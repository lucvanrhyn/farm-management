import Link from "next/link";

/**
 * Empty state shown on /<farm>/admin/breeding-ai when fewer than ~10 % of the
 * herd has pedigree data and `suggestPairings` returns reason "NO_PEDIGREE_SEED".
 *
 * Wave 27a (issue #27 O2) added the *why* / *how* explainer + a downloadable
 * sample CSV. The explainer uses Breeding-AI vocabulary the algorithm
 * actually relies on (COI, EBV, 10 % threshold) so users understand why the
 * page is blocked instead of guessing.
 */
export default function NoPedigreeEmptyState({ farmSlug }: { farmSlug: string }) {
  return (
    <div
      className="mt-6 flex flex-col items-center gap-5 rounded-2xl px-8 py-12 text-center"
      style={{
        background: "#FFFFFF",
        border: "1px solid rgba(196,144,48,0.2)",
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      }}
    >
      {/* Inline pedigree-tree glyph, pure CSS — no new asset */}
      <div
        aria-hidden="true"
        className="flex size-14 items-center justify-center rounded-full"
        style={{
          background: "rgba(196,144,48,0.10)",
          border: "1px solid rgba(196,144,48,0.28)",
          color: "#8B6914",
        }}
      >
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
          <circle cx="12" cy="5" r="2.5" />
          <circle cx="5" cy="18" r="2.5" />
          <circle cx="19" cy="18" r="2.5" />
          <path d="M12 7.5v4" />
          <path d="M7 15.5 10.5 12h3L17 15.5" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold" style={{ color: "#1C1815" }}>
        Pedigree data needed
      </h2>
      <p className="text-sm max-w-md" style={{ color: "#6A4E30", lineHeight: 1.55 }}>
        Breeding suggestions need pedigree data to avoid in-breeding. Import
        your herd book via our AI Import Wizard to unlock bull-to-cow pairings,
        COI analysis and inbreeding risk detection.
      </p>

      {/* Why-and-how explainer block (issue #27 O2). */}
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
          <strong style={{ color: "#1C1815" }}>Why we need pedigree data:</strong>{" "}
          Breeding AI ranks pairings by inbreeding coefficient (COI) and EBV
          match. We need at least 10% of your herd to have mother + father IDs
          before suggestions are meaningful. Below that threshold, the rankings
          would be noise.
        </p>
        <p>
          <strong style={{ color: "#1C1815" }}>How to add it:</strong> Easiest
          way is to bulk-import a pedigree CSV. Download our sample template
          and fill in the columns from your stud register or SA Stud Book Logix
          export.
        </p>
        <p>
          <Link
            href="/sample-pedigree.csv"
            download
            className="inline-flex items-center gap-1 font-semibold underline-offset-2 hover:underline"
            style={{ color: "#8B6914" }}
          >
            Download sample pedigree CSV
            <span aria-hidden="true">↓</span>
          </Link>
        </p>
      </div>

      <Link
        href={`/${farmSlug}/admin/import?template=pedigree`}
        className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors"
        style={{
          background: "#8B6914",
          color: "#FAFAF8",
          boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
        }}
      >
        Import pedigree data
        <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}
