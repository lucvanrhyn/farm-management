"use client";

/**
 * DashboardStatsStrip — the 3-chip summary block in the dashboard header.
 *
 * Extracted from DashboardClient.tsx so framer-motion stays out of the
 * dashboard route's initial JS bundle; this file is loaded via
 * `next/dynamic({ ssr: false })` from DashboardClient.
 *
 * Keeping the chips client-only is fine — the values change every 60 s
 * as /api/camps/status polls, so there is no meaningful SSR contribution.
 */

import { motion } from "framer-motion";

const chipVariants = {
  hidden: { opacity: 0, y: 6, scale: 0.92 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring" as const, stiffness: 200, damping: 22 },
  },
};

function StatChip({
  label,
  value,
  accent,
  pulse,
  dark,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
  pulse?: boolean;
  dark?: boolean;
}) {
  const bg = dark
    ? (accent ? "rgba(239,68,68,0.08)" : "rgba(74,222,128,0.06)")
    : (accent ? "rgba(220,50,50,0.06)" : "rgba(0,0,0,0.04)");
  const borderColor = dark
    ? (accent ? "rgba(239,68,68,0.25)" : "rgba(74,222,128,0.15)")
    : (accent ? "rgba(200,50,50,0.2)" : "rgba(0,0,0,0.08)");
  const valueColor = dark
    ? (accent ? "#ef4444" : "#4ade80")
    : (accent ? "#B03030" : "#1A1510");
  const labelColor = dark ? "rgba(74,222,128,0.5)" : "rgba(26,21,16,0.45)";
  const pulseColor = dark ? "#ef4444" : "#B03030";

  return (
    <motion.div
      variants={chipVariants}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "4px 12px",
        borderRadius: 8,
        background: bg,
        border: `1px solid ${borderColor}`,
        gap: 1,
      }}
    >
      {pulse && (
        <span
          style={{
            position: "absolute",
            top: 4,
            right: 4,
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: pulseColor,
            animation: "ping 1.5s cubic-bezier(0,0,0.2,1) infinite",
          }}
        />
      )}
      <span
        style={{
          fontFamily: "var(--font-dm-serif)",
          fontSize: 18,
          lineHeight: 1,
          color: valueColor,
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontSize: 9,
          color: labelColor,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontFamily: "var(--font-sans)",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
    </motion.div>
  );
}

export default function DashboardStatsStrip({
  totalAnimals,
  inspectedLabel,
  alertLabel,
  alertAccent,
  alertPulse,
  crossSpeciesTotal,
  modeLabel,
}: {
  /**
   * Primary headline number. On multi-species farms this is the
   * mode-filtered Active count (e.g. 88 active cattle); on single-species
   * farms it is the cross-species Active total. The label adapts via
   * `modeLabel`.
   */
  totalAnimals: number;
  inspectedLabel: string;
  alertLabel: string | number;
  alertAccent: boolean;
  alertPulse: boolean;
  /**
   * Cross-species Active total. Only rendered as a second chip when (a)
   * provided by the caller (caller decides based on `isMultiMode`) AND
   * (b) it differs from `totalAnimals` — otherwise a duplicate chip is
   * noise. See Wave A3 dispatch + `__tests__/counts/cross-surface-divergence.test.ts`.
   */
  crossSpeciesTotal?: number;
  /**
   * Label for the primary chip on multi-species farms (e.g. "Cattle").
   * When omitted, the primary chip falls back to the legacy
   * "Total Animals" label used on single-species farms.
   */
  modeLabel?: string;
}) {
  const showDualChip =
    crossSpeciesTotal !== undefined &&
    modeLabel !== undefined &&
    crossSpeciesTotal !== totalAnimals;
  const primaryLabel = showDualChip ? modeLabel : "Total Animals";

  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.07, delayChildren: 0.1 } } }}
      style={{ display: "flex", gap: 6, flex: 1, justifyContent: "center" }}
    >
      <StatChip label={primaryLabel} value={totalAnimals} />
      {showDualChip && <StatChip label="Total" value={crossSpeciesTotal} />}
      <StatChip label="Inspected" value={inspectedLabel} />
      <StatChip
        label="Active Alerts"
        value={alertLabel}
        accent={alertAccent}
        pulse={alertPulse}
      />
    </motion.div>
  );
}
