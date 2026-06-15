"use client";

/**
 * HomePortal — the dark "Operations hub" landing portal.
 *
 * One entry surface, four destinations:
 *   ADMIN → Operations · LOGGER → Camp Rounds · EINSTEIN → AI Advisor · MAP → Farm Map
 *
 * Responsive (CSS, not a device toggle):
 *   - desktop (>620px) → "centered" editorial layout: brand top-left, greeting
 *     top-right, giant Fraunces farm-name headline, glass stat pill, optional
 *     Cattle/Sheep mode toggle, a 4-column destination card grid, status footer.
 *   - mobile (<=620px) → "stack" layout: compact header, Einstein brief peek,
 *     four full-width rows, and a sticky bottom tab bar.
 *
 * Einstein (AI Advisor) opens an IN-PLACE chat overlay (onAskEinstein) and does
 * NOT navigate. All real farm data (name, breed, owner, counts, mode) is passed
 * in from HomePageClient — this is a presentation component only.
 */

import { useMemo, useState } from "react";
import { Icon } from "@/components/ds";
import type { FarmMode } from "@/lib/farm-mode";
import { useAssistantName } from "@/hooks/useAssistantName";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HomeDestination {
  key: "admin" | "logger" | "einstein" | "map";
  Icon: (typeof Icon)[keyof typeof Icon];
  label: string;
  title: string;
  subtitle: string;
  stat: string;
  /** Navigation path (relative to farm slug); omitted for the AI overlay. */
  path?: string;
  featured?: boolean;
  ai?: boolean;
}

export interface HomePortalProps {
  farmName: string;
  breed: string;
  owner: string;
  animalCount: number;
  campCount: number;
  /** Sub-labels adapt per species mode (set by HomePageClient). */
  sections: { admin: string; logger: string; map: string };
  /** Multi-species mode toggle wiring (real FarmMode state). */
  mode: FarmMode;
  isMultiMode: boolean;
  onSetMode: (mode: FarmMode) => void;
  /** Navigate to a destination path (farm-scoped router push). */
  onNavigate: (path: string) => void;
  /** Open the in-place Einstein chat overlay (no navigation). */
  onAskEinstein: () => void;
  /** Sign the user out. */
  onSignOut: () => void;
}

// Einstein morning brief (static demo — Home has no live brief source yet).
const BRIEF: ReadonlyArray<readonly [string, string]> = [
  ["Move Camp H mob — water empty", "var(--ft-poor)"],
  ["VR-014 thin in B1 — pull to kraal", "var(--ft-fair)"],
  ["3 cows clear withdrawal Saturday", "var(--ft-info)"],
];

const ENGLISH_DAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];
const ENGLISH_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatDate(d: Date): string {
  return `${ENGLISH_DAYS[d.getDay()]}, ${d.getDate()} ${ENGLISH_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** Split a farm name so the last word renders italic + accent. */
function splitName(name: string): { head: string; tail: string } {
  const trimmed = name.trim();
  const idx = trimmed.lastIndexOf(" ");
  if (idx === -1) return { head: "", tail: trimmed };
  return { head: trimmed.slice(0, idx), tail: trimmed.slice(idx + 1) };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function BrandMark() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
      <div
        style={{
          width: 34, height: 34, borderRadius: 10, background: "var(--ft-accent)",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "#fff", flexShrink: 0,
        }}
      >
        <Icon.cattle size={20} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
        <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: ".01em", color: "var(--ft-text)" }}>
          FarmTrack
        </span>
        <span
          className="ft-mono"
          style={{ fontSize: 10, color: "var(--ft-subtle)", marginTop: 4, letterSpacing: ".12em" }}
        >
          v2.0 · TRIO B
        </span>
      </div>
    </div>
  );
}

function GreetChip({ firstName, hour, date }: { firstName: string; hour: number; date: string }) {
  const GI = hour < 6 || hour >= 19 ? Icon.moon : Icon.sun;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11, fontSize: 13, color: "var(--ft-muted)" }}>
      <GI size={16} />
      <span>{greetingFor(hour)}{firstName ? `, ${firstName}` : ""}</span>
      <span style={{ color: "var(--ft-subtle)" }}>·</span>
      <span className="ft-mono">{date}</span>
    </div>
  );
}

function StatPill({ breed, animalCount, campCount }: { breed: string; animalCount: number; campCount: number }) {
  return (
    <div
      style={{
        display: "inline-flex", alignItems: "center", gap: 12, padding: "10px 18px",
        background: "var(--ft-surface)", border: "1px solid var(--ft-border)",
        borderRadius: 999, backdropFilter: "blur(8px)",
      }}
    >
      <span className="ft-mono" style={{ fontSize: 12, color: "var(--ft-muted)" }}>{breed}</span>
      <span style={{ color: "var(--ft-subtle)" }}>·</span>
      <span className="ft-mono ft-tabnums" style={{ fontSize: 12, color: "var(--ft-text)" }}>
        {animalCount.toLocaleString()} animals
      </span>
      <span style={{ color: "var(--ft-subtle)" }}>·</span>
      <span className="ft-mono ft-tabnums" style={{ fontSize: 12, color: "var(--ft-text)" }}>
        {campCount} camps
      </span>
    </div>
  );
}

function StatusFooter({ owner, onSignOut }: { owner: string; onSignOut: () => void }) {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", justifyContent: "center", flexWrap: "wrap",
        gap: 15, color: "var(--ft-muted)", fontSize: 13,
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 7, height: 7, borderRadius: 999, background: "#5DBB6B", boxShadow: "0 0 12px #5DBB6B" }} />
        Online
      </span>
      <span style={{ color: "var(--ft-subtle)" }}>·</span>
      <span>Synced just now</span>
      <span style={{ color: "var(--ft-subtle)" }}>·</span>
      <span>{owner}</span>
      <span style={{ color: "var(--ft-subtle)" }}>·</span>
      <button
        type="button"
        onClick={onSignOut}
        className="ft-btn-ghost"
        style={{
          display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 8px",
          borderRadius: 6, color: "var(--ft-muted)", cursor: "pointer",
          background: "transparent", border: "1px solid transparent",
        }}
      >
        <Icon.signout size={14} /> Sign out
      </button>
    </div>
  );
}

function cardBg(d: HomeDestination): string {
  if (d.ai) return "linear-gradient(150deg, color-mix(in oklab, var(--ft-accent) 20%, var(--ft-surface)), var(--ft-surface))";
  if (d.featured) return "color-mix(in oklab, var(--ft-accent) 13%, var(--ft-surface))";
  return "var(--ft-surface)";
}
function cardBorder(d: HomeDestination): string {
  return d.ai || d.featured ? "color-mix(in oklab, var(--ft-accent) 45%, transparent)" : "var(--ft-border)";
}

/** Desktop destination tile. */
function DestCardBlock({ d, onActivate }: { d: HomeDestination; onActivate: () => void }) {
  const [hover, setHover] = useState(false);
  const accenty = d.featured || d.ai;
  return (
    <button
      type="button"
      onClick={onActivate}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative", padding: "30px 26px", textAlign: "left", cursor: "pointer",
        background: cardBg(d), border: `1px solid ${cardBorder(d)}`, borderRadius: 18,
        color: "var(--ft-text)", transition: "transform .25s ease, background .25s ease",
        transform: hover ? "translateY(-3px)" : "none", backdropFilter: "blur(8px)", height: "100%",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", color: "var(--ft-accent)" }}>
        <d.Icon size={26} />
        <Icon.chevron size={16} />
      </div>
      <div className="ft-mono" style={{ fontSize: 10, letterSpacing: ".2em", color: "var(--ft-subtle)", marginTop: 26 }}>
        {d.label}
      </div>
      <div className="ft-serif" style={{ fontSize: 28, marginTop: 4, lineHeight: 1.1 }}>{d.title}</div>
      <div style={{ fontSize: 13, color: "var(--ft-muted)", marginTop: 4 }}>{d.subtitle}</div>
      <div
        className="ft-mono"
        style={{
          marginTop: 22, paddingTop: 14, borderTop: "1px dashed var(--ft-border)",
          fontSize: 12, color: accenty ? "var(--ft-accent)" : "var(--ft-muted)",
        }}
      >
        {d.stat}
      </div>
    </button>
  );
}

/** Mobile full-width destination row. */
function PhoneRow({ d, onActivate }: { d: HomeDestination; onActivate: () => void }) {
  const accenty = d.featured || d.ai;
  const pct = Math.round((4 / 19) * 100);
  return (
    <button
      type="button"
      onClick={onActivate}
      style={{
        display: "flex", alignItems: "center", gap: 14, width: "100%", textAlign: "left", cursor: "pointer",
        padding: "15px 16px", minHeight: 80, borderRadius: 17, color: "var(--ft-text)",
        background: cardBg(d), border: `1px solid ${cardBorder(d)}`,
      }}
    >
      <div
        style={{
          width: 46, height: 46, borderRadius: 13, flexShrink: 0, display: "flex",
          alignItems: "center", justifyContent: "center",
          background: accenty ? "var(--ft-accent)" : "var(--ft-surface2)",
          color: accenty ? "#fff" : "var(--ft-accent)",
        }}
      >
        <d.Icon size={24} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="ft-mono" style={{ fontSize: 9.5, letterSpacing: ".18em", color: "var(--ft-subtle)" }}>
          {d.label}
        </div>
        <div className="ft-serif" style={{ fontSize: 21, lineHeight: 1.05, marginTop: 1 }}>{d.title}</div>
        {d.key === "logger" ? (
          <div style={{ marginTop: 7, height: 5, borderRadius: 999, background: "var(--ft-surface2)", overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: "var(--ft-accent)" }} />
          </div>
        ) : (
          <div className="ft-mono" style={{ fontSize: 11, color: accenty ? "var(--ft-accent)" : "var(--ft-muted)", marginTop: 3 }}>
            {d.stat}
          </div>
        )}
      </div>
      {d.ai ? (
        <span
          className="ft-mono"
          style={{ fontSize: 10.5, padding: "6px 11px", borderRadius: 999, background: "var(--ft-accent)", color: "#fff", flexShrink: 0 }}
        >
          Chat
        </span>
      ) : (
        <Icon.chevron size={18} style={{ color: "var(--ft-accent)", flexShrink: 0 }} />
      )}
    </button>
  );
}

/** Compact Einstein brief peek (mobile). */
function PhoneBriefPeek({ onAskEinstein }: { onAskEinstein: () => void }) {
  const assistantName = useAssistantName();
  return (
    <button
      type="button"
      onClick={onAskEinstein}
      className="ft-brief"
      style={{
        textAlign: "left", cursor: "pointer", width: "100%", borderRadius: 16, padding: "14px 16px",
        color: "var(--ft-text)", background: "var(--ft-surface)", border: "1px solid var(--ft-border)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div className="ft-mono" style={{ fontSize: 9.5, letterSpacing: ".16em", color: "var(--ft-subtle)" }}>
          TODAY&apos;S BRIEF · 06:00
        </div>
        <span className="ft-mono" style={{ fontSize: 10.5, color: "var(--ft-accent)" }}>Ask {assistantName} →</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
        {BRIEF.map(([txt, c]) => (
          <div key={txt} style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 12.5, color: "var(--ft-muted)", lineHeight: 1.5 }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, marginTop: 5, flexShrink: 0, background: c }} />
            <span>{txt}</span>
          </div>
        ))}
      </div>
    </button>
  );
}

/** Sticky bottom tab bar (mobile). */
function PhoneTabBar({
  onNavigate,
  onAskEinstein,
}: {
  onNavigate: (path: string) => void;
  onAskEinstein: () => void;
}) {
  const assistantName = useAssistantName();
  const items: ReadonlyArray<{ Ico: HomeDestination["Icon"]; label: string; fn: () => void }> = [
    { Ico: Icon.overview, label: "Admin", fn: () => onNavigate("/admin") },
    { Ico: Icon.logger, label: "Logger", fn: () => onNavigate("/logger") },
    { Ico: Icon.einstein, label: assistantName, fn: onAskEinstein },
    { Ico: Icon.map, label: "Map", fn: () => onNavigate("/map") },
  ];
  return (
    <div
      className="ft-home-tabbar"
      style={{
        position: "sticky", bottom: 0, display: "grid", gridTemplateColumns: "repeat(4,1fr)",
        padding: "10px 6px 14px", background: "color-mix(in oklab, var(--ft-surface2) 86%, transparent)",
        backdropFilter: "blur(14px)", borderTop: "1px solid var(--ft-border)",
      }}
    >
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          onClick={it.fn}
          style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
            color: "var(--ft-muted)", cursor: "pointer", background: "transparent", border: 0,
          }}
        >
          <it.Ico size={20} />
          <span style={{ fontSize: 10 }}>{it.label}</span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function HomePortal({
  farmName,
  breed,
  owner,
  animalCount,
  campCount,
  sections,
  mode,
  isMultiMode,
  onSetMode,
  onNavigate,
  onAskEinstein,
  onSignOut,
}: HomePortalProps) {
  const now = useMemo(() => new Date(), []);
  const hour = now.getHours();
  const date = useMemo(() => formatDate(now), [now]);
  const firstName = owner.trim().split(/\s+/)[0] ?? "";
  const { head, tail } = splitName(farmName);
  const assistantName = useAssistantName();

  const destinations: HomeDestination[] = useMemo(
    () => [
      {
        key: "admin", Icon: Icon.overview, label: "ADMIN", title: "Operations",
        subtitle: sections.admin, stat: `${animalCount.toLocaleString()} animals`, path: "/admin",
      },
      {
        key: "logger", Icon: Icon.logger, label: "LOGGER", title: "Camp Rounds",
        subtitle: sections.logger, stat: "4 of 19 done today", path: "/logger", featured: true,
      },
      {
        key: "einstein", Icon: Icon.einstein, label: assistantName.toUpperCase(), title: "AI Advisor",
        subtitle: "Ask anything · daily brief", stat: "3 items in today's brief", ai: true,
      },
      {
        key: "map", Icon: Icon.map, label: "MAP", title: "Farm Map",
        subtitle: sections.map, stat: `${campCount} camps`, path: "/map",
      },
    ],
    [sections, animalCount, campCount, assistantName],
  );

  const activate = (d: HomeDestination) => () => {
    if (d.ai) onAskEinstein();
    else if (d.path) onNavigate(d.path);
  };

  return (
    <div className="ft-home-root">
      {/* ---- desktop chrome (brand + greeting) ---- */}
      <header className="ft-home-brand">
        <BrandMark />
      </header>
      <div className="ft-home-greet">
        <GreetChip firstName={firstName} hour={hour} date={date} />
      </div>

      {/* ---- desktop centered column ---- */}
      <div className="ft-home-desktop">
        <div
          className="ft-mono"
          style={{ fontSize: 12, color: "var(--ft-accent)", letterSpacing: ".22em", textTransform: "uppercase", marginBottom: 24 }}
        >
          {breed} Farm Management System
        </div>
        <h1
          className="ft-serif ft-home-headline"
          style={{ fontWeight: 400, lineHeight: 0.95, margin: 0, letterSpacing: "-.04em", color: "var(--ft-text)" }}
        >
          {/* Keep the name a single contiguous text run (a real space, not <br>)
              so textContent stays "Head Tail"; the tail block-wraps to its own
              line visually via .ft-home-tail. */}
          {head && <>{head} </>}
          <span className="ft-home-tail" style={{ fontStyle: "italic", color: "var(--ft-accent)" }}>
            {tail}
          </span>
        </h1>

        <div style={{ marginTop: 30 }}>
          <StatPill breed={breed} animalCount={animalCount} campCount={campCount} />
        </div>

        {isMultiMode && (
          <div style={{ marginTop: 28, display: "flex", justifyContent: "center" }}>
            <div className="ft-segmented" role="tablist" aria-label="Species view">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "cattle"}
                className={mode === "cattle" ? "active" : ""}
                onClick={() => onSetMode("cattle")}
              >
                <Icon.cattle size={15} /> Cattle
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "sheep"}
                className={mode === "sheep" ? "active" : ""}
                onClick={() => onSetMode("sheep")}
              >
                <Icon.sheep size={15} /> Sheep
              </button>
            </div>
          </div>
        )}

        <div className="ft-home-grid">
          {destinations.map((d) => (
            <DestCardBlock key={d.key} d={d} onActivate={activate(d)} />
          ))}
        </div>

        <div style={{ marginTop: 44 }}>
          <StatusFooter owner={owner} onSignOut={onSignOut} />
        </div>
      </div>

      {/* ---- mobile stack ---- */}
      <div className="ft-home-mobile">
        <div className="ft-home-mobile-scroll">
          <div className="ft-home-mobile-header">
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  style={{
                    width: 26, height: 26, borderRadius: 8, background: "var(--ft-accent)",
                    display: "flex", alignItems: "center", justifyContent: "center", color: "#fff",
                  }}
                >
                  <Icon.cattle size={16} />
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ft-text)" }}>FarmTrack</span>
              </div>
              <div style={{ marginTop: 14 }}>
                <div className="ft-serif" style={{ fontSize: 26, lineHeight: 1.05, color: "var(--ft-text)", letterSpacing: "-.02em" }}>
                  {greetingFor(hour)}{firstName ? `, ${firstName}` : ""}
                </div>
                <div className="ft-mono" style={{ fontSize: 11, color: "var(--ft-subtle)", marginTop: 6 }}>
                  {breed} · {animalCount} animals · {campCount} camps
                </div>
              </div>
            </div>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--ft-muted)", whiteSpace: "nowrap" }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: "#5DBB6B", boxShadow: "0 0 8px #5DBB6B" }} />
              Online
            </span>
          </div>

          <PhoneBriefPeek onAskEinstein={onAskEinstein} />

          {destinations.map((d) => (
            <PhoneRow key={d.key} d={d} onActivate={activate(d)} />
          ))}
        </div>
        <PhoneTabBar onNavigate={onNavigate} onAskEinstein={onAskEinstein} />
      </div>

      <style>{HOME_CSS}</style>
    </div>
  );
}

const HOME_CSS = `
.ft-home-root {
  position: relative;
  min-height: 100vh;
  overflow-x: hidden;
  color: var(--ft-text);
  background:
    radial-gradient(ellipse 80% 60% at 72% -5%, rgba(46,125,114,.20), transparent 60%),
    radial-gradient(ellipse 70% 60% at 8% 100%, rgba(91,108,240,.14), transparent 55%),
    linear-gradient(180deg, #14110D 0%, #121814 100%);
}
.ft-home-brand { position: absolute; top: 32px; left: 36px; z-index: 2; }
.ft-home-greet { position: absolute; top: 35px; right: 36px; z-index: 2; }

.ft-home-desktop {
  max-width: 1200px; margin: 0 auto; padding: 140px 32px 72px;
  text-align: center; position: relative; z-index: 1;
}
.ft-home-headline { font-size: clamp(54px, 8.5vw, 118px); }
/* Tail word drops to its own line (the design's two-line treatment) while the
   markup keeps a contiguous "Head Tail" text run for accessibility/tests. */
.ft-home-tail { display: block; }
.ft-home-grid {
  margin: 56px auto 0; display: grid; grid-template-columns: repeat(4, 1fr);
  gap: 18px; max-width: 1120px;
}

/* mobile shell hidden on desktop */
.ft-home-mobile { display: none; }

@media (max-width: 920px) {
  .ft-home-grid { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 620px) {
  .ft-home-brand, .ft-home-greet, .ft-home-desktop { display: none; }
  .ft-home-mobile {
    display: flex; flex-direction: column; min-height: 100vh;
  }
  .ft-home-mobile-scroll {
    flex: 1; display: flex; flex-direction: column; gap: 14px;
    padding: 46px 16px 18px;
  }
  .ft-home-mobile-header {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;
  }
}
`;

export default HomePortal;
