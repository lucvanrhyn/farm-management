"use client";

/**
 * Step 1 — welcome + species picker.
 *
 * Editorial hero sets expectations (2–3 minutes, spreadsheet-agnostic), then
 * asks for the primary species so later steps have a sensible default. No
 * server calls — pure state + routing.
 */

import { motion } from "framer-motion";
import { ArrowRight, Sparkles } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { SpeciesPicker } from "@/components/onboarding/SpeciesPicker";
import { StepShell } from "@/components/onboarding/StepShell";
import { ONBOARDING_COLORS, SPRING_SOFT, staggerContainer } from "@/components/onboarding/theme";
import { useOnboarding } from "@/components/onboarding/OnboardingProvider";

const cellVariants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: SPRING_SOFT },
};

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
    <StepShell
      eyebrow="Step 01 · Let's begin"
      title={
        <>
          Let&apos;s bring your{" "}
          <span
            className="italic"
            style={{
              fontFamily: "var(--font-dm-serif)",
              color: ONBOARDING_COLORS.amberBright,
            }}
          >
            herd
          </span>{" "}
          home.
        </>
      }
      lead={
        <>
          Drop in any spreadsheet — Excel, CSV, a dump from another app.
          Our AI reads your columns, matches them to FarmTrack fields, and
          shows you exactly what will land in your ledger before it&apos;s saved.
        </>
      }
    >
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="show"
        className="flex flex-col gap-7"
      >
        {/* Three small reassurance badges */}
        <motion.ul
          variants={staggerContainer}
          className="flex flex-wrap gap-2"
          aria-label="What to expect"
        >
          {[
            { label: "~3 minutes" },
            { label: "Private to this device until commit" },
            { label: "Blank template fallback" },
          ].map((b) => (
            <motion.li
              key={b.label}
              variants={cellVariants}
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px]"
              style={{
                borderColor: "rgba(196,144,48,0.3)",
                background: "rgba(36,28,20,0.6)",
                color: ONBOARDING_COLORS.muted,
                fontFamily: "var(--font-sans)",
                letterSpacing: "0.02em",
              }}
            >
              <span
                aria-hidden="true"
                className="inline-block size-1.5 rounded-full"
                style={{ background: ONBOARDING_COLORS.amber }}
              />
              {b.label}
            </motion.li>
          ))}
        </motion.ul>

        {/* Species question */}
        <motion.div variants={cellVariants} className="flex flex-col gap-4">
          <div>
            <p
              className="text-[10.5px] uppercase tracking-[0.22em]"
              style={{ color: "#C49030", fontFamily: "var(--font-sans)" }}
            >
              Your first question
            </p>
            <h2
              className="mt-1 text-xl md:text-2xl"
              style={{
                color: ONBOARDING_COLORS.cream,
                fontFamily: "var(--font-display)",
                fontWeight: 600,
                letterSpacing: "-0.01em",
              }}
            >
              Which species is your primary stock?
            </h2>
          </div>

          <SpeciesPicker value={state.species} onChange={setSpecies} />

          <p
            className="text-[12px] italic"
            style={{ color: ONBOARDING_COLORS.whisper, fontFamily: "var(--font-sans)" }}
          >
            You can add more species later. This just sets the default for rows
            that don&apos;t specify a species column.
          </p>
        </motion.div>

        {/* CTA */}
        <motion.div variants={cellVariants} className="flex items-center justify-between gap-3 pt-2">
          <div
            className="flex items-center gap-2 text-[12px]"
            style={{ color: ONBOARDING_COLORS.mutedDim, fontFamily: "var(--font-sans)" }}
          >
            <Sparkles size={13} className="text-amber-300" />
            AI understands messy data — take a breath.
          </div>
          <motion.button
            type="button"
            onClick={handleContinue}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.97 }}
            transition={SPRING_SOFT}
            className="group inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1A1510] focus-visible:ring-amber-400"
            style={{
              background:
                "linear-gradient(135deg, rgba(229,185,100,0.95) 0%, rgba(196,144,48,0.95) 45%, rgba(160,82,45,0.95) 100%)",
              color: "#1A1510",
              boxShadow: "0 10px 30px rgba(196,144,48,0.35), 0 1px 0 rgba(245,235,212,0.25) inset",
              fontFamily: "var(--font-sans)",
            }}
          >
            Continue
            <ArrowRight
              size={15}
              strokeWidth={2.5}
              className="transition-transform group-hover:translate-x-1"
            />
          </motion.button>
        </motion.div>
      </motion.div>
    </StepShell>
  );
}
