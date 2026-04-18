"use client";

/**
 * ConfidenceBadge — visual pill indicator for AI mapping confidence.
 *
 * Bands match the spec in schema-dictionary.ts:
 *   >= 0.85  -> green  "High"        (auto-apply safe)
 *   0.5-0.85 -> yellow "Review"      (farmer should confirm)
 *   < 0.5    -> red    "Manual"      (AI is guessing; override required)
 *
 * Rounded-full pill, xs text. Dark-theme aware color choices.
 */
type Props = { confidence: number };

type Band = {
  label: string;
  className: string;
};

function bandFor(confidence: number): Band {
  if (confidence >= 0.85) {
    return {
      label: "High",
      className: "bg-green-700 text-white",
    };
  }
  if (confidence >= 0.5) {
    return {
      label: "Review",
      className: "bg-yellow-500 text-stone-900",
    };
  }
  return {
    label: "Manual",
    className: "bg-red-600 text-white",
  };
}

export function ConfidenceBadge({ confidence }: Props) {
  const { label, className } = bandFor(confidence);
  const pct = Math.round(Math.max(0, Math.min(1, confidence)) * 100);

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}
      title={`Confidence: ${pct}% — ${
        label === "High"
          ? "High confidence"
          : label === "Review"
            ? "Review suggested"
            : "Manual mapping required"
      }`}
    >
      {pct}% · {label}
    </span>
  );
}
