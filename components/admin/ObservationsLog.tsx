"use client";

import { useState, useEffect, useCallback } from "react";
import { CAMPS } from "@/lib/dummy-data";
import type { ObservationType, PrismaObservation } from "@/lib/types";

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

const TYPE_BADGE: Record<string, string> = {
  camp_check:      "bg-blue-100 text-blue-700",
  camp_condition:  "bg-teal-100 text-teal-700",
  health_issue:    "bg-red-100 text-red-700",
  animal_movement: "bg-purple-100 text-purple-700",
  reproduction:    "bg-pink-100 text-pink-700",
  treatment:       "bg-orange-100 text-orange-700",
  death:           "bg-stone-200 text-stone-700",
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

function parseDetails(raw: string): string {
  try {
    const obj = JSON.parse(raw);
    const parts: string[] = [];
    if (obj.symptoms) {
      const s = Array.isArray(obj.symptoms) ? obj.symptoms.join(", ") : obj.symptoms;
      parts.push(`Symptoms: ${s}`);
    }
    if (obj.severity) parts.push(`Severity: ${obj.severity}`);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-stone-800">Edit Observation</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700 text-xl leading-none">×</button>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs text-stone-500">
          <span><span className="font-semibold text-stone-700">Type:</span> {TYPE_LABEL[obs.type] ?? obs.type}</span>
          <span><span className="font-semibold text-stone-700">Camp:</span> {obs.campId}</span>
          <span><span className="font-semibold text-stone-700">Date:</span> {obs.observedAt.split("T")[0]}</span>
          {obs.animalId && <span><span className="font-semibold text-stone-700">Animal:</span> {obs.animalId}</span>}
          {obs.loggedBy && <span><span className="font-semibold text-stone-700">Logged by:</span> {obs.loggedBy}</span>}
        </div>

        <div>
          <label className="block text-xs font-semibold text-stone-600 mb-1">Details (JSON)</label>
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={6}
            className="w-full border border-stone-300 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
          />
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-stone-600 border border-stone-300 rounded-xl hover:bg-stone-50"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 text-sm bg-green-700 text-white rounded-xl hover:bg-green-800 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ObservationsLog() {
  const [campFilter, setCampFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<ObservationType | "all">("all");
  const [page, setPage] = useState(1);
  const [observations, setObservations] = useState<PrismaObservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [editTarget, setEditTarget] = useState<PrismaObservation | null>(null);

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
            className="border border-stone-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            <option value="all">All Camps</option>
            {CAMPS.map((c) => <option key={c.camp_id} value={c.camp_id}>{c.camp_name}</option>)}
          </select>

          <select
            value={typeFilter}
            onChange={(e) => handleFilterChange(campFilter, e.target.value as ObservationType | "all")}
            className="border border-stone-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            {OBS_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>

          {loading && <span className="self-center text-xs text-stone-400">Loading...</span>}
        </div>

        {/* Timeline list */}
        <div className="rounded-2xl border border-stone-200 bg-white shadow-sm px-4 py-3">
          {!loading && observations.length === 0 && (
            <p className="text-center py-10 text-stone-400 text-sm">No observations found.</p>
          )}
          <div className="flex flex-col">
            {observations.map((obs) => (
              <div key={obs.id} className="flex items-start gap-3 border-l-2 border-amber-500/30 pl-3 py-1.5 ml-1 hover:bg-stone-50/60 transition-colors group">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono text-stone-400 whitespace-nowrap">
                      {obs.observedAt.split("T")[0]}
                    </span>
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_BADGE[obs.type] ?? "bg-stone-100 text-stone-600"}`}>
                      {TYPE_LABEL[obs.type] ?? obs.type}
                    </span>
                    <span className="text-xs text-stone-600 font-medium font-mono">{obs.campId}</span>
                    {obs.animalId && <span className="text-xs font-mono text-stone-500">{obs.animalId}</span>}
                    {obs.loggedBy && <span className="text-xs text-stone-400">· {obs.loggedBy}</span>}
                  </div>
                  <p className="text-xs text-stone-500 mt-0.5 truncate">
                    {parseDetails(obs.details)}
                    {obs.editedAt && (
                      <span className="ml-1 text-amber-600" title={`Edited by ${obs.editedBy ?? "?"}`}>✎</span>
                    )}
                  </p>
                </div>
                <button
                  onClick={() => setEditTarget(obs)}
                  className="shrink-0 px-2.5 py-1 text-xs border border-stone-200 rounded-lg hover:bg-stone-100 text-stone-500 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  Edit
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Pagination */}
        <div className="flex items-center gap-2 justify-center">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1 || loading}
            className="px-3 py-1.5 text-sm border border-stone-300 rounded-lg disabled:opacity-40 hover:bg-stone-100"
          >
            ← Previous
          </button>
          <span className="text-sm text-stone-500">Page {page}</span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasMore || loading}
            className="px-3 py-1.5 text-sm border border-stone-300 rounded-lg disabled:opacity-40 hover:bg-stone-100"
          >
            Next →
          </button>
        </div>
      </div>
    </>
  );
}
