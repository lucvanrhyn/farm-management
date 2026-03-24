"use client";

import { useState, useEffect, useCallback } from "react";
import type { Camp, ObservationType, PrismaObservation } from "@/lib/types";

const PAGE_SIZE = 50;

const OBS_TYPES: { value: ObservationType | "all"; label: string }[] = [
  { value: "all",             label: "All types" },
  { value: "camp_check",      label: "Camp inspection" },
  { value: "camp_condition",  label: "Camp condition" },
  { value: "health_issue",    label: "Health" },
  { value: "animal_movement", label: "Movement" },
  { value: "reproduction",    label: "Reproduction" },
  { value: "treatment",       label: "Treatment" },
  { value: "death",           label: "Death" },
];

const TYPE_BADGE: Record<string, { color: string; bg: string }> = {
  camp_check:      { color: "#5B9BD5", bg: "rgba(91,155,213,0.15)" },
  camp_condition:  { color: "#4AAFA0", bg: "rgba(74,175,160,0.15)" },
  health_issue:    { color: "#C0574C", bg: "rgba(192,87,76,0.15)" },
  animal_movement: { color: "#9B7ED4", bg: "rgba(155,126,212,0.15)" },
  reproduction:    { color: "#D47EB5", bg: "rgba(212,126,181,0.15)" },
  treatment:       { color: "#D4904A", bg: "rgba(212,144,74,0.15)" },
  death:           { color: "#9C8E7A", bg: "rgba(156,142,122,0.12)" },
};

const TYPE_LABEL: Record<string, string> = {
  camp_check:      "Camp inspection",
  camp_condition:  "Camp condition",
  health_issue:    "Health",
  animal_movement: "Movement",
  reproduction:    "Reproduction",
  treatment:       "Treatment",
  death:           "Death",
};

const lightSelect: React.CSSProperties = {
  background: "#FFFFFF",
  border: "1px solid #E0D5C8",
  color: "#1C1815",
  borderRadius: "0.75rem",
  padding: "0.375rem 0.75rem",
  fontSize: "0.875rem",
  outline: "none",
};

function parseDetails(raw: string): string {
  try {
    const obj = JSON.parse(raw);
    const parts: string[] = [];
    if (obj.symptoms) {
      const s = Array.isArray(obj.symptoms) ? obj.symptoms.join(", ") : obj.symptoms;
      parts.push(`Symptoms: ${s}`);
    }
    if (obj.severity) parts.push(`Severity: ${obj.severity}`);
    // camp_condition fields (DB stores as grazing/water/fence)
    if (obj.grazing) parts.push(`Grazing: ${obj.grazing}`);
    if (obj.water) parts.push(`Water: ${obj.water}`);
    if (obj.fence) parts.push(`Fence: ${obj.fence}`);
    // legacy field names
    if (obj.grazing_quality) parts.push(`Grazing: ${obj.grazing_quality}`);
    if (obj.water_status) parts.push(`Water: ${obj.water_status}`);
    if (obj.notes) parts.push(obj.notes);
    if (obj.cause) parts.push(`Cause: ${obj.cause}`);
    if (obj.drug) parts.push(`Medicine: ${obj.drug}`);
    if (obj.to_camp) parts.push(`To camp: ${obj.to_camp}`);
    return parts.join(" · ") || raw.slice(0, 120);
  } catch {
    return raw.slice(0, 120);
  }
}

interface EditModalProps {
  obs: PrismaObservation;
  onClose: () => void;
  onSaved: (updated: PrismaObservation) => void;
}

function EditModal({ obs, onClose, onSaved }: EditModalProps) {
  const [value, setValue] = useState(obs.details);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/observations/${obs.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ details: value }),
      });
      if (!res.ok) {
        const e = await res.json();
        setError(e.error ?? "Save failed");
        return;
      }
      const updated: PrismaObservation = await res.json();
      onSaved(updated);
      onClose();
    } catch {
      setError("Network error — try again");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        className="rounded-2xl w-full max-w-lg mx-4 p-6 flex flex-col gap-4"
        style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold" style={{ color: "#1C1815" }}>Edit Observation</h3>
          <button
            onClick={onClose}
            className="text-xl leading-none transition-opacity hover:opacity-70"
            style={{ color: "#9C8E7A" }}
          >
            ×
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs" style={{ color: "#9C8E7A" }}>
          <span><span className="font-semibold" style={{ color: "#6B5C4E" }}>Type:</span> {TYPE_LABEL[obs.type] ?? obs.type}</span>
          <span><span className="font-semibold" style={{ color: "#6B5C4E" }}>Camp:</span> {obs.campId}</span>
          <span><span className="font-semibold" style={{ color: "#6B5C4E" }}>Date:</span> {obs.observedAt.split("T")[0]}</span>
          {obs.animalId && <span><span className="font-semibold" style={{ color: "#6B5C4E" }}>Animal:</span> {obs.animalId}</span>}
          {obs.loggedBy && <span><span className="font-semibold" style={{ color: "#6B5C4E" }}>Logged by:</span> {obs.loggedBy}</span>}
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: "#9C8E7A" }}>Details (JSON)</label>
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={6}
            className="w-full rounded-xl px-3 py-2 text-sm font-mono focus:outline-none resize-none"
            style={{
              background: "#FFFFFF",
              border: "1px solid #E0D5C8",
              color: "#1C1815",
            }}
          />
        </div>

        {error && <p className="text-xs" style={{ color: "#C0574C" }}>{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-xl transition-colors"
            style={{
              color: "#6B5C4E",
              border: "1px solid #E0D5C8",
              background: "transparent",
            }}
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 text-sm rounded-xl transition-colors disabled:opacity-50"
            style={{ background: "#4A7C59", color: "#F5EBD4" }}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ObservationsLog() {
  const [camps, setCamps] = useState<Camp[]>([]);
  const [campFilter, setCampFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<ObservationType | "all">("all");
  const [page, setPage] = useState(1);
  const [observations, setObservations] = useState<PrismaObservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [editTarget, setEditTarget] = useState<PrismaObservation | null>(null);

  useEffect(() => {
    fetch("/api/camps")
      .then((r) => r.ok ? r.json() : [])
      .then((data: Camp[]) => setCamps(data))
      .catch(() => {});
  }, []);

  const fetchObs = useCallback(async (campVal: string, typeVal: string, pageVal: number) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (campVal !== "all") params.set("camp", campVal);
    if (typeVal !== "all") params.set("type", typeVal);
    params.set("limit", String(PAGE_SIZE + 1));
    params.set("offset", String((pageVal - 1) * PAGE_SIZE));

    try {
      const res = await fetch(`/api/observations?${params.toString()}`);
      if (!res.ok) { setObservations([]); return; }
      const data: PrismaObservation[] = await res.json();
      setHasMore(data.length > PAGE_SIZE);
      setObservations(data.slice(0, PAGE_SIZE));
    } catch {
      setObservations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchObs(campFilter, typeFilter, page);
  }, [campFilter, typeFilter, page, fetchObs]);

  function handleFilterChange(newCamp: string, newType: ObservationType | "all") {
    setCampFilter(newCamp);
    setTypeFilter(newType);
    setPage(1);
  }

  function handleSaved(updated: PrismaObservation) {
    setObservations((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
  }

  return (
    <>
      {editTarget && (
        <EditModal
          obs={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={handleSaved}
        />
      )}

      <div className="flex flex-col gap-4">
        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <select
            value={campFilter}
            onChange={(e) => handleFilterChange(e.target.value, typeFilter)}
            style={lightSelect}
          >
            <option value="all">All Camps</option>
            {camps.map((c) => <option key={c.camp_id} value={c.camp_id}>{c.camp_name}</option>)}
          </select>

          <select
            value={typeFilter}
            onChange={(e) => handleFilterChange(campFilter, e.target.value as ObservationType | "all")}
            style={lightSelect}
          >
            {OBS_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>

          {loading && <span className="self-center text-xs" style={{ color: "#9C8E7A" }}>Loading...</span>}
        </div>

        {/* Timeline list */}
        <div
          className="rounded-2xl px-6 py-4"
          style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
        >
          {!loading && observations.length === 0 && (
            <p className="text-center py-10 text-sm" style={{ color: "#9C8E7A" }}>
              No observations found.
            </p>
          )}
          <div className="flex flex-col" style={{ borderLeft: "2px solid #E0D5C8", marginLeft: "5px" }}>
            {observations.map((obs) => {
              const badge = TYPE_BADGE[obs.type] ?? { color: "#9C8E7A", bg: "rgba(156,142,122,0.12)" };
              return (
                <div
                  key={obs.id}
                  className="relative flex items-start gap-4 pl-6 py-2.5 transition-colors group rounded-lg -ml-px"
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(122,92,30,0.04)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  {/* Timeline dot */}
                  <div
                    className="absolute left-0 top-[14px] w-2.5 h-2.5 rounded-full shrink-0 -translate-x-[6px]"
                    style={{ background: badge.color, border: "2px solid #FFFFFF", boxShadow: `0 0 0 1px ${badge.color}` }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide"
                        style={{ background: badge.bg, color: badge.color }}
                      >
                        {TYPE_LABEL[obs.type] ?? obs.type}
                      </span>
                      <span className="text-xs font-semibold font-mono" style={{ color: "#1C1815" }}>
                        {obs.campId}
                      </span>
                      {obs.animalId && (
                        <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ background: "#F5F2EE", color: "#6B5C4E" }}>
                          {obs.animalId}
                        </span>
                      )}
                    </div>
                    <p className="text-xs mt-1 truncate" style={{ color: "#9C8E7A" }}>
                      {parseDetails(obs.details)}
                      {obs.editedAt && (
                        <span className="ml-1" style={{ color: "#8B6914" }} title={`Edited by ${obs.editedBy ?? "?"}`}>✎</span>
                      )}
                    </p>
                    <p className="text-[10px] mt-0.5 font-mono" style={{ color: "#C4B8AA" }}>
                      {obs.observedAt.split("T")[0]}{obs.loggedBy ? ` · ${obs.loggedBy}` : ""}
                    </p>
                  </div>
                  <button
                    onClick={() => setEditTarget(obs)}
                    className="shrink-0 px-2.5 py-1 text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{
                      border: "1px solid #E0D5C8",
                      color: "#9C8E7A",
                      background: "transparent",
                    }}
                  >
                    Edit
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Pagination */}
        <div className="flex items-center gap-2 justify-center">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1 || loading}
            className="px-3 py-1.5 text-sm rounded-lg disabled:opacity-30 transition-colors"
            style={{
              border: "1px solid #E0D5C8",
              color: "#6B5C4E",
              background: "transparent",
            }}
          >
            ← Previous
          </button>
          <span className="text-sm font-mono" style={{ color: "#9C8E7A" }}>Page {page}</span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasMore || loading}
            className="px-3 py-1.5 text-sm rounded-lg disabled:opacity-30 transition-colors"
            style={{
              border: "1px solid #E0D5C8",
              color: "#6B5C4E",
              background: "transparent",
            }}
          >
            Next →
          </button>
        </div>
      </div>
    </>
  );
}
