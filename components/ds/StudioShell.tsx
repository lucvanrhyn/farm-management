"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lock, ChevronRight, X } from "lucide-react";
import { useFarmModeSafe } from "@/lib/farm-mode";
import type { FarmTier } from "@/lib/tier";
import { ModeSwitcher } from "@/components/ui/ModeSwitcher";
import { SignOutButton } from "@/components/logger/SignOutButton";
import NotificationBell from "@/components/admin/NotificationBell";
import { buildNavGroups, flattenNav, PRIMARY_PATHS, type ResolvedNavLink } from "@/components/admin/nav-model";
import { Icon } from "./icons";
import { Kbd } from "./primitives";
import { cn } from "@/lib/utils";

function BrandMark({ slug, compact = false }: { slug: string; compact?: boolean }) {
  return (
    <Link href={`/${slug}/home`} className="flex items-center gap-2.5" title="Home">
      <span
        className="inline-flex items-center justify-center shrink-0"
        style={{ width: compact ? 26 : 30, height: compact ? 26 : 30, borderRadius: 9, background: "var(--ft-accent)", color: "#fff" }}
      >
        <Icon.cattle size={compact ? 16 : 18} />
      </span>
      <span className="leading-none">
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ft-text)" }}>FarmTrack</span>
        <span className="ft-mono" style={{ display: "block", fontSize: 9, letterSpacing: ".14em", color: "var(--ft-subtle)", marginTop: 2 }}>
          {slug.toUpperCase()} · OPS
        </span>
      </span>
    </Link>
  );
}

function CommandBar({ wide = false }: { wide?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent("farmtrack-cmdk"))}
      className="ft-mono"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        width: wide ? 300 : undefined,
        padding: "9px 14px",
        borderRadius: 999,
        border: "1px solid var(--ft-border2)",
        background: "var(--ft-surface)",
        boxShadow: "var(--ft-shadow-sm)",
        color: "var(--ft-subtle)",
        fontSize: 12.5,
        cursor: "pointer",
      }}
    >
      <span style={{ color: "var(--ft-accent)" }}><Icon.search size={16} /></span>
      <span style={{ flex: 1, textAlign: "left" }}>Search or jump to…</span>
      <Kbd>⌘K</Kbd>
    </button>
  );
}

function Avatar() {
  return (
    <span
      className="inline-flex items-center justify-center"
      style={{ width: 32, height: 32, borderRadius: 999, background: "color-mix(in oklab, var(--ft-accent) 30%, var(--ft-surface2))", color: "var(--ft-text)", fontSize: 12, fontWeight: 600 }}
    >
      <span className="ft-mono">LR</span>
    </span>
  );
}

/**
 * Operations "Studio" shell — the production admin chrome.
 *
 * Desktop: translucent top header (BrandMark + breadcrumb + ⌘K command bar +
 * mode switcher + notifications + sign-out) and a floating-island section dock
 * (PRIMARY quick-switch + "More" full-nav menu + quick-add).
 * Mobile: slim brand bar + a full-nav sections sheet.
 *
 * Drives off the shared nav model so tier-locking, species-scoping and
 * active-route logic match the original sidebar exactly.
 */
export default function StudioShell({
  tier,
  enabledSpecies,
  children,
}: {
  tier: FarmTier;
  enabledSpecies?: string[];
  farmCount?: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const slug = pathname.split("/")[1] || "";
  const { mode, isMultiMode, enabledModes } = useFarmModeSafe();
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const [toast, setToast] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  useEffect(() => { setSectionsOpen(false); }, [pathname]);

  const groups = useMemo(
    () => buildNavGroups({ mode, tier, enabledSpecies, enabledModes, farmSlug: slug, pathname }),
    [mode, tier, enabledSpecies, enabledModes, slug, pathname],
  );
  const flat = useMemo(() => flattenNav(groups), [groups]);

  const active = flat.find((l) => l.isActive);
  const activeGroup = groups.find((g) => g.links.some((l) => l.isActive));
  const crumbGroup = activeGroup?.label ?? "Operations";
  const crumbLabel = active?.label ?? "Overview";

  const primary: ResolvedNavLink[] = PRIMARY_PATHS
    .map((p) => flat.find((l) => l.href === `/${slug}${p}`))
    .filter((l): l is ResolvedNavLink => !!l);

  function showLockedToast() {
    setToast(true);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(false), 3500);
  }

  return (
    <div className="ft-scope" style={{ minHeight: "100vh", background: "var(--ft-bg)", color: "var(--ft-text)" }}>
      {/* ── Desktop header ─────────────────────────────────────────── */}
      <header
        className="hidden md:flex sticky top-0 z-40 items-center"
        style={{
          height: 62,
          gap: 18,
          padding: "0 28px",
          background: "color-mix(in oklab, var(--ft-surface) 86%, transparent)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          borderBottom: "1px solid var(--ft-border)",
        }}
      >
        <BrandMark slug={slug} />
        <span style={{ width: 1, height: 26, background: "var(--ft-border)" }} />
        <nav aria-label="Breadcrumb" className="ft-mono" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--ft-muted)" }}>
          <span>{crumbGroup}</span>
          <ChevronRight size={12} style={{ color: "var(--ft-subtle)" }} />
          <span style={{ color: "var(--ft-text)", fontWeight: 600 }}>{crumbLabel}</span>
        </nav>
        <div style={{ flex: 1 }} />
        <CommandBar wide />
        {isMultiMode && <ModeSwitcher variant="solid" />}
        <NotificationBell farmSlug={slug} />
        <SignOutButton />
      </header>

      {/* ── Mobile brand bar ───────────────────────────────────────── */}
      <header
        className="flex md:hidden sticky top-0 z-40 items-center"
        style={{
          gap: 10,
          padding: "calc(env(safe-area-inset-top, 0px) + 10px) 14px 10px",
          background: "color-mix(in oklab, var(--ft-surface) 90%, transparent)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderBottom: "1px solid var(--ft-border)",
        }}
      >
        <BrandMark slug={slug} compact />
        <div style={{ flex: 1 }} />
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("farmtrack-cmdk"))} className="ft-action-btn" aria-label="Search">
          <Icon.search size={18} />
        </button>
        <button type="button" onClick={() => setSectionsOpen(true)} className="ft-action-btn" aria-label="All sections">
          <Icon.more size={18} />
        </button>
        <NotificationBell farmSlug={slug} />
      </header>

      {/* ── Page content ───────────────────────────────────────────── */}
      <main className="md:pb-28">{children}</main>

      {/* ── Desktop floating section dock ──────────────────────────── */}
      <div
        className="hidden md:flex"
        style={{ position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", zIndex: 60, gap: 4, padding: 6, borderRadius: 999, alignItems: "center", background: "color-mix(in oklab, #fff 82%, var(--ft-surface2))", border: "1px solid var(--ft-border2)", backdropFilter: "blur(18px) saturate(150%)", WebkitBackdropFilter: "blur(18px) saturate(150%)", boxShadow: "var(--ft-shadow-lg)" }}
      >
        {primary.map((l) => {
          const IconC = l.icon;
          const base = {
            display: "flex",
            alignItems: "center",
            gap: 7,
            height: 38,
            padding: l.isActive ? "0 14px" : "0 10px",
            borderRadius: 999,
            border: 0,
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 500,
          } as const;
          if (l.locked) {
            return (
              <button key={l.href} type="button" title={`${l.label} — Advanced`} onClick={showLockedToast} style={{ ...base, background: "transparent", color: "var(--ft-subtle)" }}>
                <IconC size={17} />
                <Lock size={11} />
              </button>
            );
          }
          return (
            <Link
              key={l.href}
              href={l.href}
              prefetch={false}
              title={l.label}
              style={{ ...base, background: l.isActive ? "var(--ft-accent)" : "transparent", color: l.isActive ? "#FFF6EE" : "var(--ft-muted)" }}
            >
              <IconC size={17} />
              {l.isActive && <span>{l.label}</span>}
            </Link>
          );
        })}
        <span style={{ width: 1, height: 26, background: "var(--ft-border2)" }} />
        <button type="button" onClick={() => setSectionsOpen(true)} title="All sections" className="ft-mono" style={{ display: "flex", alignItems: "center", gap: 6, height: 38, padding: "0 12px", borderRadius: 999, border: 0, cursor: "pointer", background: "transparent", color: "var(--ft-muted)", fontSize: 12 }}>
          <Icon.layers size={16} /> More
        </button>
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("farmtrack-cmdk"))} title="Quick add / search" style={{ width: 38, height: 38, borderRadius: 999, border: 0, cursor: "pointer", background: "var(--ft-accent)", color: "#FFF6EE", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
          <Icon.plus size={17} />
        </button>
      </div>

      {/* ── All-sections sheet (More / mobile ≡) ───────────────────── */}
      {sectionsOpen && (
        <SectionsSheet groups={groups} onClose={() => setSectionsOpen(false)} onLocked={showLockedToast} />
      )}

      {/* ── Upgrade toast ──────────────────────────────────────────── */}
      {toast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 rounded-xl px-4 py-3"
          style={{ background: "var(--ft-surface)", border: "1px solid color-mix(in oklab, var(--ft-accent) 40%, var(--ft-border))", boxShadow: "var(--ft-shadow-lg)", minWidth: 280, maxWidth: "calc(100vw - 2rem)" }}
        >
          <Lock size={16} style={{ color: "var(--ft-accent)" }} />
          <div className="flex-1 min-w-0">
            <p style={{ fontSize: 13, fontWeight: 500, color: "var(--ft-text)" }}>Advanced feature</p>
            <p style={{ fontSize: 12, marginTop: 2, color: "var(--ft-muted)" }}>Upgrade your plan to unlock this.</p>
          </div>
          <button type="button" onClick={() => setToast(false)} className="ft-action-btn" aria-label="Dismiss"><X size={14} /></button>
        </div>
      )}
    </div>
  );
}

function SectionsSheet({
  groups,
  onClose,
  onLocked,
}: {
  groups: ReturnType<typeof buildNavGroups>;
  onClose: () => void;
  onLocked: () => void;
}) {
  useEffect(() => {
    function onEsc(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  return (
    <div onClick={onClose} className="fixed inset-0 z-[110] flex items-end md:items-center md:justify-center" style={{ background: "rgba(15,11,8,.5)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="ft-card w-full md:w-[640px] max-h-[82vh] overflow-y-auto"
        style={{ borderRadius: 18, padding: 18 }}
        role="dialog"
        aria-label="All sections"
      >
        <div className="flex items-center justify-between mb-3">
          <span className="ft-serif" style={{ fontSize: 20, fontWeight: 500 }}>All sections</span>
          <button type="button" onClick={onClose} className="ft-action-btn" aria-label="Close"><X size={16} /></button>
        </div>
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <div key={g.label}>
              <div className="ft-label" style={{ marginBottom: 8 }}>{g.label}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {g.links.map((l) => {
                  const IconC = l.icon;
                  if (l.locked) {
                    return (
                      <button key={l.href} type="button" onClick={onLocked} className="ft-row-hover flex items-center gap-3 rounded-lg px-3 py-2 text-left" style={{ color: "var(--ft-subtle)", border: 0, background: "transparent", cursor: "pointer" }}>
                        <IconC size={17} />
                        <span style={{ flex: 1, fontSize: 13.5 }}>{l.label}</span>
                        <Lock size={12} />
                      </button>
                    );
                  }
                  return (
                    <Link key={l.href} href={l.href} prefetch={false} onClick={onClose} className="ft-row-hover flex items-center gap-3 rounded-lg px-3 py-2" style={{ color: l.isActive ? "var(--ft-accent)" : "var(--ft-text)", background: l.isActive ? "var(--ft-accent-faint)" : "transparent" }}>
                      <IconC size={17} style={{ color: l.isActive ? "var(--ft-accent)" : "var(--ft-muted)" }} />
                      <span style={{ flex: 1, fontSize: 13.5, fontWeight: l.isActive ? 600 : 500 }}>{l.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
