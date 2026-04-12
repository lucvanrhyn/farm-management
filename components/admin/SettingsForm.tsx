"use client";

import { useState, useRef, useEffect } from "react";

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
  // Rotation Defaults
  defaultRestDays: number;
  defaultMaxGrazingDays: number;
  rotationSeasonMode: "auto" | "growing" | "dormant";
  dormantSeasonMultiplier: number;
  // AI Integration — key is never returned from server; only whether one is configured
  openaiApiKeyConfigured: boolean;
  // Biome
  biomeType: string | null;
  // NVD Seller Identity
  ownerName: string;
  ownerIdNumber: string;
  physicalAddress: string;
  postalAddress: string;
  contactPhone: string;
  contactEmail: string;
  propertyRegNumber: string;
  farmRegion: string;
}

interface SettingsFormProps {
  farmSlug: string;
  initial: FarmSettingsData;
}

function PushNotificationToggle() {
  const [pushStatus, setPushStatus] = useState<"idle" | "subscribed" | "denied" | "loading">("idle");

  async function handleEnable() {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setPushStatus("denied");
      return;
    }

    setPushStatus("loading");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setPushStatus("denied");
      return;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      setPushStatus("subscribed");
    } catch {
      setPushStatus("denied");
    }
  }

  function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = atob(base64);
    const buffer = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) {
      buffer[i] = rawData.charCodeAt(i);
    }
    return buffer.buffer;
  }

  return (
    <div
      className="rounded-xl p-4 mb-2"
      style={{ background: "#FAFAF8", border: "1px solid #E0D5C8" }}
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium" style={{ color: "#1C1815" }}>
            Push Notifications
          </p>
          <p className="text-xs mt-0.5" style={{ color: "#9C8E7A" }}>
            {pushStatus === "subscribed"
              ? "Enabled — you'll receive alerts for critical farm events."
              : pushStatus === "denied"
              ? "Permission denied. Enable notifications in your browser settings."
              : "Receive push alerts for calving, poor doers, and grazing warnings on this device."}
          </p>
        </div>
        {pushStatus !== "subscribed" && pushStatus !== "denied" && (
          <button
            type="button"
            onClick={() => void handleEnable()}
            disabled={pushStatus === "loading"}
            className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-opacity disabled:opacity-60"
            style={{ background: "#4A7C59", color: "#FFFFFF" }}
          >
            {pushStatus === "loading" ? "Enabling…" : "Enable"}
          </button>
        )}
        {pushStatus === "subscribed" && (
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(74,124,89,0.12)", color: "#2D6A4F" }}>
            Active
          </span>
        )}
      </div>
    </div>
  );
}

export default function SettingsForm({ farmSlug, initial }: SettingsFormProps) {
  const [values, setValues] = useState<FarmSettingsData>({ ...initial });
  const [status, setStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);
  // Separate state for new API key input — never pre-filled from server
  const [newApiKey, setNewApiKey] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

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
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setStatus("idle"), 3000);
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

      {/* ── Rotation Defaults ─────────────────────────────────────────── */}
      <Section title="Rotation Defaults">
        <FieldRow label="Default Rest Days" description="How long to let a camp recover after grazing before it can receive a mob again.">
          <input
            type="number"
            step="1"
            min="1"
            value={values.defaultRestDays}
            onChange={(e) => handleNumber("defaultRestDays", e.target.value)}
            className={inputCls}
            style={inputStyle}
            onFocus={focusStyle}
            onBlur={blurStyle}
          />
        </FieldRow>
        <FieldRow label="Max Grazing Days" description="Trigger an `overstayed` alert after a mob has been on a camp for this many days.">
          <input
            type="number"
            step="1"
            min="1"
            value={values.defaultMaxGrazingDays}
            onChange={(e) => handleNumber("defaultMaxGrazingDays", e.target.value)}
            className={inputCls}
            style={inputStyle}
            onFocus={focusStyle}
            onBlur={blurStyle}
          />
        </FieldRow>
        <FieldRow label="Season Mode" description="Auto uses SA summer-rainfall calendar (Oct–Mar growing, Apr–Sep dormant).">
          <select
            value={values.rotationSeasonMode}
            onChange={(e) =>
              setValues((prev) => ({
                ...prev,
                rotationSeasonMode: e.target.value as "auto" | "growing" | "dormant",
              }))
            }
            className={inputCls}
            style={inputStyle}
            onFocus={focusStyle}
            onBlur={blurStyle}
          >
            <option value="auto">Auto (by calendar)</option>
            <option value="growing">Growing (always)</option>
            <option value="dormant">Dormant (always)</option>
          </select>
        </FieldRow>
        <FieldRow label="Dormant Season Multiplier" description="Extend rest days by this factor in the dormant season (default 1.4).">
          <input
            type="number"
            step="0.1"
            min="1"
            value={values.dormantSeasonMultiplier}
            onChange={(e) => handleNumber("dormantSeasonMultiplier", e.target.value)}
            className={inputCls}
            style={inputStyle}
            onFocus={focusStyle}
            onBlur={blurStyle}
          />
        </FieldRow>
      </Section>

      {/* ── Biome ─────────────────────────────────────────────────────── */}
      <Section title="Biome">
        <FieldRow label="Biome type" description="Determines the grazing-capacity baseline used by Veld Condition Scoring.">
          <select
            value={values.biomeType ?? ''}
            onChange={(e) =>
              setValues((prev) => ({ ...prev, biomeType: e.target.value || null }))
            }
            className={inputCls}
            style={inputStyle}
            onFocus={focusStyle}
            onBlur={blurStyle}
          >
            <option value="">Not set</option>
            <option value="highveld">Highveld / grassland (≈5 ha/LSU)</option>
            <option value="bushveld">Bushveld / savanna (≈12 ha/LSU)</option>
            <option value="lowveld">Lowveld (≈10 ha/LSU)</option>
            <option value="karoo">Karoo / Nama-karoo (≈30 ha/LSU)</option>
            <option value="mixedveld">Mixedveld (≈15 ha/LSU)</option>
          </select>
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

      {/* ── Seller Details for NVDs ───────────────────────────────────── */}
      <Section title="Seller Details for NVDs">
        <FieldRow label="Owner / Seller Name" description="Full name of the seller as it appears on the NVD.">
          <input
            type="text"
            value={values.ownerName}
            onChange={(e) => handleText("ownerName", e.target.value)}
            placeholder="e.g. J. van der Merwe"
            className={inputCls}
            style={inputStyle}
            onFocus={focusStyle}
            onBlur={blurStyle}
          />
        </FieldRow>
        <FieldRow label="SA ID Number (optional)" description="Seller's South African ID number — fill at your own discretion.">
          <input
            type="text"
            value={values.ownerIdNumber}
            onChange={(e) => handleText("ownerIdNumber", e.target.value)}
            placeholder="e.g. 8001015009087"
            className={inputCls}
            style={inputStyle}
            onFocus={focusStyle}
            onBlur={blurStyle}
          />
        </FieldRow>
        <FieldRow label="Physical Address" description="Farm physical address for the NVD seller block.">
          <input
            type="text"
            value={values.physicalAddress}
            onChange={(e) => handleText("physicalAddress", e.target.value)}
            placeholder="e.g. Plaas Doornhoek, Vaalwater, 0530"
            className={inputCls}
            style={inputStyle}
            onFocus={focusStyle}
            onBlur={blurStyle}
          />
        </FieldRow>
        <FieldRow label="Postal Address" description="Postal address (leave blank if same as physical).">
          <input
            type="text"
            value={values.postalAddress}
            onChange={(e) => handleText("postalAddress", e.target.value)}
            placeholder="e.g. P.O. Box 12, Vaalwater, 0530"
            className={inputCls}
            style={inputStyle}
            onFocus={focusStyle}
            onBlur={blurStyle}
          />
        </FieldRow>
        <FieldRow label="Contact Phone" description="Seller contact number on the NVD.">
          <input
            type="tel"
            value={values.contactPhone}
            onChange={(e) => handleText("contactPhone", e.target.value)}
            placeholder="e.g. 082 555 1234"
            className={inputCls}
            style={inputStyle}
            onFocus={focusStyle}
            onBlur={blurStyle}
          />
        </FieldRow>
        <FieldRow label="Contact Email" description="Seller email address for buyer correspondence.">
          <input
            type="email"
            value={values.contactEmail}
            onChange={(e) => handleText("contactEmail", e.target.value)}
            placeholder="e.g. boer@plaas.co.za"
            className={inputCls}
            style={inputStyle}
            onFocus={focusStyle}
            onBlur={blurStyle}
          />
        </FieldRow>
        <FieldRow label="Property Reg / LPHS Number" description="SA property registration or Livestock Production Health System number.">
          <input
            type="text"
            value={values.propertyRegNumber}
            onChange={(e) => handleText("propertyRegNumber", e.target.value)}
            placeholder="e.g. LP-2024-00123"
            className={inputCls}
            style={inputStyle}
            onFocus={focusStyle}
            onBlur={blurStyle}
          />
        </FieldRow>
        <FieldRow label="Farm District / Province" description="Region where the farm is located.">
          <input
            type="text"
            value={values.farmRegion}
            onChange={(e) => handleText("farmRegion", e.target.value)}
            placeholder="e.g. Limpopo, Waterberg District"
            className={inputCls}
            style={inputStyle}
            onFocus={focusStyle}
            onBlur={blurStyle}
          />
        </FieldRow>
      </Section>

      {/* ── Push Notifications ────────────────────────────────────────── */}
      <PushNotificationToggle />

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

function focusStyle(
  e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
) {
  e.currentTarget.style.borderColor = "#4A7C59";
}

function blurStyle(
  e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
) {
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
