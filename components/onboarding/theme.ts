/**
 * Shared visual tokens + motion variants for the onboarding wizard.
 *
 * Aesthetic direction: "editorial farmhouse ledger at golden hour". Deep amber
 * warmth, parchment card surfaces, Playfair Display headlines, spring-physics
 * motion, subtle grain overlays. Keep these constants local to the wizard so
 * a future theme refresh doesn't touch the rest of the app.
 */

export const ONBOARDING_COLORS = {
  // Surfaces
  bg: "#14100B",
  bgSoft: "#1A1510",
  surface: "#241C14",
  surfaceRaised: "#2C2218",
  surfaceInk: "#1F1810",

  // Copper / amber scale
  copperDeep: "#7A4E20",
  copper: "#A0522D",
  amber: "#C49030",
  amberBright: "#E5B964",
  gold: "#F0CF7F",

  // Parchment
  cream: "#F5EBD4",
  parchment: "#F0DEB8",
  muted: "#C9B48A",
  mutedDim: "#8A6840",
  whisper: "#6A4E30",
  smoke: "#3A2A1A",

  // Confidence bands — hand-mixed to feel warm + alive
  bandHigh: "#6B9362", // leaf-green
  bandHighInk: "#0F1A0C",
  bandHighBorder: "rgba(107,147,98,0.55)",
  bandReview: "#D9A441", // warm mustard
  bandReviewInk: "#2B1F0A",
  bandReviewBorder: "rgba(217,164,65,0.55)",
  bandManual: "#C8513A", // rust red
  bandManualInk: "#200704",
  bandManualBorder: "rgba(200,81,58,0.55)",
};

/** Radial amber glow background — paste into `style={{ background: ONBOARDING_GLOW }}`. */
export const ONBOARDING_GLOW = `
  radial-gradient(ellipse 80% 50% at 50% 0%, rgba(196,144,48,0.10) 0%, transparent 70%),
  radial-gradient(ellipse 50% 60% at 85% 100%, rgba(160,82,45,0.08) 0%, transparent 70%),
  #14100B
`;

/** Parchment card — subtle warm gradient on top of the surface color. */
export const PARCHMENT_CARD = {
  background: `
    linear-gradient(145deg, rgba(245,235,212,0.03) 0%, transparent 40%),
    linear-gradient(180deg, #2C2218 0%, #241C14 100%)
  `,
  border: "1px solid rgba(196,144,48,0.22)",
  boxShadow:
    "0 1px 0 rgba(245,235,212,0.04) inset, 0 0 40px rgba(196,144,48,0.08), 0 12px 40px rgba(0,0,0,0.55)",
};

/** Copper-gradient button fill (inline-style usage). */
export const COPPER_FILL =
  "linear-gradient(135deg, rgba(229,185,100,0.95) 0%, rgba(196,144,48,0.95) 45%, rgba(160,82,45,0.95) 100%)";

/** Hairline amber divider with center diamond glyph. */
export const DIVIDER_COLOR = "rgba(196,144,48,0.28)";

// ---------------------------------------------------------------------------
// Motion variants — always spring physics per frontend-design-21 spec.
// ---------------------------------------------------------------------------

export const SPRING_SOFT = { type: "spring" as const, stiffness: 90, damping: 22 };
export const SPRING_SNAP = { type: "spring" as const, stiffness: 400, damping: 30 };

export const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  show: {
    opacity: 1,
    y: 0,
    transition: SPRING_SOFT,
  },
};

export const fadeIn = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.35 } },
};

export const staggerContainer = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.06, delayChildren: 0.08 },
  },
};

/** Page-level entrance for the content below the stepper. */
export const pageEnter = {
  hidden: { opacity: 0, y: 24 },
  show: {
    opacity: 1,
    y: 0,
    transition: { ...SPRING_SOFT, mass: 0.9 },
  },
  exit: { opacity: 0, y: -12, transition: { duration: 0.2 } },
};
