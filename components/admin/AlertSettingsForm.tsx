"use client";

/**
 * Phase J7a — Preferences UI for alert notifications.
 *
 * Three-axis grid (channel × category × type) modelled on Linear's settings
 * per memory/research-phase-j-notifications.md §C. Optimistic updates with a
 * 500ms debounced save; all server state flows from PATCH responses so the
 * UI never drifts from the DB.
 *
 * Categories / channels / digest modes MUST stay in sync with the constants
 * in app/api/[farmSlug]/settings/alerts/route.ts. Adding a row here requires
 * adding it there.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Mail, Smartphone, MessageCircle } from "lucide-react";

export type AlertCategory =
  | "reproduction"
  | "performance"
  | "veld"
  | "finance"
  | "compliance"
  | "weather"
  | "predator";

export type AlertChannel = "bell" | "email" | "push" | "whatsapp";
export type DigestMode = "realtime" | "daily" | "weekly";
export type SpeciesOverride = "cattle" | "sheep" | "game" | null;

export interface AlertPreferenceRow {
  id?: string;
  userId?: string;
  category: AlertCategory;
  alertType: string | null;
  channel: AlertChannel;
  enabled: boolean;
  digestMode: DigestMode;
  speciesOverride: SpeciesOverride;
}

export interface FarmAlertSettings {
  quietHoursStart: string;
  quietHoursEnd: string;
  timezone: string;
  speciesAlertThresholds: string | null;
}

export interface AlertSettingsFormProps {
  farmSlug: string;
  isAdmin: boolean;
  initialPrefs: AlertPreferenceRow[];
  initialFarmSettings: FarmAlertSettings;
}

// ── Static config (mirrors server constants) ────────────────────────────────

const CATEGORIES: ReadonlyArray<{ key: AlertCategory; label: string; hint: string }> = [
  { key: "reproduction", label: "Reproduction", hint: "Lambing/calving/fawning due, days open, conception" },
  { key: "performance", label: "Performance", hint: "Poor doers, missing weights" },
  { key: "veld", label: "Veld / Grazing", hint: "Cover, rest days, stocking rate" },
  { key: "finance", label: "Finance", hint: "Cost-of-gain, budget variance" },
  { key: "compliance", label: "Compliance", hint: "SARS IT3, VAT deadlines, NVD" },
  { key: "weather", label: "Weather / Rainfall", hint: "Stale rainfall log, drought warnings" },
  { key: "predator", label: "Predator losses", hint: "Always realtime — safety floor" },
];

const CHANNELS: ReadonlyArray<{
  key: AlertChannel;
  label: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  advancedOnly?: boolean;
}> = [
  { key: "bell", label: "Bell", icon: Bell },
  { key: "email", label: "Email", icon: Mail },
  { key: "push", label: "Push", icon: Smartphone },
  { key: "whatsapp", label: "WhatsApp", icon: MessageCircle, advancedOnly: true },
];

const DIGEST_MODES: ReadonlyArray<DigestMode> = ["realtime", "daily", "weekly"];

// Common IANA zones the farmer is likely to want. Keep short — Intl validates
// the full list server-side.
const TIMEZONE_OPTIONS: ReadonlyArray<string> = [
  "Africa/Johannesburg",
  "Africa/Windhoek",
  "Africa/Harare",
  "Africa/Maputo",
  "Africa/Gaborone",
  "UTC",
];

// ── Pref-map helpers ────────────────────────────────────────────────────────

/**
 * Composite key used by the server's unique index. Mirrored here so the
 * optimistic UI can do O(1) lookups and so we never attempt to upsert two
 * conflicting rows in one batch.
 */
function prefKey(
  category: AlertCategory,
  channel: AlertChannel,
  speciesOverride: SpeciesOverride,
  alertType: string | null,
): string {
  return `${category}::${channel}::${speciesOverride ?? "_"}::${alertType ?? "_"}`;
}

function buildDefaultPrefs(): AlertPreferenceRow[] {
  // Default: bell+email on, push off, whatsapp off. Predator always realtime.
  const rows: AlertPreferenceRow[] = [];
  for (const cat of CATEGORIES) {
    for (const ch of CHANNELS) {
      const enabledByDefault =
        (ch.key === "bell" || ch.key === "email") && !ch.advancedOnly;
      rows.push({
        category: cat.key,
        alertType: null,
        channel: ch.key,
        enabled: enabledByDefault,
        digestMode: cat.key === "predator" ? "realtime" : "realtime",
        speciesOverride: null,
      });
    }
  }
  return rows;
}

function mergePrefsWithDefaults(initial: AlertPreferenceRow[]): AlertPreferenceRow[] {
  // Start with a full grid then overlay any rows the server already has.
  // This keeps the UI renderable even when a brand-new user has no rows yet.
  const defaults = buildDefaultPrefs();
  const indexed = new Map<string, AlertPreferenceRow>();
  for (const d of defaults) {
    indexed.set(prefKey(d.category, d.channel, d.speciesOverride, d.alertType), d);
  }
  for (const row of initial) {
    // Only merge in category-level rows for the main grid. Alert-type overrides
    // live alongside the grid but do not replace the category-level row.
    if (row.alertType === null && row.speciesOverride === null) {
      indexed.set(prefKey(row.category, row.channel, null, null), row);
    }
  }
  return Array.from(indexed.values());
}

// ── Component ───────────────────────────────────────────────────────────────

export default function AlertSettingsForm({
  farmSlug,
  isAdmin,
  initialPrefs,
  initialFarmSettings,
}: AlertSettingsFormProps) {
  const [prefs, setPrefs] = useState<AlertPreferenceRow[]>(() =>
    mergePrefsWithDefaults(initialPrefs),
  );
  const [farmSettings, setFarmSettings] = useState<FarmAlertSettings>(initialFarmSettings);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Species-override picker state — one override-category pair at a time.
  const [overrideSpecies, setOverrideSpecies] = useState<"cattle" | "sheep" | "game" | "">("");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<{
    prefs: AlertPreferenceRow[] | null;
    farmSettings: Partial<FarmAlertSettings> | null;
  }>({ prefs: null, farmSettings: null });

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const flush = useCallback(async () => {
    const payload: Record<string, unknown> = {};
    if (pendingRef.current.prefs) {
      payload.prefs = pendingRef.current.prefs.map((p) => ({
        category: p.category,
        alertType: p.alertType,
        channel: p.channel,
        enabled: p.enabled,
        digestMode: p.digestMode,
        speciesOverride: p.speciesOverride,
      }));
    }
    if (pendingRef.current.farmSettings) {
      Object.assign(payload, pendingRef.current.farmSettings);
    }
    pendingRef.current = { prefs: null, farmSettings: null };

    if (Object.keys(payload).length === 0) return;

    setStatus("saving");
    try {
      const res = await fetch(`/api/${farmSlug}/settings/alerts`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        success?: boolean;
        error?: string;
        message?: string;
        prefs?: AlertPreferenceRow[];
        farmSettings?: FarmAlertSettings;
      };
      if (!res.ok || !data.success) {
        // Specific error codes from the route — surface the message so the
        // user sees WHY, per memory/silent-failure-pattern.md.
        throw new Error(
          data.error === "ADMIN_REQUIRED_FOR_FARM_SETTINGS"
            ? "Only admins can change quiet hours / timezone."
            : data.error === "INVALID_QUIET_HOURS"
              ? "Quiet hours must be HH:mm (e.g. 20:00)."
              : data.error === "INVALID_TIMEZONE"
                ? "That timezone is not recognised."
                : data.error === "INVALID_PREF_FIELD"
                  ? data.message ?? "Invalid preference value."
                  : data.message ?? data.error ?? "Could not save.",
        );
      }
      if (data.prefs) {
        setPrefs(mergePrefsWithDefaults(data.prefs));
      }
      if (data.farmSettings) {
        setFarmSettings(data.farmSettings);
      }
      setStatus("saved");
      setErrorMsg(null);
      setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 1500);
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
    }
  }, [farmSlug]);

  const scheduleFlush = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void flush();
    }, 500);
  }, [flush]);

  function togglePref(category: AlertCategory, channel: AlertChannel) {
    // Always-on guard for whatsapp (Advanced tier only) is enforced by the
    // disabled attribute at render time; this is a defence for edge cases.
    const chMeta = CHANNELS.find((c) => c.key === channel);
    if (chMeta?.advancedOnly) return;

    setPrefs((prev) => {
      const next = prev.map((p) =>
        p.category === category &&
        p.channel === channel &&
        p.alertType === null &&
        p.speciesOverride === null
          ? { ...p, enabled: !p.enabled }
          : p,
      );
      pendingRef.current.prefs = next;
      return next;
    });
    scheduleFlush();
  }

  function changeDigestMode(category: AlertCategory, mode: DigestMode) {
    // Safety floor: predators must always be realtime.
    if (category === "predator" && mode !== "realtime") return;

    setPrefs((prev) => {
      const next = prev.map((p) =>
        p.category === category && p.alertType === null && p.speciesOverride === null
          ? { ...p, digestMode: mode }
          : p,
      );
      pendingRef.current.prefs = next;
      return next;
    });
    scheduleFlush();
  }

  function updateFarmSetting<K extends keyof FarmAlertSettings>(
    key: K,
    value: FarmAlertSettings[K],
  ) {
    if (!isAdmin) return;
    setFarmSettings((prev) => ({ ...prev, [key]: value }));
    pendingRef.current.farmSettings = {
      ...(pendingRef.current.farmSettings ?? {}),
      [key]: value,
    };
    scheduleFlush();
  }

  // Lookup a pref row for rendering the current checkbox/select state.
  function getPref(category: AlertCategory, channel: AlertChannel): AlertPreferenceRow {
    return (
      prefs.find(
        (p) =>
          p.category === category &&
          p.channel === channel &&
          p.alertType === null &&
          p.speciesOverride === null,
      ) ?? {
        category,
        channel,
        alertType: null,
        enabled: false,
        digestMode: "realtime",
        speciesOverride: null,
      }
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Global farm-scoped controls */}
      <section
        className="rounded-xl p-4"
        style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
      >
        <h2 className="text-sm font-semibold mb-3" style={{ color: "#1C1815" }}>
          Timezone & quiet hours
        </h2>
        <p className="text-xs mb-4" style={{ color: "#9C8E7A" }}>
          Non-critical push notifications are suppressed between these times in the farm&apos;s timezone.
          {!isAdmin && " Only admins can change these."}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="block">
            <span className="block text-xs font-medium mb-1" style={{ color: "#1C1815" }}>
              Timezone
            </span>
            <select
              aria-label="Timezone"
              disabled={!isAdmin}
              value={farmSettings.timezone}
              onChange={(e) => updateFarmSetting("timezone", e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm disabled:opacity-60"
              style={{ background: "#FAFAF8", border: "1px solid #E0D5C8", color: "#1C1815" }}
            >
              {TIMEZONE_OPTIONS.includes(farmSettings.timezone) ? null : (
                <option value={farmSettings.timezone}>{farmSettings.timezone}</option>
              )}
              {TIMEZONE_OPTIONS.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-medium mb-1" style={{ color: "#1C1815" }}>
              Quiet hours start
            </span>
            <input
              type="time"
              aria-label="Quiet hours start"
              disabled={!isAdmin}
              value={farmSettings.quietHoursStart}
              onChange={(e) => updateFarmSetting("quietHoursStart", e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm disabled:opacity-60"
              style={{ background: "#FAFAF8", border: "1px solid #E0D5C8", color: "#1C1815" }}
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium mb-1" style={{ color: "#1C1815" }}>
              Quiet hours end
            </span>
            <input
              type="time"
              aria-label="Quiet hours end"
              disabled={!isAdmin}
              value={farmSettings.quietHoursEnd}
              onChange={(e) => updateFarmSetting("quietHoursEnd", e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm disabled:opacity-60"
              style={{ background: "#FAFAF8", border: "1px solid #E0D5C8", color: "#1C1815" }}
            />
          </label>
        </div>
      </section>

      {/* Category × channel grid */}
      <section
        className="rounded-xl overflow-hidden"
        style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
      >
        <div className="p-4 border-b" style={{ borderColor: "#E0D5C8" }}>
          <h2 className="text-sm font-semibold" style={{ color: "#1C1815" }}>
            Alert categories
          </h2>
          <p className="text-xs mt-0.5" style={{ color: "#9C8E7A" }}>
            Per-category × per-channel toggles. Digest mode controls whether you get each alert in real-time
            or batched.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b" style={{ borderColor: "#E0D5C8", background: "#FAFAF8" }}>
                <th className="text-left px-4 py-2 font-semibold" style={{ color: "#1C1815" }}>
                  Category
                </th>
                {CHANNELS.map((ch) => (
                  <th
                    key={ch.key}
                    className="text-center px-2 py-2 font-semibold"
                    style={{ color: "#1C1815" }}
                  >
                    <div className="flex flex-col items-center gap-0.5">
                      <ch.icon className="w-3.5 h-3.5" />
                      <span>{ch.label}</span>
                      {ch.advancedOnly && (
                        <span className="text-[9px] font-normal" style={{ color: "#9C8E7A" }}>
                          Advanced
                        </span>
                      )}
                    </div>
                  </th>
                ))}
                <th className="text-center px-2 py-2 font-semibold" style={{ color: "#1C1815" }}>
                  Digest
                </th>
              </tr>
            </thead>
            <tbody>
              {CATEGORIES.map((cat) => {
                const isPredator = cat.key === "predator";
                return (
                  <tr key={cat.key} className="border-b" style={{ borderColor: "#F0E8DC" }}>
                    <td className="px-4 py-3">
                      <div className="font-medium" style={{ color: "#1C1815" }}>
                        {cat.label}
                      </div>
                      <div className="text-[11px]" style={{ color: "#9C8E7A" }}>
                        {cat.hint}
                      </div>
                    </td>
                    {CHANNELS.map((ch) => {
                      const pref = getPref(cat.key, ch.key);
                      const disabled = ch.advancedOnly;
                      return (
                        <td key={ch.key} className="text-center px-2 py-3">
                          <input
                            type="checkbox"
                            aria-label={`${cat.label} ${ch.label}`}
                            checked={pref.enabled && !disabled}
                            disabled={disabled}
                            onChange={() => togglePref(cat.key, ch.key)}
                            title={
                              disabled
                                ? "WhatsApp is an Advanced tier feature — coming soon"
                                : `${cat.label} via ${ch.label}`
                            }
                            className="w-4 h-4 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                            style={{ accentColor: "#4A7C59" }}
                          />
                        </td>
                      );
                    })}
                    <td className="text-center px-2 py-3">
                      <select
                        aria-label={`${cat.label} digest mode`}
                        disabled={isPredator}
                        value={getPref(cat.key, "bell").digestMode}
                        onChange={(e) =>
                          changeDigestMode(cat.key, e.target.value as DigestMode)
                        }
                        title={
                          isPredator
                            ? "Predator alerts always real-time"
                            : `Digest mode for ${cat.label}`
                        }
                        className="rounded px-2 py-1 text-xs disabled:opacity-60 disabled:cursor-not-allowed"
                        style={{
                          background: "#FAFAF8",
                          border: "1px solid #E0D5C8",
                          color: "#1C1815",
                        }}
                      >
                        {DIGEST_MODES.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="p-3 text-[11px]" style={{ background: "#FAFAF8", color: "#9C8E7A" }}>
          WhatsApp is an Advanced tier feature. Predator alerts are always sent in real-time.
        </div>
      </section>

      {/* Per-species override */}
      <section
        className="rounded-xl p-4"
        style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
      >
        <h2 className="text-sm font-semibold mb-1" style={{ color: "#1C1815" }}>
          Per-species overrides
        </h2>
        <p className="text-xs mb-3" style={{ color: "#9C8E7A" }}>
          Scope a category-level rule to one species only (e.g. disable lambing on cattle farms).
          Overrides are added on top of the grid above. Leave empty to apply to all species.
        </p>
        <div className="flex items-center gap-3">
          <label className="text-xs" style={{ color: "#1C1815" }}>
            Species:
          </label>
          <select
            aria-label="Species override"
            value={overrideSpecies}
            onChange={(e) =>
              setOverrideSpecies(e.target.value as "cattle" | "sheep" | "game" | "")
            }
            className="rounded px-2 py-1 text-xs"
            style={{ background: "#FAFAF8", border: "1px solid #E0D5C8", color: "#1C1815" }}
          >
            <option value="">None — applies to all species</option>
            <option value="cattle">Cattle</option>
            <option value="sheep">Sheep</option>
            <option value="game">Game</option>
          </select>
        </div>
        {overrideSpecies && (
          <div className="mt-3 text-xs" style={{ color: "#9C8E7A" }}>
            Species-scoped preference editing is coming soon — for now, category-level toggles above
            apply to this species.
          </div>
        )}
      </section>

      {/* Status strip */}
      <div className="text-xs" aria-live="polite">
        {status === "saving" && <span style={{ color: "#9C8E7A" }}>Saving…</span>}
        {status === "saved" && <span style={{ color: "#2D6A4F" }}>Saved</span>}
        {status === "error" && (
          <span style={{ color: "#B23A48" }}>Error: {errorMsg ?? "unknown"}</span>
        )}
      </div>
    </div>
  );
}
