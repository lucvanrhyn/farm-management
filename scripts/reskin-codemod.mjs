#!/usr/bin/env node
/**
 * reskin-codemod — Phase 2 of the FarmTrack Overhaul reskin.
 *
 * Deterministically migrates the long-tail surfaces from inline hex colours to
 * the `--ft-*` design tokens defined in app/design-system.css. Running this as a
 * single script (rather than 40 independent agent edits) guarantees every page
 * maps the same hex to the same token — uniform results, zero drift.
 *
 * Safety model: the OLD palette hexes are near-exact matches for the new token
 * VALUES (per the styling audit), so for a literal swap the rendered colour is
 * unchanged or nudged imperceptibly toward the unified palette. Status families
 * (green/gold/red/blue) collapse onto the 5 status tokens — an intended, design-
 * directed shift. Ambiguous / categorical chart colours (purples, pinks, teals,
 * slate series) are deliberately LEFT ALONE.
 *
 * White (#FFFFFF) is context-aware: `background:`/`bg-[...]` → --ft-surface
 * (warm cards), but `color:`/`fill=`/`solid #FFFFFF` borders are left as white
 * (text/strokes on coloured chrome).
 *
 * Usage:  node scripts/reskin-codemod.mjs --dry   (report only)
 *         node scripts/reskin-codemod.mjs         (apply)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const DRY = process.argv.includes("--dry");

// ── Exclusions ───────────────────────────────────────────────────────────────
// Phase-1 surfaces (ds, home, logger, map, einstein) are EXCLUDED — already
// token-native; re-touching risks regressing their bespoke layouts. The target
// roots are enumerated in `roots` below.
const EXCLUDE = [
  "components/ds/",
  "components/home/",
  "components/logger/",
  "components/map/",
  "components/einstein/",
  "components/admin/DashboardContent.tsx",
  "components/admin/nav-model.tsx",
  "components/admin/AdminNav.tsx",
];

// ── Flat hex → token map (white handled separately, context-aware) ───────────
const MAP = {
  // text (near-black warm browns)
  "#1c1815": "--ft-text", "#1a1510": "--ft-text", "#1e1710": "--ft-text",
  "#1e0f07": "--ft-text", "#261c12": "--ft-text", "#241c14": "--ft-text",
  // muted
  "#6b5c4e": "--ft-muted", "#6b5e50": "--ft-muted", "#6b5e48": "--ft-muted",
  "#6b5e52": "--ft-muted", "#6b5e44": "--ft-muted",
  // subtle
  "#9c8e7a": "--ft-subtle", "#9c8473": "--ft-subtle", "#b09878": "--ft-subtle",
  "#a8977a": "--ft-subtle", "#b0a090": "--ft-subtle",
  // border
  "#e0d5c8": "--ft-border", "#d8cfc4": "--ft-border", "#d6cec4": "--ft-border",
  "#d4c9b8": "--ft-border", "#c8bcae": "--ft-border", "#c4b8aa": "--ft-border",
  // page bg
  "#fafaf8": "--ft-bg", "#faf7f2": "--ft-bg", "#f9f5ef": "--ft-bg", "#f7f4f0": "--ft-bg",
  // surface (warm panels)
  "#f5f2ee": "--ft-surface", "#f5f0e8": "--ft-surface", "#f0ebe3": "--ft-surface",
  "#f5f0ea": "--ft-surface", "#f0e8de": "--ft-surface", "#f0ebe4": "--ft-surface",
  "#f0e8dc": "--ft-surface",
  // surface2 (deeper warm panels)
  "#f0eae0": "--ft-surface2", "#e8dfd2": "--ft-surface2", "#e8e2d9": "--ft-surface2",
  "#f0eae1": "--ft-surface2",
  // accent (rust)
  "#c4633a": "--ft-accent",
  // good (green family)
  "#4a7c59": "--ft-good", "#3a6b49": "--ft-good", "#166534": "--ft-good",
  "#2d6a4f": "--ft-good", "#16a34a": "--ft-good", "#22c55e": "--ft-good",
  "#2a7d4f": "--ft-good", "#10b981": "--ft-good", "#2e7d32": "--ft-good",
  "#1b5e20": "--ft-good", "#15381f": "--ft-good", "#2e7d46": "--ft-good",
  // fair (gold / amber family)
  "#8b6914": "--ft-fair", "#92400e": "--ft-fair", "#c4a030": "--ft-fair",
  "#c49030": "--ft-fair", "#b45309": "--ft-fair", "#f59e0b": "--ft-fair",
  "#c98a2b": "--ft-fair", "#ca8a04": "--ft-fair", "#7a5c1e": "--ft-fair",
  "#7a5c00": "--ft-fair", "#6b4e10": "--ft-fair",
  // poor (orange-rust / sienna family — negative/expense)
  "#c0574c": "--ft-poor", "#a0522d": "--ft-poor", "#d07848": "--ft-poor",
  "#d4904a": "--ft-poor", "#e65100": "--ft-poor", "#7a3a18": "--ft-poor",
  // crit (deep red)
  "#991b1b": "--ft-crit", "#8b3a3a": "--ft-crit", "#ef4444": "--ft-crit",
  "#b91c1c": "--ft-crit", "#dc2626": "--ft-crit", "#b03030": "--ft-crit",
  "#c62828": "--ft-crit", "#c25858": "--ft-crit", "#8b1a1a": "--ft-crit",
  "#b23a48": "--ft-crit",
  // info (blue)
  "#3b82f6": "--ft-info", "#4a90d9": "--ft-info", "#1d4ed8": "--ft-info",
  "#2563eb": "--ft-info", "#1a5c8a": "--ft-info", "#1e3a5f": "--ft-info",
  // status tint backgrounds
  "#f5ebd4": "--ft-fair-bg", "#f0deb8": "--ft-fair-bg", "#fffbeb": "--ft-fair-bg",
  "#fffaf0": "--ft-fair-bg",
  "#f0fbf5": "--ft-good-bg",
  "#fff5f5": "--ft-crit-bg",
};

// ── Resolve file list ────────────────────────────────────────────────────────
// `find` over each top dir (reliable, no shell globstar dependency).
let files = [];
const roots = [
  "app/[farmSlug]/admin", "app/[farmSlug]/tools", "app/[farmSlug]/sheep",
  "app/[farmSlug]/game", "app/[farmSlug]/dashboard", "app/[farmSlug]/subscribe",
  "app/(auth)", "components/farms",
  "components/admin", "components/tools", "components/sheep", "components/game",
  "components/dashboard", "components/reproduction", "components/breeding",
  "components/reports", "components/observations", "components/import",
  "components/consulting", "components/settings", "components/telemetry",
  "components/mobs", "components/alerts", "components/camps",
  "components/methodology", "components/tax",
];
const seen = new Set();
for (const r of roots) {
  let out = "";
  try {
    out = execSync(`find '${r}' -name '*.tsx' 2>/dev/null`, { encoding: "utf8" });
  } catch { continue; }
  for (const f of out.split("\n").filter(Boolean)) {
    if (EXCLUDE.some((e) => f.includes(e))) continue;
    seen.add(f);
  }
}
files = [...seen].sort();

// ── Apply ────────────────────────────────────────────────────────────────────
let totalHits = 0;
const perToken = {};
const report = [];

for (const file of files) {
  let src;
  try { src = readFileSync(file, "utf8"); } catch { continue; }
  const before = src;
  let hits = 0;

  // 1. Context-aware white → surface (backgrounds only).
  src = src.replace(/(background(?:Color)?\s*:\s*)(["'])#[fF]{6}\2/g, (_m, p, q) => {
    hits++; perToken["--ft-surface(bg-white)"] = (perToken["--ft-surface(bg-white)"] || 0) + 1;
    return `${p}${q}var(--ft-surface)${q}`;
  });
  src = src.replace(/(background(?:-color)?\s*:\s*)#[fF]{6}\b/g, (_m, p) => {
    hits++; perToken["--ft-surface(bg-white)"] = (perToken["--ft-surface(bg-white)"] || 0) + 1;
    return `${p}var(--ft-surface)`;
  });
  src = src.replace(/bg-\[#[fF]{6}\]/g, () => {
    hits++; perToken["--ft-surface(bg-white)"] = (perToken["--ft-surface(bg-white)"] || 0) + 1;
    return "bg-[var(--ft-surface)]";
  });

  // 2. Flat hex → token (case-insensitive on the hex; var() preserves quotes/brackets).
  for (const [hex, token] of Object.entries(MAP)) {
    const re = new RegExp(hex.replace("#", "#"), "gi");
    src = src.replace(re, (m) => {
      // only swap actual hex literals
      if (!/^#[0-9a-fA-F]{6}$/.test(m)) return m;
      hits++; perToken[token] = (perToken[token] || 0) + 1;
      return `var(${token})`;
    });
  }

  if (src !== before) {
    totalHits += hits;
    report.push([file, hits]);
    if (!DRY) writeFileSync(file, src, "utf8");
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
console.log(`${DRY ? "[DRY RUN] " : ""}Reskin codemod — ${files.length} files scanned, ${report.length} changed, ${totalHits} swaps.\n`);
console.log("Per-token swap counts:");
for (const [t, c] of Object.entries(perToken).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(c).padStart(4)}  ${t}`);
}
console.log("\nTop 25 changed files:");
for (const [f, c] of report.sort((a, b) => b[1] - a[1]).slice(0, 25)) {
  console.log(`  ${String(c).padStart(4)}  ${f}`);
}
