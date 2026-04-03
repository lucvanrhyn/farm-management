"use client";

import { signOut } from "next-auth/react";
import { useRouter, useParams } from "next/navigation";
import { motion } from "framer-motion";
import { AnimatedHero } from "@/components/ui/animated-hero";

const SECTIONS = [
  {
    path: "/admin",
    label: "Admin",
    afrikaans: "Admin",
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
    description: "Animals, camps & data",
  },
  {
    path: "/logger",
    label: "Logger",
    afrikaans: "Field Work",
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
      </svg>
    ),
    description: "Observations & movements",
  },
  {
    path: "/dashboard",
    label: "Map",
    afrikaans: "Overview",
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
      </svg>
    ),
    description: "Camps & farm map",
  },
];

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

export default function HomePage() {
  const router = useRouter();
  const params = useParams();
  const farmSlug = params.farmSlug as string;

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-5 relative overflow-hidden"
      style={{
        backgroundImage: 'url("/farm-hero.jpg")',
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      {/* Dark overlay */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, rgba(8,5,2,0.72) 0%, rgba(8,5,2,0.45) 40%, rgba(8,5,2,0.78) 100%)",
          zIndex: 1,
        }}
      />

      {/* Content */}
      <div className="relative w-full max-w-2xl flex flex-col items-center gap-10" style={{ zIndex: 10 }}>
        {/* Hero */}
        <AnimatedHero />

        {/* Section cards */}
        <div className="grid grid-cols-3 gap-4 w-full">
          {SECTIONS.map((section, i) => (
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
                e.currentTarget.style.boxShadow = "0 8px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(196,144,48,0.15)";
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

        {/* Logout */}
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex items-center gap-2 text-xs transition-colors duration-200"
          style={{ color: "#4A3020", fontFamily: "var(--font-sans)", letterSpacing: "0.04em" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "#8A5030"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "#4A3020"; }}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Sign Out
        </button>
      </div>
    </div>
  );
}
