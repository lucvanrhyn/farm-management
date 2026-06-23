"use client";

/**
 * HomePortal — the light "cream" landing portal (locked homeTheme: cream).
 *
 * One entry surface, four destinations:
 *   ADMIN → Operations · LOGGER → Camp Rounds · EINSTEIN → AI Advisor · MAP → Farm Map
 *
 * Responsive (CSS, not a device toggle) — the two locked frozen layouts:
 *   - desktop (>620px) → "rail" layout (home.jsx HomeRail → desk_4.jpg): a
 *     330px masthead aside (brand, "{breed} FMS" eyebrow, giant DM-Serif
 *     farm-name headline, BREED/ANIMALS/CAMPS/OWNER definition list, status
 *     footer) beside a flexible column of four destination rows (each with a
 *     200px image slot). Collapses to a single stacked column at <=920px — the
 *     width the desk_4.jpg masthead crop was captured at.
 *   - mobile (<=620px) → "cover" layout (home.jsx PhoneCover → phone_1.jpg):
 *     compact header, a cover image with the farm headline overlaid, four
 *     full-width rows, and a sticky bottom tab bar.
 *
 * Einstein (AI Advisor) opens an IN-PLACE chat overlay (onAskEinstein) and does
 * NOT navigate. All real farm data (name, breed, owner, counts, mode) is passed
 * in from HomePageClient — this is a presentation component only.
 */

import { useMemo, useState } from "react";
import { useClientTime } from "@/lib/hooks/use-client-time";
import { formatNumber } from "@/lib/format/locale";
import { Icon, Card, Kbd } from "@/components/ds";
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

function GreetChip({ firstName, hour, date, greeting }: { firstName: string; hour: number; date: string; greeting: string }) {
  const GI = hour < 6 || hour >= 19 ? Icon.moon : Icon.sun;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11, fontSize: 13, color: "var(--ft-muted)" }}>
      <GI size={16} />
      <span>{greeting}{firstName ? `, ${firstName}` : ""}</span>
      <span style={{ color: "var(--ft-subtle)" }}>·</span>
      <span className="ft-mono">{date}</span>
    </div>
  );
}

/**
 * Definition list of the four farm facts (BREED / ANIMALS / CAMPS / OWNER) —
 * the `rail` masthead's signature block (home.jsx StatLine). Mono-uppercase
 * label left (.ft-label), Space-Mono value right-aligned, a dashed divider
 * above every row (top dashed border + a dashed rule between rows). Matches
 * desk_4.jpg: full-width rows, values flush right.
 */
function StatList({
  breed,
  animalCount,
  campCount,
  owner,
}: {
  breed: string;
  animalCount: number;
  campCount: number;
  owner: string;
}) {
  const rows: ReadonlyArray<{ label: string; value: string; tabnums?: boolean }> = [
    { label: "Breed", value: breed },
    { label: "Animals", value: formatNumber(animalCount), tabnums: true },
    { label: "Camps", value: formatNumber(campCount), tabnums: true },
    { label: "Owner", value: owner },
  ];
  return (
    <dl style={{ width: "100%", margin: 0, borderTop: "1px dashed var(--ft-border)" }}>
      {rows.map((r) => (
        <div
          key={r.label}
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: 16, padding: "12px 0", borderBottom: "1px dashed var(--ft-border)",
          }}
        >
          <dt className="ft-label" style={{ margin: 0, color: "var(--ft-subtle)" }}>{r.label}</dt>
          <dd
            className={`ft-mono${r.tabnums ? " ft-tabnums" : ""}`}
            style={{ margin: 0, fontSize: 13, color: "var(--ft-text)", textAlign: "right", lineHeight: 1.3 }}
          >
            {r.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Masthead footer block (home.jsx `rail` aside foot): the GreetChip line, the
 * status row (Online · Synced · owner · Sign out) and the ⌘K hint, stacked and
 * left-aligned. Matches the bottom of desk_4.jpg.
 */
function StatusFooter({
  owner,
  firstName,
  hour,
  date,
  greeting,
  onSignOut,
}: {
  owner: string;
  firstName: string;
  hour: number;
  date: string;
  greeting: string;
  onSignOut: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 16 }}>
      <GreetChip firstName={firstName} hour={hour} date={date} greeting={greeting} />
      {/* status row */}
      <div
        style={{
          display: "flex", alignItems: "center", flexWrap: "wrap",
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
      <div className="ft-mono" style={{ fontSize: 11, color: "var(--ft-subtle)", display: "inline-flex", alignItems: "center", gap: 7 }}>
        Press <Kbd>⌘K</Kbd> anywhere to jump
      </div>
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

/**
 * Image placeholder slot (home.jsx ImageSlot, "dashed" treatment for cream).
 * A surface panel with a dashed inner border, a centered muted photo glyph, and
 * a bottom-left mono caption chip. Used by the desktop DestRow (200px wide).
 */
function ImageSlot({
  label,
  height = 92,
  radius = 12,
  width,
}: {
  label: string;
  height?: number;
  radius?: number;
  width?: number;
}) {
  return (
    <div
      style={{
        position: "relative", borderRadius: radius, overflow: "hidden", height, width,
        background: "var(--ft-surface)", border: "1.5px dashed var(--ft-border)",
        display: "flex", alignItems: "flex-end", flexShrink: 0,
      }}
    >
      <div
        style={{
          position: "absolute", inset: 0, display: "flex", alignItems: "center",
          justifyContent: "center", color: "var(--ft-subtle)",
        }}
      >
        <Icon.image size={Math.min(34, Math.round(height * 0.32))} />
      </div>
      <div
        className="ft-mono"
        style={{
          position: "relative", margin: 12, padding: "4px 10px", borderRadius: 999,
          fontSize: 10.5, letterSpacing: ".06em", fontWeight: 500,
          background: "rgba(255,255,255,.7)", color: "rgba(40,30,20,.7)",
          backdropFilter: "blur(6px)", border: ".5px solid rgba(0,0,0,.06)",
          maxWidth: "calc(100% - 24px)", overflow: "hidden", textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </div>
    </div>
  );
}

/**
 * Desktop destination row (home.jsx `rail` DestRow withImage). A wide retro
 * card laid out as a 5-track grid: icon box · text block · stat · 200px image ·
 * chevron. Logger (featured) + AI Advisor (ai) get the accent surface/icon.
 * Matches the right column of the desktop `rail` reference.
 */
function DestRow({ d, onActivate }: { d: HomeDestination; onActivate: () => void }) {
  const [hover, setHover] = useState(false);
  const accenty = d.featured || d.ai;
  return (
    <button
      type="button"
      onClick={onActivate}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="ft-home-destrow"
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto 200px auto",
        alignItems: "center", gap: 22, width: "100%", textAlign: "left", cursor: "pointer",
        padding: 16, background: cardBg(d), border: `1px solid ${cardBorder(d)}`,
        borderRadius: 18, color: "var(--ft-text)",
        transition: "transform .2s ease, background .2s ease",
        transform: hover ? "translateX(5px)" : "none",
      }}
    >
      <div
        style={{
          width: 54, height: 54, borderRadius: 14, display: "flex", alignItems: "center",
          justifyContent: "center", flexShrink: 0,
          background: accenty ? "var(--ft-accent)" : "var(--ft-surface2)",
          color: accenty ? "#fff" : "var(--ft-accent)",
        }}
      >
        <d.Icon size={26} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="ft-mono" style={{ fontSize: 10, letterSpacing: ".2em", color: "var(--ft-subtle)" }}>
          {d.label}
        </div>
        <div className="ft-serif" style={{ fontSize: 25, lineHeight: 1.1, marginTop: 3 }}>{d.title}</div>
        <div style={{ fontSize: 13, color: "var(--ft-muted)", marginTop: 3 }}>{d.subtitle}</div>
      </div>
      <div
        className="ft-mono ft-home-destrow-stat"
        style={{ fontSize: 12, color: accenty ? "var(--ft-accent)" : "var(--ft-muted)", whiteSpace: "nowrap" }}
      >
        {d.stat}
      </div>
      <div className="ft-home-destrow-img">
        <ImageSlot label={d.title} width={200} height={92} radius={12} />
      </div>
      <Icon.chevron size={20} style={{ color: "var(--ft-accent)", flexShrink: 0 }} />
    </button>
  );
}

/** Mobile full-width destination row — retro .ft-card treatment. */
function PhoneRow({ d, onActivate }: { d: HomeDestination; onActivate: () => void }) {
  const accenty = d.featured || d.ai;
  const pct = Math.round((4 / 19) * 100);
  return (
    <Card
      as="button"
      interactive
      type="button"
      onClick={onActivate}
      style={{
        display: "flex", alignItems: "center", gap: 14, width: "100%", textAlign: "left",
        padding: "15px 16px", minHeight: 80, borderRadius: 17, color: "var(--ft-text)",
        // accent tint for Logger (featured) + Einstein (ai); plain surface otherwise.
        background: cardBg(d), borderColor: cardBorder(d),
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
    </Card>
  );
}

/**
 * Cover image slot (mobile) — signature element of the phone "cover" layout
 * (home.jsx PhoneCover). A 150px-tall rounded image placeholder (dashed frame +
 * muted photo glyph + "Aerial — {farmName}" caption chip) with the serif farm
 * headline overlaid bottom-left ("{head} {tail}", tail italic). Matches
 * phone_1.jpg. Placeholder until a real cover photo source exists.
 */
function PhoneCover({ head, tail }: { head: string; tail: string }) {
  return (
    <div style={{ position: "relative", borderRadius: 20, overflow: "hidden" }}>
      <ImageSlot label={`Aerial — ${head || tail}`} height={150} radius={20} />
      <div style={{ position: "absolute", left: 16, bottom: 14, right: 16 }}>
        <h1
          className="ft-serif"
          style={{ fontSize: 30, lineHeight: 0.92, margin: 0, color: "#fff", textShadow: "0 2px 12px rgba(0,0,0,.5)" }}
        >
          {head && <>{head} </>}
          <span style={{ fontStyle: "italic" }}>{tail}</span>
        </h1>
      </div>
    </div>
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
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4,
            minHeight: 44, color: "var(--ft-muted)", cursor: "pointer", background: "transparent", border: 0,
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
  // Wall-clock strings routed through useClientTime: SSR and the client's
  // first render emit the stable placeholder, then swap to the real
  // locale/timezone value post-mount. Reading new Date() in the render body
  // straddled greeting/day boundaries between the server's UTC clock and the
  // browser's local clock → the recurring React #418 hydration mismatch this
  // page threw on every load. Mirrors DashboardClient's "Good day" gate.
  const greeting = useClientTime((now) => greetingFor(now.getHours()), "Good day");
  const hour = useClientTime((now) => now.getHours(), 12);
  const date = useClientTime((now) => formatDate(now), "");
  const firstName = owner.trim().split(/\s+/)[0] ?? "";
  const { head, tail } = splitName(farmName);
  const assistantName = useAssistantName();

  const destinations: HomeDestination[] = useMemo(
    () => [
      {
        key: "admin", Icon: Icon.overview, label: "ADMIN", title: "Operations",
        subtitle: sections.admin, stat: `${formatNumber(animalCount)} animals`, path: "/admin",
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
      {/* ============================================================= *
       *  DESKTOP — "rail" layout (home.jsx HomeRail → desk_4.jpg)      *
       *  330px masthead aside + flexible destination-row main.         *
       *  Collapses to a single stacked column at <= 920px (the         *
       *  desk_4.jpg crop shows the full-width masthead at that width). *
       * ============================================================= */}
      <div className="ft-home-rail">
        <aside className="ft-home-rail-aside">
          <BrandMark />

          <div>
            <div
              className="ft-mono"
              style={{ fontSize: 11, color: "var(--ft-accent)", letterSpacing: ".2em", textTransform: "uppercase", marginBottom: 14 }}
            >
              {breed} FMS
            </div>
            <h1
              className="ft-serif ft-home-headline"
              style={{ fontWeight: 400, lineHeight: 0.95, margin: 0, letterSpacing: "-.03em", color: "var(--ft-text)" }}
            >
              {/* Single contiguous "Head Tail" text run (real space, not <br>)
                  so textContent stays accessible; the italic accent tail drops
                  to its own line visually via .ft-home-tail. */}
              {head && <>{head} </>}
              <span className="ft-home-tail" style={{ fontStyle: "italic", color: "var(--ft-accent)" }}>
                {tail}
              </span>
            </h1>
          </div>

          <StatList breed={breed} animalCount={animalCount} campCount={campCount} owner={owner} />

          {isMultiMode && (
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
          )}

          <div className="ft-home-rail-foot">
            <StatusFooter
              owner={owner}
              firstName={firstName}
              hour={hour}
              date={date}
              greeting={greeting}
              onSignOut={onSignOut}
            />
          </div>
        </aside>

        <main className="ft-home-rail-main">
          {destinations.map((d) => (
            <DestRow key={d.key} d={d} onActivate={activate(d)} />
          ))}
        </main>
      </div>

      {/* ============================================================= *
       *  MOBILE — "cover" layout (home.jsx PhoneCover → phone_1.jpg)   *
       *  compact header + cover image (headline overlaid) + 4 full-    *
       *  width rows + sticky bottom tab bar.                           *
       * ============================================================= */}
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
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 13, color: "var(--ft-muted)" }}>
                  {greeting}{firstName ? `, ${firstName}` : ""}
                </div>
              </div>
            </div>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--ft-muted)", whiteSpace: "nowrap" }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: "#5DBB6B", boxShadow: "0 0 8px #5DBB6B" }} />
              Online
            </span>
          </div>

          <PhoneCover head={head} tail={tail} />

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
  /* locked cream Home backdrop (home.jsx cream theme): single warm rust glint
     top-right over a cream paper linear wash. Opaque base covers the hero
     photo on the root — the cream Home is a clean paper surface. */
  background:
    radial-gradient(ellipse 70% 50% at 82% -10%, rgba(196,99,58,.08), transparent 55%),
    linear-gradient(180deg, #F5EFE3 0%, #EFE7D6 100%);
}

/* ---- desktop "rail": 330px masthead aside + flexible row main ---- */
.ft-home-rail {
  display: grid;
  grid-template-columns: 330px 1fr;
  min-height: 100vh;
}
.ft-home-rail-aside {
  border-right: 1px solid var(--ft-border);
  background: var(--ft-surface);
  padding: 40px 32px;
  display: flex;
  flex-direction: column;
  gap: 28px;
}
.ft-home-headline { font-size: clamp(40px, 4vw, 56px); }
/* Tail word drops to its own line (the design's two-line treatment) while the
   markup keeps a contiguous "Head Tail" text run for accessibility/tests. */
.ft-home-tail { display: block; }
/* footer pinned to the bottom of the aside (home.jsx margin-top:auto). */
.ft-home-rail-foot { margin-top: auto; }
.ft-home-rail-aside .ft-segmented { align-self: flex-start; }

.ft-home-rail-main {
  padding: 36px 44px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  justify-content: center;
}

/* mobile shell hidden on desktop */
.ft-home-mobile { display: none; }

/* ---- collapse to a single stacked column (desk_4.jpg crop width) ---- */
@media (max-width: 920px) {
  .ft-home-rail { grid-template-columns: 1fr; }
  .ft-home-rail-aside { border-right: none; border-bottom: 1px solid var(--ft-border); }
  .ft-home-rail-main { justify-content: flex-start; }
  /* the 200px image slot + its stat collapse out of the row on narrow widths */
  .ft-home-destrow { grid-template-columns: auto 1fr auto; }
  .ft-home-destrow-img { display: none; }
}

@media (max-width: 620px) {
  .ft-home-rail { display: none; }
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
