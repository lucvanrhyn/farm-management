"use client";

export interface DeclarationState {
  noEid: boolean;
  noWithdrawal: boolean;
  noDisease: boolean;
  noSymptoms: boolean;
  noPests: boolean;
  properlyIdentified: boolean;
  accurateInfo: boolean;
  notes: string;
}

export const DEFAULT_DECLARATIONS: DeclarationState = {
  noEid: false,
  noWithdrawal: false,
  noDisease: false,
  noSymptoms: false,
  noPests: false,
  properlyIdentified: false,
  accurateInfo: false,
  notes: "",
};

const DECLARATION_ITEMS: Array<{ key: keyof Omit<DeclarationState, "notes">; label: string; tooltip: string }> = [
  {
    key: "noEid",
    label: "No EID devices implanted",
    tooltip: "No electronic identification devices (transponders/chips) are implanted in any of these animals.",
  },
  {
    key: "noWithdrawal",
    label: "No animals in withdrawal period",
    tooltip: "No animals are currently within a withholding or withdrawal period for any veterinary product (antibiotics, dip, dewormer, etc.).",
  },
  {
    key: "noDisease",
    label: "No known notifiable disease on property",
    tooltip: "No notifiable animal disease (e.g. FMD, brucellosis, TB) is known to be present on the property of origin.",
  },
  {
    key: "noSymptoms",
    label: "No clinical signs of disease in last 30 days",
    tooltip: "No clinical signs of infectious or contagious disease have been observed in any of the animals in the last 30 days.",
  },
  {
    key: "noPests",
    label: "No pest-control treatment in last 7 days",
    tooltip: "None of these animals have been treated with external parasiticides or pest-control substances within the last 7 days.",
  },
  {
    key: "properlyIdentified",
    label: "All animals properly identified",
    tooltip: "All animals are properly identified by ear tag, brand, or tattoo as required by applicable legislation.",
  },
  {
    key: "accurateInfo",
    label: "Information is accurate and complete",
    tooltip: "The information provided in this declaration is accurate and complete to the best of my knowledge.",
  },
];

interface NvdDeclarationsProps {
  value: DeclarationState;
  onChange: (next: DeclarationState) => void;
}

export default function NvdDeclarations({ value, onChange }: NvdDeclarationsProps) {
  function toggle(key: keyof Omit<DeclarationState, "notes">) {
    onChange({ ...value, [key]: !value[key] });
  }

  const allChecked = DECLARATION_ITEMS.every((item) => value[item.key]);

  function checkAll() {
    const next = { ...value };
    for (const item of DECLARATION_ITEMS) {
      (next as Record<string, unknown>)[item.key] = !allChecked;
    }
    onChange(next);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#9C8E7A" }}>
          Vendor Declarations
        </p>
        <button
          type="button"
          onClick={checkAll}
          className="text-xs font-medium px-2 py-0.5 rounded"
          style={{ color: "#4A7C59", background: "rgba(74,124,89,0.08)" }}
        >
          {allChecked ? "Uncheck all" : "Check all"}
        </button>
      </div>

      {DECLARATION_ITEMS.map((item) => (
        <label
          key={item.key}
          title={item.tooltip}
          className="flex items-start gap-3 cursor-pointer rounded-lg p-2.5 transition-colors"
          style={{
            background: value[item.key] ? "rgba(74,124,89,0.06)" : "#FAFAF8",
            border: "1px solid",
            borderColor: value[item.key] ? "rgba(74,124,89,0.25)" : "#E0D5C8",
          }}
        >
          <input
            type="checkbox"
            checked={value[item.key]}
            onChange={() => toggle(item.key)}
            className="mt-0.5 shrink-0 w-4 h-4 rounded"
            style={{ accentColor: "#4A7C59" }}
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium" style={{ color: "#1C1815" }}>
              {item.label}
            </p>
            <p className="text-xs mt-0.5" style={{ color: "#9C8E7A" }}>
              {item.tooltip}
            </p>
          </div>
        </label>
      ))}

      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: "#9C8E7A" }}>
          Notes (optional)
        </label>
        <textarea
          value={value.notes}
          onChange={(e) => onChange({ ...value, notes: e.target.value })}
          placeholder="Any additional remarks or qualifications..."
          rows={2}
          className="w-full rounded-lg px-3 py-2 text-sm outline-none resize-none"
          style={{
            background: "#FAFAF8",
            border: "1px solid #E0D5C8",
            color: "#1C1815",
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = "#4A7C59")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "#E0D5C8")}
        />
      </div>
    </div>
  );
}
