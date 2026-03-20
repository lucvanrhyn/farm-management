"use client";

import { useEffect, useMemo, useState } from "react";

interface FarmStats {
  farmName: string;
  breed: string;
  animalCount: number;
  campCount: number;
}
import { motion } from "framer-motion";

const ENGLISH_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const ENGLISH_DAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

function formatEnglishDate(date: Date): string {
  return `${ENGLISH_DAYS[date.getDay()]}, ${date.getDate()} ${ENGLISH_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

function getGreeting(hour: number): { text: string; icon: string } {
  if (hour < 12) return { text: "Good morning", icon: "🌅" };
  if (hour < 17) return { text: "Good afternoon", icon: "☀️" };
  return { text: "Good evening", icon: "🌙" };
}

export function AnimatedHero() {
  const [wordIndex, setWordIndex] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [farm, setFarm] = useState<FarmStats | null>(null);

  const words = useMemo(
    () => ["Tracked", "Managed", "Monitored", "Cared For", "Profitable"],
    [],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    const interval = setInterval(() => {
      setWordIndex((i) => (i + 1) % words.length);
    }, 2500);
    fetch("/api/farm")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setFarm(data); })
      .catch(() => {});
    return () => clearInterval(interval);
  }, [words.length]);

  const now = new Date();
  const greeting = getGreeting(now.getHours());
  const dateStr = formatEnglishDate(now);

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
        {farm?.farmName ?? "—"}
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
        {farm ? `${farm.breed} Farm Management System` : "Farm Management System"}
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
          Your farm is always —
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
        {farm
          ? `${farm.breed} · ${farm.animalCount} animals · ${farm.campCount} camps`
          : "Loading…"}
      </motion.div>
    </div>
  );
}
