"use client";

import { motion } from "framer-motion";
import Link from "next/link";

// Farm cards are now generic — each farm's identity is shown after login
// based on the authenticated user's assigned farms from the meta database.

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
            Your Farm. Your Data.
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
            Farm Management
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
            Sign in to access your farm dashboard
          </motion.p>

          {/* Decorative rule */}
          <motion.div {...fade(0.28)} className="flex items-center gap-3 mt-1">
            <div style={{ height: "1px", width: "40px", background: "rgba(196,144,48,0.22)" }} />
            <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: "rgba(196,144,48,0.35)" }} />
            <div style={{ height: "1px", width: "40px", background: "rgba(196,144,48,0.22)" }} />
          </motion.div>
        </div>

        {/* Sign-in CTA */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.32 }}
          className="flex justify-center"
        >
          <Link
            href="/login"
            className="group flex items-center gap-3 px-8 py-4 rounded-2xl transition-all duration-300"
            style={{
              background: "rgba(5,3,1,0.55)",
              backdropFilter: "blur(14px)",
              WebkitBackdropFilter: "blur(14px)",
              border: "1px solid rgba(196,144,48,0.28)",
              boxShadow: "0 8px 40px rgba(0,0,0,0.45)",
              textDecoration: "none",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.border = "1px solid rgba(196,144,48,0.6)";
              (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.border = "1px solid rgba(196,144,48,0.28)";
              (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-display)",
                color: "#F0DEB8",
                fontSize: "1.0625rem",
                fontWeight: 600,
                letterSpacing: "0.04em",
              }}
            >
              Sign In to FarmTrack
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
          </Link>
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
          © {new Date().getFullYear()} FarmTrack · All rights reserved
        </motion.p>
      </footer>
    </div>
  );
}

