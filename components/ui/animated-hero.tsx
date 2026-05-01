"use client";

import { useEffect, useMemo, useState } from "react";
import { clientLogger } from "@/lib/client-logger";

interface FarmStats {
  farmName: string;
  breed: string;
  animalCount: number;
  campCount: number;
  heroImageUrl?: string;
}

// Phase M.2: framer-motion was previously imported here, pulling ~40 KB of
// animation runtime into /home's initial JS graph. Phase M dynamic-split
// HomeSectionGrid but missed this component, which app/[farmSlug]/home/page.tsx
// renders directly. The animations were all simple entrance fades/slides plus
// a word-rotator — all expressible as CSS keyframes/transitions. See the
// `.hero-anim-*` and `.hero-word` rules in app/globals.css.

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

function wordState(
  wordIndex: number,
  activeIndex: number,
): "active" | "above" | "below" {
  if (wordIndex === activeIndex) return "active";
  return activeIndex > wordIndex ? "above" : "below";
}

export function AnimatedHero({
  farmSlug,
  onHeroImageLoad,
}: {
  farmSlug?: string;
  onHeroImageLoad?: (url: string) => void;
}) {
  const [wordIndex, setWordIndex] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [farm, setFarm] = useState<FarmStats | null>(null);

  const words = useMemo(
    () => ["Tracked", "Managed", "Monitored", "Cared For", "Profitable"],
    [],
  );

  // Slogan word rotator + mounted flag are tenant-independent — kept in
  // their own effect so navigating tenants doesn't restart the animation.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    const interval = setInterval(() => {
      setWordIndex((i) => (i + 1) % words.length);
    }, 2500);
    return () => clearInterval(interval);
  }, [words.length]);

  // Tenant fetch — refires on farmSlug change so the parent's reset hero
  // (see app/[farmSlug]/home/page.tsx, refs #24) is re-populated under the
  // new tenant. /api/farm reads the current tenant from session/proxy
  // headers; including farmSlug in deps is the trigger, not part of the
  // URL. Title / breed / animal-count surfaces still update only when
  // this fetch resolves (a separate follow-up tracks resetting them
  // synchronously on slug change).
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/farm", { signal: controller.signal })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) {
          setFarm(data);
          if (data.heroImageUrl) onHeroImageLoad?.(data.heroImageUrl);
        }
      })
      .catch((err) => { if (err?.name !== "AbortError") clientLogger.error("[animated-hero] fetch failed", { err }); });
    return () => controller.abort();
    // onHeroImageLoad intentionally excluded — parent re-creates it each
    // render; including it would refetch on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [farmSlug]);

  const now = new Date();
  const greeting = getGreeting(now.getHours());
  const dateStr = formatEnglishDate(now);

  return (
    <div className="flex flex-col items-center text-center gap-3">
      {/* Greeting + date */}
      {mounted && (
        <div
          className="hero-anim-greeting flex items-center gap-2 text-sm"
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
        </div>
      )}

      {/* Farm name */}
      <h1
        className="hero-anim-title text-5xl md:text-7xl font-bold uppercase"
        style={{
          fontFamily: "var(--font-display)",
          color: "#F5EBD4",
          letterSpacing: "0.06em",
          lineHeight: 1.1,
          textShadow: "0 2px 20px rgba(0,0,0,0.9)",
        }}
      >
        {farm?.farmName ?? "—"}
      </h1>

      {/* Subtitle */}
      <p
        className="hero-anim-subtitle text-sm md:text-base tracking-widest uppercase font-light"
        style={{
          color: "#C4A870",
          fontFamily: "var(--font-sans)",
          textShadow: "0 1px 12px rgba(0,0,0,0.8)",
        }}
      >
        {farm ? `${farm.breed} Farm Management System` : "Farm Management System"}
      </p>

      {/* Animated slogan */}
      <div className="hero-anim-slogan mt-4 flex flex-col items-center gap-1">
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
            <span
              key={word}
              data-state={wordState(index, wordIndex)}
              className="hero-word absolute font-semibold"
              style={{
                fontFamily: "var(--font-display)",
                color: "#D46830",
                fontSize: "2rem",
                letterSpacing: "0.03em",
                textShadow: "0 2px 16px rgba(0,0,0,0.9)",
              }}
            >
              {word}
            </span>
          ))}
        </div>
      </div>

      {/* Info pill */}
      <div
        className="hero-anim-pill mt-1 px-4 py-1.5 rounded-full text-xs tracking-wider"
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
      </div>
    </div>
  );
}
