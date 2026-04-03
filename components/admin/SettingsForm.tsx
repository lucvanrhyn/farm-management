"use client";

import { useState } from "react";

export interface FarmSettingsData {
  // Farm Identity
  farmName: string;
  breed: string;
  // Thresholds
  alertThresholdHours: number;
  adgPoorDoerThreshold: number;
  calvingAlertDays: number;
  daysOpenLimit: number;
  campGrazingWarningDays: number;
  targetStockingRate: number | null;
  // Location
  latitude: number | null;
  longitude: number | null;
  // Breeding
  breedingSeasonStart: string;
  breedingSeasonEnd: string;
  weaningDate: string;
  // AI Integration — key is never returned from server; only whether one is configured
  openaiApiKeyConfigured: boolean;
}

interface SettingsFormProps {
  farmSlug: string;
  initial: FarmSettingsData;
}

export default function SettingsForm({ farmSlug, initial }: SettingsFormProps) {
  const [values, setValues] = useState<FarmSettingsData>({ ...initial });
  const [status, setStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);
  // Separate state for new API key input — never pre-filled from server
  const [newApiKey, setNewApiKey] = useState("");

  function handleText(key: keyof FarmSettingsData, raw: string) {
    setValues((prev) => ({ ...prev, [key]: raw }));
  }

  function handleNumber(key: keyof FarmSettingsData, raw: string) {
    const parsed = parseFloat(raw);
    setValues((prev) => ({ ...prev, [key]: isNaN(parsed) ? prev[key] : parsed }));
  }

  function handleNullableNumber(key: keyof FarmSettingsData, raw: string) {
    if (raw === "" || raw === null) {
      setValues((prev) => ({ ...prev, [key]: null }));
    } else {
      const parsed = parseFloat(raw);
      setValues((prev) => ({ ...prev, [key]: isNaN(parsed) ? prev[key] : parsed }));
    }
  }

  function handleUseMyLocation() {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser.");
      return;
    }
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setValues((prev) => ({
          ...prev,
          latitude: Math.round(pos.coords.latitude * 1_000_000) / 1_000_000,
          longitude: Math.round(pos.coords.longitude * 1_000_000) / 1_000_000,
        }));
        setGeoLoading(false);
      },
      () => {
        alert("Could not retrieve your location. Please check browser permissions.");
        setGeoLoading(false);
      }
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setErrorMsg(null);

    try {
      // Build the payload — exclude openaiApiKeyConfigured (read-only status flag),
      // include openaiApiKey only if the user typed a new one or explicitly cleared it
      const { openaiApiKeyConfigured: _ignored, ...settingsPayload } = values;
      const payload: Record<string, unknown> = { ...settingsPayload };
      if (newApiKey.trim()) {
        payload.openaiApiKey = newApiKey.trim();
      }

      const res = await fetch(`/api/farm/settings?farmSlug=${encodeURIComponent(farmSlug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
      {/* ── Farm Identity ─────────────────────────────────────────────── */}
      <Section title="Farm Identity">
        <FieldRow label="Farm Name" description="Display name shown across the app.">
          <input
            type="text"
            value={values.farmName}
            onChange={(e) => handleText("farmName", e.target.value)}
            className={inputCls}
            style={inputStyle}
            onFocus={focusStyle}
            onBlur={blurStyle}
          />
        </FieldRow>
        <FieldRow label="Primary Breed" description="Primary livestock breed for your herd.">
          <input
            type="text"
            value={values.breed}
            onChange={(e) => handleText("breed", e.target.value)}
            className={inputCls}
            style={inputStyle}
            onFocus={focusStyle}
            onBlur={blurStyle}
          />
        </FieldRow>
      </Section>

      {/* ── Location ──────────────────────────────────────────────────── */}
      <Section title="Location">
        <FieldRow label="Latitude" description="Farm latitude used for weather data.">
          <input
            type="number"
            step="0.000001"
            value={values.latitude ?? ""}
            onChange={(e) => handleNullableNumber("latitude", e.target.value)}
            placeholder="e.g. -33.9249"
            className={inputCls}
            style={inputStyle}
            onFocus={focusStyle}
            onBlur={blurStyle}
          />
        </FieldRow>
        <FieldRow label="Longitude" description="Farm longitude used for weather data.">
          <input
            type="number"
            step="0.000001"
            value={values.longitude ?? ""}
            onChange={(e) => handleNullableNumber("longitude", e.target.value)}
            placeholder="e.g. 18.4241"
            className={inputCls}
            style={inputStyle}
            onFocus={focusStyle}
            onBlur={blurStyle}
          />
        </FieldRow>
        <div className="py-3">
          <button
            type="button"
            onClick={handleUseMyLocation}
            disabled={geoLoading}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-opacity disabled:opacity-60"
            style={{ background: "rgba(74,124,89,0.12)", color: "#4A7C59", border: "1px solid rgba(74,124,89,0.3)" }}
          >
            {geoLoading ? "Detecting…" : "Use My Location"}
          </button>
          <p className="text-xs mt-1.5" style={{ color: "#9C8E7A" }}>
            Fills latitude and longitude from your browser's GPS.
          </p>
        </div>
      </Section>

      {/* ── Thresholds ────────────────────────────────────────────────── */}
      <Section title="Thresholds">
        <FieldRow label="ADG Poor Doer Threshold (kg/day)" description="Animals with average daily gain below this are flagged as poor doers.">
          <input
            type="number"
            step="0.1"
            min="0.1"
            value={values.adgPoorDoerThreshold}
            onChange={(e) => handleNumber("adgPoorDoerThreshold", e.target.value)}
            className={inputCls}
            style={inputStyle}
            onFocus={focusStyle}
            onBlur={blurStyle}
          />
        </FieldRow>
        <FieldRow label="Calving Alert Window (days)" description="Number of days before expected calving to show an alert.">
          <input
            type="number"
            step="1"
            min="1"
            value={values.calvingAlertDays}
            onChange={(e) => handleNumber("calvingAlertDays", e.target.value)}
            className={inputCls}
            style={inputStyle}
            onFocus={focusStyle}
            onBlur={blurStyle}
          />
        </FieldRow>
        <FieldRow label="Days Open Limit (days)" description="Max acceptable days from calving to conception before flagging.">
          <input
            type="number"
            step="1"
            min="1"
            value={values.daysOpenLimit}
            onChange={(e) => handleNumber("daysOpenLimit", e.target.value)}
            className={inputCls}
            style={inputStyle}
            onFocus={focusStyle}
            onBlur={blurStyle}
          />
        </FieldRow>
        <FieldRow label="Stale Inspection Alert (hours)" description="Alert when a camp has not been inspected within this many hours.">
          <input
            type="number"
            step="1"
            min="1"
            value={values.alertThresholdHours}
            onChange={(e) => handleNumber("alertThresholdHours", e.target.value)}
            className={inputCls}
            style={inputStyle}
            onFocus={focusStyle}
            onBlur={blurStyle}
          />
        </FieldRow>
        <FieldRow label="Camp Grazing Warning (days remaining)" description="Show a warning when a camp has fewer than this many days of grazing remaining.">
          <input
            type="number"
            step="1"
            min="1"
            value={values.campGrazingWarningDays}
            onChange={(e) => handleNumber("campGrazingWarningDays", e.target.value)}
            className={inputCls}
            style={inputStyle}
            onFocus={focusStyle}
            onBlur={blurStyle}
          />
        </FieldRow>
        <FieldRow label="Target Stocking Rate" description="Target stocking rate for the farm (optional).">
          <input
            type="number"
            step="0.1"
            min="0"
            value={values.targetStockingRate ?? ""}
            onChange={(e) => handleNullableNumber("targetStockingRate", e.target.value)}
            placeholder="Optional"
            className={inputCls}
            style={inputStyle}
            onFocus={focusStyle}
            onBlur={blurStyle}
          />
        </FieldRow>
      </Section>

      {/* ── Breeding ──────────────────────────────────────────────────── */}
      <Section title="Breeding">
        <FieldRow label="Breeding Season Start (MM-DD)" description="Start of breeding season, e.g. 10-01 for October 1.">
          <input
            type="text"
            value={values.breedingSeasonStart}
            onChange={(e) => handleText("breedingSeasonStart", e.target.value)}
            placeholder="MM-DD"
            className={inputCls}
            style={inputStyle}
            onFocus={focusStyle}
            onBlur={blurStyle}
          />
        </FieldRow>
        <FieldRow label="Breeding Season End (MM-DD)" description="End of breeding season, e.g. 12-31 for December 31.">
          <input
            type="text"
            value={values.breedingSeasonEnd}
            onChange={(e) => handleText("breedingSeasonEnd", e.target.value)}
            placeholder="MM-DD"
            className={inputCls}
            style={inputStyle}
            onFocus={focusStyle}
            onBlur={blurStyle}
          />
        </FieldRow>
        <FieldRow label="Weaning Date (MM-DD)" description="Annual weaning date, e.g. 08-15 for August 15.">
          <input
            type="text"
            value={values.weaningDate}
            onChange={(e) => handleText("weaningDate", e.target.value)}
            placeholder="MM-DD"
            className={inputCls}
            style={inputStyle}
            onFocus={focusStyle}
            onBlur={blurStyle}
          />
        </FieldRow>
      </Section>

      {/* ── AI Integration ────────────────────────────────────────────── */}
      <Section title="AI Integration">
        <FieldRow
          label="OpenAI API Key"
          description={
            values.openaiApiKeyConfigured
              ? "A key is configured. Enter a new key below to replace it."
              : "Enter your OpenAI API key to enable AI-powered breeding recommendations."
          }
        >
          <div className="space-y-2">
            {values.openaiApiKeyConfigured && (
              <p className="text-xs font-medium" style={{ color: "#4A7C59" }}>
                ✓ Key configured
              </p>
            )}
            <div className="relative">
              <input
                type={showApiKey ? "text" : "password"}
                value={newApiKey}
                onChange={(e) => setNewApiKey(e.target.value)}
                placeholder={values.openaiApiKeyConfigured ? "Enter new key to replace…" : "sk-…"}
                autoComplete="off"
                className={inputCls}
                style={{ ...inputStyle, paddingRight: 80 }}
                onFocus={focusStyle}
                onBlur={blurStyle}
              />
              <button
                type="button"
                onClick={() => setShowApiKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium px-2 py-1 rounded"
                style={{ color: "#9C8E7A", background: "rgba(0,0,0,0.04)" }}
              >
                {showApiKey ? "Hide" : "Show"}
              </button>
            </div>
          </div>
        </FieldRow>
      </Section>

      {/* ── Save button ───────────────────────────────────────────────── */}
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

// ── Shared styling ────────────────────────────────────────────────────────────

const inputCls = "w-full rounded-lg px-3 py-2 text-sm font-mono outline-none transition-colors";
const inputStyle: React.CSSProperties = {
  background: "#FAFAF8",
  border: "1px solid #E0D5C8",
  color: "#1C1815",
};

function focusStyle(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) {
  e.currentTarget.style.borderColor = "#4A7C59";
}

function blurStyle(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) {
  e.currentTarget.style.borderColor = "#E0D5C8";
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl p-6"
      style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
    >
      <h2 className="text-sm font-semibold mb-5" style={{ color: "#1C1815" }}>
        {title}
      </h2>
      <div className="space-y-0">{children}</div>
    </div>
  );
}

// ── Field row ─────────────────────────────────────────────────────────────────

function FieldRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4 items-start py-3"
      style={{ borderBottom: "1px solid #F0E8DE" }}
    >
      <div className="sm:col-span-1">
        <label className="block text-sm font-medium" style={{ color: "#1C1815" }}>
          {label}
        </label>
        <p className="text-xs mt-0.5" style={{ color: "#9C8E7A" }}>
          {description}
        </p>
      </div>
      <div className="sm:col-span-2">{children}</div>
    </div>
  );
}
