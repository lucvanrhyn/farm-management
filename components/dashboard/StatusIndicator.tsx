import type { GrazingQuality, WaterStatus, FenceStatus } from "@/lib/types";

type StatusType = "grazing" | "water" | "fence";
type StatusValue = GrazingQuality | WaterStatus | FenceStatus;

// Warm farm palette
const STATUS_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  Good:       { bg: "rgba(74,124,89,0.18)",   text: "#6FAB80", border: "rgba(74,124,89,0.4)"  },
  Fair:       { bg: "rgba(139,105,20,0.18)",  text: "#C4A030", border: "rgba(139,105,20,0.4)" },
  Poor:       { bg: "rgba(160,82,45,0.20)",   text: "#D07848", border: "rgba(160,82,45,0.4)"  },
  Overgrazed: { bg: "rgba(139,58,58,0.22)",   text: "#C25858", border: "rgba(139,58,58,0.45)" },
  Full:       { bg: "rgba(59,122,139,0.18)",  text: "#5AAFCA", border: "rgba(59,122,139,0.4)" },
  Low:        { bg: "rgba(139,105,20,0.18)",  text: "#C4A030", border: "rgba(139,105,20,0.4)" },
  Empty:      { bg: "rgba(160,82,45,0.20)",   text: "#D07848", border: "rgba(160,82,45,0.4)"  },
  Broken:     { bg: "rgba(139,58,58,0.22)",   text: "#C25858", border: "rgba(139,58,58,0.45)" },
  Intact:     { bg: "rgba(74,124,89,0.18)",   text: "#6FAB80", border: "rgba(74,124,89,0.4)"  },
  Damaged:    { bg: "rgba(139,58,58,0.22)",   text: "#C25858", border: "rgba(139,58,58,0.45)" },
};

const STATUS_LABELS: Record<StatusType, Record<string, string>> = {
  grazing: { Good: "Goed", Fair: "Redelik", Poor: "Swak", Overgrazed: "Oorbevolk" },
  water:   { Full: "Vol", Low: "Laag", Empty: "Leeg", Broken: "Stukkend" },
  fence:   { Intact: "Heel", Damaged: "Beskadig" },
};

const TYPE_ICONS: Record<StatusType, string> = {
  grazing: "🌿",
  water:   "💧",
  fence:   "🔒",
};

interface Props {
  type: StatusType;
  status: StatusValue;
  showIcon?: boolean;
}

export default function StatusIndicator({ type, status, showIcon = true }: Props) {
  const s = STATUS_STYLES[status] ?? {
    bg: "rgba(92,61,46,0.18)", text: "#B09878", border: "rgba(92,61,46,0.4)",
  };
  const label = STATUS_LABELS[type]?.[status] ?? status;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 8px",
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 500,
        fontFamily: "var(--font-sans)",
        background: s.bg,
        color: s.text,
        border: `1px solid ${s.border}`,
      }}
    >
      {showIcon && <span style={{ fontSize: 10 }}>{TYPE_ICONS[type]}</span>}
      {label}
    </span>
  );
}
