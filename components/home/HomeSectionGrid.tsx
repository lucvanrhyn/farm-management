"use client";

/**
 * HomeSectionGrid — the 3-card section launcher (Admin / Logger / Map)
 * rendered on /[farmSlug]/home.
 *
 * Extracted out of `app/[farmSlug]/home/page.tsx` and loaded via
 * `next/dynamic({ ssr: false })` from the page so `framer-motion` lands
 * in a separate chunk that only downloads *after* first paint of the
 * authenticated landing page. Mirrors the P5 pattern already shipped
 * for /login.
 *
 * ssr: false is deliberate — these cards animate in with spring variants
 * that depend on client-only motion state; rendering the initial frame
 * on the server would either ship framer into the server bundle (no
 * saving) or cause a hydration mismatch.
 */

import { motion } from "framer-motion";
import { useRouter } from "next/navigation";

export interface HomeSection {
  path: string;
  label: string;
  icon: React.ReactNode;
  description: string;
}

const cardVariants = {
  hidden: { opacity: 0, y: 24, scale: 0.95 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: "spring" as const,
      stiffness: 200,
      damping: 22,
      delay: i * 0.08,
    },
  }),
};

export default function HomeSectionGrid({
  sections,
  farmSlug,
}: {
  sections: HomeSection[];
  farmSlug: string;
}) {
  const router = useRouter();

  return (
    <div className="grid grid-cols-3 gap-4 w-full">
      {sections.map((section, i) => (
        <motion.button
          key={section.path}
          custom={i}
          variants={cardVariants}
          initial="hidden"
          animate="show"
          whileHover={{
            scale: 1.03,
            transition: { type: "spring", stiffness: 300, damping: 20 },
          }}
          whileTap={{ scale: 0.97 }}
          onClick={() => router.push(`/${farmSlug}${section.path}`)}
          className="group flex flex-col items-center gap-3 px-4 py-6"
          style={{
            borderRadius: "2rem",
            background: "rgba(5,3,1,0.52)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            border: "1px solid rgba(255,255,255,0.07)",
            boxShadow: "0 4px 24px rgba(0,0,0,0.40)",
            cursor: "pointer",
            minHeight: "140px",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(12,7,2,0.70)";
            e.currentTarget.style.border = "1px solid rgba(196,144,48,0.30)";
            e.currentTarget.style.boxShadow =
              "0 8px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(196,144,48,0.15)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(5,3,1,0.52)";
            e.currentTarget.style.border = "1px solid rgba(255,255,255,0.07)";
            e.currentTarget.style.boxShadow = "0 4px 24px rgba(0,0,0,0.40)";
          }}
        >
          {/* Icon */}
          <div
            className="rounded-xl p-3 transition-colors duration-200"
            style={{ color: "#C49030", background: "rgba(196,144,48,0.10)" }}
          >
            {section.icon}
          </div>

          {/* Labels */}
          <div className="flex flex-col items-center gap-0.5">
            <span
              style={{
                fontFamily: "var(--font-display)",
                color: "#F0DEB8",
                fontSize: "1rem",
                fontWeight: 600,
                letterSpacing: "0.02em",
              }}
            >
              {section.label}
            </span>
            <span
              style={{
                fontFamily: "var(--font-sans)",
                color: "#7A5840",
                fontSize: "0.7rem",
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              {section.description}
            </span>
          </div>

          {/* Arrow */}
          <svg
            className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            style={{ color: "#C49030" }}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
        </motion.button>
      ))}
    </div>
  );
}
