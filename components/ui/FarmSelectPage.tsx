"use client";

import { motion } from "framer-motion";
import Link from "next/link";

const FARMS = [
  {
    id: "trio-b",
    name: "Delta Livestock",
    subtitle: "Brangus · Limpopo",
    location: "Limpopo, Suid-Afrika",
    stats: "978 diere · 19 kampe",
    href: "/login",
  },
];

const fade = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.55, delay },
});

export function FarmSelectPage() {
  return (
    <div
      className="min-h-screen flex flex-col relative overflow-hidden"
      style={{
        backgroundImage: 'url("/farm-select.jpg")',
        backgroundSize: "cover",
        backgroundPosition: "center 35%",
      }}
    >
      {/* Layered overlay — darker vignette at edges, warmer in centre */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 80% 70% at 50% 55%, rgba(4,2,1,0.38) 0%, rgba(4,2,1,0.70) 100%),
            linear-gradient(to bottom, rgba(4,2,1,0.72) 0%, rgba(4,2,1,0.28) 30%, rgba(4,2,1,0.38) 65%, rgba(4,2,1,0.82) 100%)
          `,
          zIndex: 1,
        }}
      />

      {/* ─── Header ─── */}
      <header className="relative flex items-center justify-between px-8 pt-7 pb-4" style={{ zIndex: 10 }}>
        <motion.div {...fade(0.05)} className="flex flex-col">
          <span
            style={{
              fontFamily: "var(--font-display)",
              color: "#F0DEB8",
              fontSize: "1.25rem",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textShadow: "0 1px 12px rgba(0,0,0,0.7)",
            }}
          >
            FarmTrack
          </span>
          <span
            style={{
              fontFamily: "var(--font-sans)",
              color: "#7A5838",
              fontSize: "0.6875rem",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              textShadow: "0 1px 8px rgba(0,0,0,0.6)",
            }}
          >
            Jou plaas. Jou data.
          </span>
        </motion.div>

        {/* Decorative separator */}
        <motion.div
          {...fade(0.1)}
          className="hidden md:flex items-center gap-3"
          style={{ color: "#3A2210" }}
        >
          <div style={{ height: "1px", width: "48px", background: "rgba(196,144,48,0.18)" }} />
          <div style={{ width: "4px", height: "4px", borderRadius: "50%", background: "rgba(196,144,48,0.28)" }} />
          <div style={{ height: "1px", width: "48px", background: "rgba(196,144,48,0.18)" }} />
        </motion.div>
      </header>

      {/* ─── Main ─── */}
      <main className="relative flex-1 flex flex-col items-center justify-center px-6 py-8" style={{ zIndex: 10 }}>
        {/* Heading block */}
        <div className="flex flex-col items-center text-center gap-2 mb-12">
          <motion.h1
            {...fade(0.15)}
            style={{
              fontFamily: "var(--font-display)",
              color: "#F5EBD4",
              fontSize: "clamp(1.75rem, 4vw, 2.75rem)",
              fontWeight: 700,
              letterSpacing: "0.04em",
              textShadow: "0 2px 24px rgba(0,0,0,0.85)",
              lineHeight: 1.15,
            }}
          >
            Kies jou plaas
          </motion.h1>

          <motion.p
            {...fade(0.22)}
            style={{
              fontFamily: "var(--font-sans)",
              color: "#8A6840",
              fontSize: "0.875rem",
              letterSpacing: "0.06em",
              textShadow: "0 1px 10px rgba(0,0,0,0.7)",
            }}
          >
            Klik op jou plaas om in te teken
          </motion.p>

          {/* Decorative rule */}
          <motion.div {...fade(0.28)} className="flex items-center gap-3 mt-1">
            <div style={{ height: "1px", width: "40px", background: "rgba(196,144,48,0.22)" }} />
            <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: "rgba(196,144,48,0.35)" }} />
            <div style={{ height: "1px", width: "40px", background: "rgba(196,144,48,0.22)" }} />
          </motion.div>
        </div>

        {/* Farm cards grid — 1 card now, grows to 2-3 */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.32, }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 w-full max-w-3xl justify-items-center"
        >
          {FARMS.map((farm, i) => (
            <FarmCard key={farm.id} farm={farm} delay={0.38 + i * 0.08} />
          ))}
        </motion.div>
      </main>

      {/* ─── Footer ─── */}
      <footer className="relative pb-5 text-center" style={{ zIndex: 10 }}>
        <motion.p
          {...fade(0.55)}
          style={{
            fontFamily: "var(--font-sans)",
            color: "#3A2210",
            fontSize: "0.6875rem",
            letterSpacing: "0.06em",
          }}
        >
          © {new Date().getFullYear()} FarmTrack · Alle regte voorbehou
        </motion.p>
      </footer>
    </div>
  );
}

/* ── Farm Card ── */

type Farm = (typeof FARMS)[number];

function FarmCard({ farm, delay }: { farm: Farm; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, delay, }}
      className="group w-full max-w-xs"
    >
      <Link
        href={farm.href}
        className="flex flex-col gap-5 rounded-2xl px-7 py-7 relative overflow-hidden transition-all duration-300"
        style={{
          background: "rgba(5,3,1,0.55)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          border: "1px solid rgba(196,144,48,0.18)",
          boxShadow: "0 8px 40px rgba(0,0,0,0.45)",
          textDecoration: "none",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.transform = "translateY(-4px)";
          (e.currentTarget as HTMLElement).style.border = "1px solid rgba(196,144,48,0.55)";
          (e.currentTarget as HTMLElement).style.boxShadow =
            "0 16px 56px rgba(0,0,0,0.55), 0 0 0 1px rgba(196,144,48,0.20), 0 0 32px rgba(196,144,48,0.12)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
          (e.currentTarget as HTMLElement).style.border = "1px solid rgba(196,144,48,0.18)";
          (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 40px rgba(0,0,0,0.45)";
        }}
      >
        {/* Corner accent */}
        <div
          className="absolute top-0 right-0 w-16 h-16 pointer-events-none"
          style={{
            background: "radial-gradient(circle at top right, rgba(196,144,48,0.12) 0%, transparent 70%)",
          }}
        />

        {/* Farm identity */}
        <div className="flex flex-col gap-1.5">
          {/* Location pill */}
          <div className="flex items-center gap-1.5 mb-1">
            <svg
              className="w-3 h-3 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              style={{ color: "#7A5838" }}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"
              />
            </svg>
            <span
              style={{
                fontFamily: "var(--font-sans)",
                color: "#6A4828",
                fontSize: "0.6875rem",
                letterSpacing: "0.07em",
                textTransform: "uppercase",
              }}
            >
              {farm.location}
            </span>
          </div>

          <h2
            style={{
              fontFamily: "var(--font-display)",
              color: "#F0DEB8",
              fontSize: "1.3125rem",
              fontWeight: 700,
              letterSpacing: "0.01em",
              lineHeight: 1.2,
              textShadow: "0 1px 8px rgba(0,0,0,0.6)",
            }}
          >
            {farm.name}
          </h2>

          <p
            style={{
              fontFamily: "var(--font-sans)",
              color: "#8A6840",
              fontSize: "0.8125rem",
              letterSpacing: "0.04em",
            }}
          >
            {farm.subtitle}
          </p>
        </div>

        {/* Divider */}
        <div style={{ height: "1px", background: "rgba(196,144,48,0.12)" }} />

        {/* Stats row */}
        <p
          style={{
            fontFamily: "var(--font-sans)",
            color: "#5A3E28",
            fontSize: "0.75rem",
            letterSpacing: "0.05em",
          }}
        >
          {farm.stats}
        </p>

        {/* CTA */}
        <div className="flex items-center justify-between">
          <span
            style={{
              fontFamily: "var(--font-sans)",
              color: "#C49030",
              fontSize: "0.875rem",
              fontWeight: 600,
              letterSpacing: "0.04em",
            }}
          >
            Teken In
          </span>
          <svg
            className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            style={{ color: "#C49030" }}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
        </div>
      </Link>
    </motion.div>
  );
}
