"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useFarmModeSafe } from "@/lib/farm-mode";
import { buildNavGroups, flattenNav } from "@/components/admin/nav-model";
import { Icon } from "./icons";
import { Kbd } from "./primitives";

type PaletteItem = {
  kind: "go" | "nav" | "action";
  label: string;
  href: string;
};

/**
 * Global ⌘K command palette. Mounted once in the farm layout; opens on
 * ⌘K / Ctrl-K or a `farmtrack-cmdk` custom event (dispatched by the Studio
 * command bar and AreaDock search). Navigates to real routes.
 */
export function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const { mode, enabledModes } = useFarmModeSafe();
  const farmSlug = pathname.split("/")[1] || "";
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("farmtrack-cmdk", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("farmtrack-cmdk", onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) setQ("");
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    if (!farmSlug) return [];
    const areas: PaletteItem[] = [
      { kind: "go", label: "Go Home", href: `/${farmSlug}/home` },
      { kind: "go", label: "Open Farm Map", href: `/${farmSlug}/map` },
      { kind: "go", label: "Open Logger", href: `/${farmSlug}/logger` },
    ];
    // Resolve through the shared nav model so mode + species scoping (and the
    // single-species settings hide) match the Studio shell. Tier is passed as
    // "consulting" because the palette only NAVIGATES — premium routes self-gate
    // server-side with an upsell, so we list them rather than hide them.
    const groups = buildNavGroups({ mode, tier: "consulting", enabledModes, farmSlug, pathname });
    const nav: PaletteItem[] = flattenNav(groups).map((l) => ({
      kind: "nav",
      label: `Open ${l.label}`,
      href: l.href,
    }));
    const actions: PaletteItem[] = [
      { kind: "action", label: "+ Log a health issue", href: `/${farmSlug}/logger` },
      { kind: "action", label: "+ Log a weighing", href: `/${farmSlug}/logger` },
      { kind: "action", label: "+ Move an animal", href: `/${farmSlug}/logger` },
    ];
    return [...areas, ...nav, ...actions];
  }, [farmSlug, mode, enabledModes, pathname]);

  const filtered = useMemo(
    () => items.filter((it) => !q || it.label.toLowerCase().includes(q.toLowerCase())).slice(0, 24),
    [items, q],
  );

  if (!open) return null;

  function goTo(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <div
      onClick={() => setOpen(false)}
      className="ft-scope"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,11,8,.55)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        zIndex: 120,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "14vh",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Quick search"
        className="ft-modal-in"
        style={{
          width: 580,
          maxWidth: "92vw",
          background: "var(--ft-bg)",
          borderRadius: 16,
          border: "1px solid var(--ft-border2)",
          boxShadow: "var(--ft-shadow-lg)",
          overflow: "hidden",
          color: "var(--ft-text)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "16px 18px",
            borderBottom: "1px solid var(--ft-border)",
          }}
        >
          <span style={{ color: "var(--ft-subtle)" }}>
            <Icon.search size={18} />
          </span>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search sections or actions…"
            style={{ flex: 1, border: 0, outline: 0, background: "transparent", fontSize: 15, color: "var(--ft-text)" }}
          />
          <Kbd>esc</Kbd>
        </div>
        <div style={{ maxHeight: 380, overflowY: "auto", padding: 6 }}>
          {filtered.map((it, i) => (
            <button
              key={`${it.href}-${i}`}
              onClick={() => goTo(it.href)}
              className="ft-row-hover"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                width: "100%",
                padding: "10px 12px",
                borderRadius: 8,
                color: "var(--ft-text)",
                background: "none",
                border: 0,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span
                className="ft-mono"
                style={{ fontSize: 10, color: "var(--ft-subtle)", minWidth: 52, textTransform: "uppercase", letterSpacing: ".08em" }}
              >
                {it.kind}
              </span>
              <span style={{ fontSize: 14 }}>{it.label}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: 20, color: "var(--ft-muted)", fontSize: 14 }}>No matches.</div>
          )}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 16px",
            borderTop: "1px solid var(--ft-border)",
            fontSize: 12,
            color: "var(--ft-subtle)",
          }}
        >
          <span>FarmTrack Quick Search</span>
          <span>
            <Kbd>↵</Kbd> select · <Kbd>esc</Kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
