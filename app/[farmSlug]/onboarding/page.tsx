"use client";

/**
 * Step 1 — welcome + species picker.
 *
 * The species choice is stored on the wizard provider so later steps (the AI
 * mapping call, commit defaults) can read it. No server calls happen here —
 * this page is purely a landing pad that routes the user to /upload.
 */

import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { SpeciesPicker } from "@/components/onboarding/SpeciesPicker";
import { useOnboarding } from "@/components/onboarding/OnboardingProvider";

export default function OnboardingWelcomePage() {
  const router = useRouter();
  const params = useParams<{ farmSlug: string }>();
  const farmSlug = params.farmSlug;
  const { state, setSpecies } = useOnboarding();

  function handleContinue() {
    if (!farmSlug) return;
    router.push(`/${farmSlug}/onboarding/upload`);
  }

  return (
    <div
      className="mt-6 flex flex-col gap-6 rounded-[2rem] px-8 py-8"
      style={{
        background: "#241C14",
        border: "1px solid rgba(196,144,48,0.18)",
        boxShadow:
          "0 0 48px rgba(196,144,48,0.06), 0 8px 40px rgba(0,0,0,0.55)",
      }}
    >
      <div className="flex flex-col gap-2">
        <h2
          style={{
            fontFamily: "var(--font-display)",
            color: "#F0DEB8",
            fontSize: "1.5rem",
            fontWeight: 700,
            letterSpacing: "0.01em",
          }}
        >
          Welcome to FarmTrack
        </h2>
        <p
          style={{
            fontFamily: "var(--font-sans)",
            color: "#C9B48A",
            fontSize: "0.9375rem",
            lineHeight: 1.5,
          }}
        >
          Let&apos;s get your animals in. This takes 2&ndash;3 minutes.
        </p>
        <p
          style={{
            fontFamily: "var(--font-sans)",
            color: "#8A6840",
            fontSize: "0.875rem",
            lineHeight: 1.6,
          }}
        >
          Upload any spreadsheet of your animals — Excel, CSV, or an export from
          another system. Our AI reads your columns, matches them to FarmTrack
          fields, and shows you exactly what will be imported before anything is
          saved.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <p
          style={{
            fontFamily: "var(--font-sans)",
            color: "#F0DEB8",
            fontSize: "0.9375rem",
            fontWeight: 600,
          }}
        >
          Which species is your primary stock?
        </p>
        <SpeciesPicker value={state.species} onChange={setSpecies} />
        <p
          style={{
            fontFamily: "var(--font-sans)",
            color: "#6A4E30",
            fontSize: "0.75rem",
          }}
        >
          You can add more species later. This just sets the default for rows
          that don&apos;t specify a species column.
        </p>
      </div>

      <div className="flex items-center justify-end">
        <Button size="lg" onClick={handleContinue}>
          Continue
        </Button>
      </div>
    </div>
  );
}
