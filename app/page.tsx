"use client";

import Link from "next/link";
import { BookCheck, MapPin, Settings2 } from "lucide-react";
import { AnimatedHero } from "@/components/ui/animated-hero";

const CARDS = [
  {
    href: "/logger",
    title: "Logger",
    description: "Daaglikse veld logging, dier-insidente en kamp-toestand.",
    user: "Dicky",
    icon: BookCheck,
    iconColor: "#D46830",
    iconBg: "rgba(212,104,48,0.12)",
    cardBg: "rgba(15,6,2,0.92)",
    borderDefault: "#2A120A",
    userColor: "#D46830",
    userBg: "rgba(212,104,48,0.12)",
    descColor: "#7A5840",
  },
  {
    href: "/dashboard",
    title: "Map Hub",
    description: "Interaktiewe plaaskaart, kamp-status en dier-profiele.",
    user: "Bestuur",
    icon: MapPin,
    iconColor: "#C49030",
    iconBg: "rgba(196,144,48,0.12)",
    cardBg: "rgba(12,9,2,0.92)",
    borderDefault: "#221808",
    userColor: "#C49030",
    userBg: "rgba(196,144,48,0.12)",
    descColor: "#7A6030",
  },
  {
    href: "/admin",
    title: "Admin",
    description: "Data-oorsig, 978 dier-rekords en kamp-konfigurasie.",
    user: "Luc",
    icon: Settings2,
    iconColor: "#A08060",
    iconBg: "rgba(160,128,96,0.12)",
    cardBg: "rgba(9,6,3,0.92)",
    borderDefault: "#1A1208",
    userColor: "#A08060",
    userBg: "rgba(160,128,96,0.12)",
    descColor: "#6A5840",
  },
] as const;

export default function Home() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-between py-12 px-5 relative overflow-hidden"
      style={{
        backgroundImage: 'url("/brangus.jpg")',
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >

      {/* Gradient overlay — dark at top/bottom, minimal at center */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, rgba(8,5,2,0.68) 0%, rgba(8,5,2,0.22) 45%, rgba(8,5,2,0.60) 100%)",
          zIndex: 1,
        }}
      />

      {/* Main content */}
      <div className="relative flex flex-col items-center gap-16 w-full max-w-4xl" style={{ zIndex: 10 }}>
        {/* Hero — frosted glass panel */}
        <div className="pt-8 w-full flex justify-center">
          <div
            className="rounded-3xl px-10 py-8"
            style={{
              background: "rgba(5,3,1,0.50)",
              backdropFilter: "blur(6px)",
              WebkitBackdropFilter: "blur(6px)",
              border: "1px solid rgba(255,255,255,0.07)",
            }}
          >
            <AnimatedHero />
          </div>
        </div>

        {/* Role cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 w-full">
          {CARDS.map(
            ({
              href,
              title,
              description,
              user,
              icon: Icon,
              iconColor,
              iconBg,
              cardBg,
              borderDefault,
              userColor,
              userBg,
              descColor,
            }) => (
              <Link key={href} href={href} className="group block">
                <div
                  className="rounded-2xl p-6 flex flex-col gap-5 h-full relative transition-transform duration-200 group-hover:-translate-y-1"
                  style={{
                    background: cardBg,
                    border: `1px solid ${borderDefault}`,
                    boxShadow: "0 4px 24px rgba(0,0,0,0.35)",
                  }}
                >
                  {/* Traveling animated dot */}
                  <div
                    className="w-2.5 h-2.5 rounded-full absolute"
                    style={{
                      zIndex: 10,
                      backgroundColor: "currentColor",
                      color: iconColor,
                      boxShadow: "0 0 10px currentColor",
                      animation:
                        "border-follow 6s linear infinite, color-change 6s linear infinite",
                    }}
                  />
                  {/* Cycling animated border */}
                  <div
                    className="absolute inset-0 rounded-2xl pointer-events-none"
                    style={{
                      border: "1px solid",
                      animation: "border-color-change 6s linear infinite",
                    }}
                  />

                  {/* Icon */}
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center"
                    style={{ background: iconBg }}
                  >
                    <Icon size={22} style={{ color: iconColor }} strokeWidth={1.75} />
                  </div>

                  {/* Text */}
                  <div className="flex-1">
                    <h2
                      className="text-lg font-bold mb-1.5"
                      style={{
                        color: "#F0DEB8",
                        fontFamily: "var(--font-display)",
                        letterSpacing: "0.01em",
                      }}
                    >
                      {title}
                    </h2>
                    <p
                      className="text-sm leading-relaxed"
                      style={{ color: descColor, fontFamily: "var(--font-sans)" }}
                    >
                      {description}
                    </p>
                  </div>

                  {/* User badge */}
                  <div className="flex items-center justify-between">
                    <span
                      className="text-xs px-2.5 py-1 rounded-full font-medium"
                      style={{
                        background: userBg,
                        color: userColor,
                        fontFamily: "var(--font-sans)",
                      }}
                    >
                      {user}
                    </span>
                    <span style={{ color: "rgba(255,255,255,0.18)" }} className="text-lg">
                      →
                    </span>
                  </div>
                </div>
              </Link>
            ),
          )}
        </div>
      </div>

      {/* Footer */}
      <footer
        className="mt-12 text-xs text-center"
        style={{ color: "#6A4A28", fontFamily: "var(--font-sans)", zIndex: 10, position: "relative" }}
      >
        © {new Date().getFullYear()} Trio B Boerdery CC · v0.1.0
      </footer>
    </div>
  );
}
