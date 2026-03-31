"use client";

import { useState } from "react";

export interface FarmSettingsData {
  farmName: string;
  breed: string;
  alertThresholdHours: number;
  adgPoorDoerThreshold: number;
  calvingAlertDays: number;
  daysOpenLimit: number;
  campGrazingWarningDays: number;
}

interface SettingsFormProps {
  farmSlug: string;
  initial: FarmSettingsData;
}

interface FieldConfig {
  key: keyof FarmSettingsData;
  label: string;
  description: string;
  type: "text" | "number";
  step?: number;
  min?: number;
  unit?: string;
}

const FIELD_CONFIGS: FieldConfig[] = [
  {
    key: "farmName",
    label: "Farm Name",
    description: "Display name shown across the app.",
    type: "text",
  },
  {
    key: "breed",
    label: "Primary Breed",
    description: "Primary livestock breed for your herd.",
    type: "text",
  },
  {
    key: "adgPoorDoerThreshold",
    label: "ADG Poor Doer Threshold",
    description: "Animals with an average daily gain below this value are flagged as poor doers.",
    type: "number",
    step: 0.1,
    min: 0.1,
    unit: "kg/day",
  },
  {
    key: "calvingAlertDays",
    label: "Calving Alert Window",
    description: "Number of days before expected calving to show an alert.",
    type: "number",
    step: 1,
    min: 1,
    unit: "days",
  },
  {
    key: "daysOpenLimit",
    label: "Days Open Limit",
    description: "Maximum acceptable days from calving to confirmed conception before flagging a cow.",
    type: "number",
    step: 1,
    min: 1,
    unit: "days",
  },
  {
    key: "alertThresholdHours",
    label: "Stale Inspection Alert",
    description: "Alert when a camp has not been inspected within this many hours.",
    type: "number",
    step: 1,
    min: 1,
    unit: "hours",
  },
  {
    key: "campGrazingWarningDays",
    label: "Camp Grazing Warning",
    description: "Show a warning when a camp has fewer than this many days of grazing remaining.",
    type: "number",
    step: 1,
    min: 1,
    unit: "days remaining",
  },
];

export default function SettingsForm({ farmSlug, initial }: SettingsFormProps) {
  const [values, setValues] = useState<FarmSettingsData>({ ...initial });
  const [status, setStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function handleChange(key: keyof FarmSettingsData, raw: string) {
    const field = FIELD_CONFIGS.find((f) => f.key === key);
    if (!field) return;

    if (field.type === "text") {
      setValues((prev) => ({ ...prev, [key]: raw }));
    } else {
      const parsed = parseFloat(raw);
      setValues((prev) => ({ ...prev, [key]: isNaN(parsed) ? prev[key] : parsed }));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setErrorMsg(null);

    try {
      const res = await fetch(`/api/farm/settings?farmSlug=${encodeURIComponent(farmSlug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to save settings");
      }

      setStatus("success");
      setTimeout(() => setStatus("idle"), 3000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div
        className="rounded-xl p-6"
        style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
      >
        <h2 className="text-sm font-semibold mb-5" style={{ color: "#1C1815" }}>
          Farm Identity
        </h2>
        <div className="space-y-4">
          {FIELD_CONFIGS.filter((f) => f.type === "text").map((field) => (
            <FieldRow
              key={field.key}
              field={field}
              value={String(values[field.key])}
              onChange={(v) => handleChange(field.key, v)}
            />
          ))}
        </div>
      </div>

      <div
        className="rounded-xl p-6"
        style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
      >
        <h2 className="text-sm font-semibold mb-5" style={{ color: "#1C1815" }}>
          Threshold Settings
        </h2>
        <div className="space-y-4">
          {FIELD_CONFIGS.filter((f) => f.type === "number").map((field) => (
            <FieldRow
              key={field.key}
              field={field}
              value={String(values[field.key])}
              onChange={(v) => handleChange(field.key, v)}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={status === "saving"}
          className="px-5 py-2 rounded-lg text-sm font-medium transition-opacity disabled:opacity-60"
          style={{ background: "#4A7C59", color: "#FFFFFF" }}
        >
          {status === "saving" ? "Saving…" : "Save Settings"}
        </button>

        {status === "success" && (
          <p className="text-sm font-medium" style={{ color: "#4A7C59" }}>
            Settings saved successfully.
          </p>
        )}
        {status === "error" && errorMsg && (
          <p className="text-sm font-medium" style={{ color: "#8B3A3A" }}>
            {errorMsg}
          </p>
        )}
      </div>
    </form>
  );
}

function FieldRow({
  field,
  value,
  onChange,
}: {
  field: FieldConfig;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4 items-start py-3"
      style={{ borderBottom: "1px solid #F0E8DE" }}
    >
      <div className="sm:col-span-1">
        <label className="block text-sm font-medium" style={{ color: "#1C1815" }}>
          {field.label}
          {field.unit && (
            <span className="ml-1.5 text-xs font-mono" style={{ color: "#9C8E7A" }}>
              ({field.unit})
            </span>
          )}
        </label>
        <p className="text-xs mt-0.5" style={{ color: "#9C8E7A" }}>
          {field.description}
        </p>
      </div>
      <div className="sm:col-span-2">
        <input
          type={field.type === "number" ? "number" : "text"}
          value={value}
          step={field.step}
          min={field.min}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg px-3 py-2 text-sm font-mono outline-none transition-colors"
          style={{
            background: "#FAFAF8",
            border: "1px solid #E0D5C8",
            color: "#1C1815",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "#4A7C59";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "#E0D5C8";
          }}
        />
      </div>
    </div>
  );
}
