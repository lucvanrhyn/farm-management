"use client";

import type { ProposalResult } from "@/lib/onboarding/client-types";

type Props = {
  unmapped: ProposalResult["proposal"]["unmapped"];
  /** source -> target overrides the farmer has manually assigned. */
  unmappedOverrides: Record<string, string>;
  targetOptions: Array<{ value: string; label: string }>;
  onAssign: (source: string, target: string) => void;
};

/**
 * UnmappedList — columns the AI could not place with confidence.
 *
 * Each item surfaces:
 *   - source column name
 *   - up to 3 sample values
 *   - the upsell_hint (kept muted — this is Consulting-tier fodder)
 *   - a target <select> so the farmer can rescue the column manually
 *
 * Returns null when there are no unmapped columns so the page doesn't render
 * a bare heading over an empty list.
 */
export function UnmappedList({
  unmapped,
  unmappedOverrides,
  targetOptions,
  onAssign,
}: Props) {
  if (!unmapped || unmapped.length === 0) {
    return null;
  }

  return (
    <section className="mt-8">
      <h3
        className="text-base font-semibold mb-1"
        style={{
          color: "#F0DEB8",
          fontFamily: "var(--font-display)",
        }}
      >
        Columns we couldn&apos;t place
      </h3>
      <p
        className="text-xs mb-4"
        style={{
          color: "#8A6840",
          fontFamily: "var(--font-sans)",
        }}
      >
        These look like custom data the core importer doesn&apos;t handle. Leave
        them unmapped to skip, or assign a target if we missed something.
      </p>

      <div className="flex flex-col gap-3">
        {unmapped.map((item) => {
          const samples = item.samples
            .slice(0, 3)
            .map((s) => (s.length > 28 ? `${s.slice(0, 25)}...` : s));
          const current = unmappedOverrides[item.source] ?? "";

          return (
            <div
              key={item.source}
              className="rounded-xl p-4"
              style={{
                background: "#1F1810",
                border: "1px dashed rgba(196,144,48,0.25)",
              }}
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:gap-4">
                <div className="flex-1 min-w-0">
                  <div
                    className="font-semibold text-sm"
                    style={{
                      color: "#F0DEB8",
                      fontFamily: "var(--font-sans)",
                    }}
                  >
                    {item.source}
                  </div>
                  {samples.length > 0 ? (
                    <div
                      className="mt-1 text-xs"
                      style={{ color: "#8A6840" }}
                    >
                      e.g. {samples.map((v) => `"${v}"`).join(", ")}
                    </div>
                  ) : null}
                  {item.upsell_hint ? (
                    <div
                      className="mt-1.5 text-[11px] italic"
                      style={{ color: "#6A4E30" }}
                    >
                      Hint: {item.upsell_hint}
                    </div>
                  ) : null}
                </div>

                <div className="flex-1 min-w-0 md:max-w-xs">
                  <label
                    className="block text-[11px] uppercase tracking-wider mb-1"
                    style={{ color: "#6A4E30" }}
                  >
                    Assign target
                  </label>
                  <select
                    value={current}
                    onChange={(e) => onAssign(item.source, e.target.value)}
                    className="w-full rounded-md px-3 py-2 text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-amber-500"
                    style={{
                      background: "#1A1510",
                      border: "1px solid rgba(196,144,48,0.28)",
                      color: "#F0DEB8",
                      fontFamily: "var(--font-sans)",
                    }}
                    aria-label={`Assign target for ${item.source}`}
                  >
                    <option value="">— Leave unmapped —</option>
                    {targetOptions
                      .filter((opt) => opt.value !== "__ignored__")
                      .map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
