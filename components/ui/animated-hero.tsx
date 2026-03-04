"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";

const AFRIKAANS_MONTHS = [
  "Januarie", "Februarie", "Maart", "April", "Mei", "Junie",
  "Julie", "Augustus", "September", "Oktober", "November", "Desember",
];

const AFRIKAANS_DAYS = [
  "Sondag", "Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrydag", "Saterdag",
];

function formatAfrikaansDate(date: Date): string {
  return `${AFRIKAANS_DAYS[date.getDay()]}, ${date.getDate()} ${AFRIKAANS_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

function getGreeting(hour: number): { text: string; icon: string } {
  if (hour < 12) return { text: "Goeie more", icon: "🌅" };
  if (hour < 17) return { text: "Goeie middag", icon: "☀️" };
  return { text: "Goeie aand", icon: "🌙" };
}

export function AnimatedHero() {
  const [wordIndex, setWordIndex] = useState(0);
  const [mounted, setMounted] = useState(false);

  const words = useMemo(
    () => ["Opgespoor", "Bestuur", "Gemonitor", "Versorg", "Slagbaar"],
    [],
  );

  useEffect(() => {
    setMounted(true);
    const interval = setInterval(() => {
      setWordIndex((i) => (i + 1) % words.length);
    }, 2500);
    return () => clearInterval(interval);
  }, [words.length]);

  const now = new Date();
  const greeting = getGreeting(now.getHours());
  const dateStr = formatAfrikaansDate(now);

  return (
    <div className="flex flex-col items-center text-center gap-3">
      {/* Greeting + date */}
      {mounted && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex items-center gap-2 text-sm"
          style={{
            color: "#B09878",
            fontFamily: "var(--font-sans)",
            textShadow: "0 1px 8px rgba(0,0,0,0.8)",
          }}
        >
          <span>{greeting.icon}</span>
          <span>{greeting.text}</span>
          <span style={{ color: "#6A5038" }}>·</span>
          <span>{dateStr}</span>
        </motion.div>
      )}

      {/* Farm name */}
      <motion.h1
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.1 }}
        style={{
          fontFamily: "var(--font-display)",
          color: "#F5EBD4",
          letterSpacing: "0.06em",
          lineHeight: 1.1,
          textShadow: "0 2px 20px rgba(0,0,0,0.9)",
        }}
        className="text-5xl md:text-7xl font-bold uppercase"
      >
        Delta Livestock
      </motion.h1>

      {/* Subtitle */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.25 }}
        style={{
          color: "#C4A870",
          fontFamily: "var(--font-sans)",
          textShadow: "0 1px 12px rgba(0,0,0,0.8)",
        }}
        className="text-sm md:text-base tracking-widest uppercase font-light"
      >
        Brangus Farm Management System
      </motion.p>

      {/* Animated slogan */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.4 }}
        className="mt-4 flex flex-col items-center gap-1"
      >
        <span
          style={{
            color: "#9A8060",
            fontFamily: "var(--font-sans)",
            textShadow: "0 1px 8px rgba(0,0,0,0.7)",
          }}
          className="text-sm tracking-wide"
        >
          Jou plaas is altyd —
        </span>
        <div className="relative h-14 flex items-center justify-center overflow-hidden w-72">
          {words.map((word, index) => (
            <motion.span
              key={word}
              className="absolute font-semibold"
              style={{
                fontFamily: "var(--font-display)",
                color: "#D46830",
                fontSize: "2rem",
                letterSpacing: "0.03em",
                textShadow: "0 2px 16px rgba(0,0,0,0.9)",
              }}
              initial={{ opacity: 0, y: 40 }}
              transition={{ type: "spring", stiffness: 60, damping: 15 }}
              animate={
                wordIndex === index
                  ? { y: 0, opacity: 1 }
                  : { y: wordIndex > index ? -60 : 60, opacity: 0 }
              }
            >
              {word}
            </motion.span>
          ))}
        </div>
      </motion.div>

      {/* Info pill */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.6 }}
        className="mt-1 px-4 py-1.5 rounded-full text-xs tracking-wider"
        style={{
          background: "rgba(4,2,1,0.50)",
          border: "1px solid rgba(255,255,255,0.10)",
          color: "#9A8060",
          fontFamily: "var(--font-sans)",
        }}
      >
        Brangus · 978 diere · 19 kampe
      </motion.div>
    </div>
  );
}
