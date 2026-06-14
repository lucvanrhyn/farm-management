#!/usr/bin/env node
/**
 * reskin-tw-codemod — Phase 2b of the FarmTrack Overhaul reskin.
 *
 * The hex codemod (reskin-codemod.mjs) tokenized inline `style={{}}` colours but
 * left Tailwind palette UTILITIES (`text-red-500`, `bg-gray-200`, `border-stone-300`…)
 * untouched — these render in cool Tailwind hues that clash with the warm --ft-*
 * palette. This pass rewrites them to token-backed arbitrary values
 * (`text-[var(--ft-crit)]`, `bg-[var(--ft-surface2)]`…), shade-aware.
 *
 * Mapping rules:
 *   status families  red/rose→crit · orange→poor · amber/yellow→fair ·
 *                    green/emerald/lime→good · teal/cyan/sky/blue/indigo→info
 *                    (shade ≤100 on bg/border → the soft `-bg` token)
 *   neutrals         gray/grey/zinc/neutral/slate/stone → by utility + shade
 *                    (text: ≥700 text, 600 muted, ≤500 subtle;
 *                     bg: ≤100 surface, 200-300 surface2, 400-500 muted, ≥600 text;
 *                     border/ring: ≤300 border, ≥400 border2)
 *   LEFT ALONE       violet/purple/fuchsia/pink (categorical/decorative),
 *                    text-white (text on coloured chrome), bg-black.
 *
 * Usage:  node scripts/reskin-tw-codemod.mjs --dry   |   node scripts/reskin-tw-codemod.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const DRY = process.argv.includes("--dry");

const EXCLUDE = [
  "components/ds/", "components/home/", "components/logger/",
  "components/map/", "components/einstein/", "components/dashboard/",
  "components/admin/DashboardContent.tsx", "components/admin/nav-model.tsx",
  "components/admin/AdminNav.tsx",
];
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
  "components/veld", "components/feed-on-offer", "components/drought",
];

const STATUS = {
  red: "crit", rose: "crit", orange: "poor", amber: "fair", yellow: "fair",
  green: "good", emerald: "good", lime: "good",
  teal: "info", cyan: "info", sky: "info", blue: "info", indigo: "info",
};
const NEUTRALS = new Set(["gray", "grey", "zinc", "neutral", "slate", "stone"]);
const SKIP = new Set(["violet", "purple", "fuchsia", "pink"]);

const UTILS = "text|bg|border|ring|divide|fill|stroke|from|to|via|placeholder|caret|outline|decoration|accent|shadow";

/** Decide the --ft-* token (without the var() wrapper) for a utility/color/shade. */
function tokenFor(util, color, shadeStr) {
  const shade = Number(shadeStr);
  if (SKIP.has(color)) return null;

  if (STATUS[color]) {
    const fam = STATUS[color];
    if ((util === "bg" || util === "border" || util === "ring" || util === "divide") && shade <= 100) {
      return `${fam}-bg`;
    }
    return fam;
  }

  if (NEUTRALS.has(color)) {
    if (util === "text" || util === "fill" || util === "stroke" || util === "placeholder" || util === "caret" || util === "decoration") {
      if (shade >= 700) return "text";
      if (shade === 600) return "muted";
      return "subtle";
    }
    if (util === "bg" || util === "accent") {
      if (shade <= 100) return "surface";
      if (shade <= 300) return "surface2";
      if (shade <= 500) return "muted";
      return "text"; // dark chips/buttons
    }
    if (util === "border" || util === "ring" || util === "divide" || util === "outline") {
      return shade <= 300 ? "border" : "border2";
    }
    if (util === "from" || util === "to" || util === "via" || util === "shadow") {
      return shade <= 200 ? "surface" : "surface2";
    }
    return "border";
  }
  return null; // unknown color — leave
}

const colorAlt = [...Object.keys(STATUS), ...NEUTRALS, ...SKIP].join("|");
const RE = new RegExp(`\\b(${UTILS})-(${colorAlt})-(50|100|200|300|400|500|600|700|800|900|950)\\b`, "g");

let files = [];
const seen = new Set();
for (const r of roots) {
  let out = "";
  try { out = execSync(`find '${r}' -name '*.tsx' 2>/dev/null`, { encoding: "utf8" }); } catch { continue; }
  for (const f of out.split("\n").filter(Boolean)) {
    if (EXCLUDE.some((e) => f.includes(e))) continue;
    seen.add(f);
  }
}
files = [...seen].sort();

let total = 0;
const counts = {};
const report = [];
for (const file of files) {
  let src;
  try { src = readFileSync(file, "utf8"); } catch { continue; }
  const before = src;
  let hits = 0;
  src = src.replace(RE, (m, util, color, shade) => {
    const tok = tokenFor(util, color, shade);
    if (!tok) return m;
    hits++;
    const key = `${util} → --ft-${tok}`;
    counts[key] = (counts[key] || 0) + 1;
    return `${util}-[var(--ft-${tok})]`;
  });
  // bg-white → surface; text-black → text (white text left intact).
  src = src.replace(/\bbg-white\b/g, () => { hits++; counts["bg-white → surface"] = (counts["bg-white → surface"] || 0) + 1; return "bg-[var(--ft-surface)]"; });
  src = src.replace(/\btext-black\b/g, () => { hits++; counts["text-black → text"] = (counts["text-black → text"] || 0) + 1; return "text-[var(--ft-text)]"; });

  if (src !== before) {
    total += hits;
    report.push([file, hits]);
    if (!DRY) writeFileSync(file, src, "utf8");
  }
}

console.log(`${DRY ? "[DRY RUN] " : ""}TW codemod — ${files.length} scanned, ${report.length} changed, ${total} swaps.\n`);
console.log("Per-rule counts:");
for (const [k, c] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${String(c).padStart(4)}  ${k}`);
console.log("\nTop changed files:");
for (const [f, c] of report.sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`  ${String(c).padStart(4)}  ${f}`);
