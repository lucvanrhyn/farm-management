"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Icon } from "./icons";
import { Kbd } from "./primitives";

type Area = {
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  href: (slug: string) => string;
  is: (rest: string) => boolean;
};

// `rest` = pathname with the /{slug} prefix stripped (always starts with "/").
const AREAS: Area[] = [
  { key: "home", label: "Home", icon: Icon.home, href: (s) => `/${s}/home`, is: (r) => r.startsWith("/home") },
  {
    key: "admin",
    label: "Operations",
    icon: Icon.overview,
    href: (s) => `/${s}/admin`,
    is: (r) =>
      (r.startsWith("/admin") || r.startsWith("/sheep") || r.startsWith("/game") || r.startsWith("/tools")) &&
      !r.startsWith("/admin/einstein"),
  },
  { key: "logger", label: "Logger", icon: Icon.logger, href: (s) => `/${s}/logger`, is: (r) => r.startsWith("/logger") },
  { key: "map", label: "Map", icon: Icon.map, href: (s) => `/${s}/map`, is: (r) => r.startsWith("/map") },
  { key: "einstein", label: "Einstein", icon: Icon.einstein, href: (s) => `/${s}/admin/einstein`, is: (r) => r.startsWith("/admin/einstein") },
];

/** Routes where the dock would be noise (full-screen wizards / checkout). */
const HIDE_ON = ["/onboarding", "/subscribe"];

const GLASS = {
  background: "rgba(22,18,14,.84)",
  border: "1px solid rgba(255,235,210,.14)",
  backdropFilter: "blur(18px) saturate(150%)",
  WebkitBackdropFilter: "blur(18px) saturate(150%)",
} as const;

export function AreaDock() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const segs = pathname.split("/");
  const slug = segs[1] || "";
  const rest = "/" + segs.slice(2).join("/");

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onEsc);
    };
  }, []);

  // Close the menu after navigation.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  if (!slug || HIDE_ON.some((p) => rest.startsWith(p))) return null;

  const current = AREAS.find((a) => a.is(rest)) ?? AREAS[1];
  const CurrentIcon = current.icon;

  return (
    <div
      ref={ref}
      style={{ position: "fixed", right: 20, bottom: 20, zIndex: 80, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}
    >
      {open && (
        <div
          className="ft-modal-in"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 5,
            padding: 7,
            borderRadius: 18,
            color: "#F2EADC",
            boxShadow: "0 22px 54px -16px rgba(0,0,0,.62)",
            ...GLASS,
          }}
        >
          <div className="ft-mono" style={{ fontSize: 9, letterSpacing: ".18em", color: "rgba(242,234,220,.6)", padding: "4px 10px 2px" }}>
            JUMP TO
          </div>
          {AREAS.map((a) => {
            const active = a.key === current.key;
            const AIcon = a.icon;
            return (
              <button
                key={a.key}
                onClick={() => router.push(a.href(slug))}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  minWidth: 162,
                  padding: "9px 14px 9px 11px",
                  borderRadius: 12,
                  border: 0,
                  cursor: "pointer",
                  background: active ? "var(--ft-accent)" : "transparent",
                  color: active ? "#fff" : "#F2EADC",
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.background = "rgba(255,235,210,.09)";
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.background = "transparent";
                }}
              >
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 8,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: active ? "rgba(255,255,255,.18)" : "rgba(255,235,210,.07)",
                    color: active ? "#fff" : "var(--ft-accent)",
                  }}
                >
                  <AIcon size={15} />
                </span>
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: 500 }}>{a.label}</span>
                {active && <span style={{ width: 6, height: 6, borderRadius: 999, background: "#fff" }} />}
              </button>
            );
          })}
          <div style={{ height: 1, background: "rgba(255,235,210,.12)", margin: "3px 8px" }} />
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("farmtrack-cmdk"))}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 11,
              minWidth: 162,
              padding: "9px 14px 9px 11px",
              borderRadius: 12,
              border: 0,
              cursor: "pointer",
              background: "transparent",
              color: "#F2EADC",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,235,210,.09)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <span style={{ width: 26, height: 26, borderRadius: 8, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "rgba(255,235,210,.07)", color: "var(--ft-accent)" }}>
              <Icon.search size={15} />
            </span>
            <span style={{ flex: 1, fontSize: 13.5, fontWeight: 500 }}>Search</span>
            <Kbd>⌘K</Kbd>
          </button>
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Switch area"
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          height: 50,
          padding: "0 16px 0 10px",
          borderRadius: 999,
          cursor: "pointer",
          color: "#F2EADC",
          boxShadow: "0 12px 34px -10px rgba(0,0,0,.55)",
          ...GLASS,
        }}
      >
        <span style={{ width: 32, height: 32, borderRadius: 10, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "var(--ft-accent)", color: "#fff" }}>
          <CurrentIcon size={18} />
        </span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{current.label}</span>
        <span style={{ color: "rgba(242,234,220,.6)", transform: open ? "rotate(180deg)" : "none", transition: "transform .2s", display: "inline-flex" }}>
          <Icon.chevronD size={15} />
        </span>
      </button>
    </div>
  );
}
