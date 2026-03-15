"use client";

import { useState, useEffect, useCallback } from "react";
import { CAMPS } from "@/lib/dummy-data";
import type { ObservationType, PrismaObservation } from "@/lib/types";

const PAGE_SIZE = 50;

const OBS_TYPES: { value: ObservationType | "all"; label: string }[] = [
  { value: "all",             label: "Alle tipes" },
  { value: "camp_check",      label: "Kamp-inspeksie" },
  { value: "camp_condition",  label: "Kamp-toestand" },
  { value: "health_issue",    label: "Gesondheid" },
  { value: "animal_movement", label: "Beweging" },
  { value: "reproduction",    label: "Reproduksie" },
  { value: "treatment",       label: "Behandeling" },
  { value: "death",           label: "Sterfte" },
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
  camp_check:      "Kamp-inspeksie",
  camp_condition:  "Kamp-toestand",
  health_issue:    "Gesondheid",
  animal_movement: "Beweging",
  reproduction:    "Reproduksie",
  treatment:       "Behandeling",
  death:           "Sterfte",
};

function parseDetails(raw: string): string {
  try {
    const obj = JSON.parse(raw);
    const parts: string[] = [];
    if (obj.symptoms) {
      const s = Array.isArray(obj.symptoms) ? obj.symptoms.join(", ") : obj.symptoms;
      parts.push(`Simptome: ${s}`);
    }
    if (obj.severity) parts.push(`Erns: ${obj.severity}`);
    if (obj.grazing_quality) parts.push(`Beweiding: ${obj.grazing_quality}`);
    if (obj.water_status) parts.push(`Water: ${obj.water_status}`);
    if (obj.notes) parts.push(obj.notes);
    if (obj.cause) parts.push(`Oorsaak: ${obj.cause}`);
    if (obj.drug) parts.push(`Middel: ${obj.drug}`);
    if (obj.to_camp) parts.push(`Na kamp: ${obj.to_camp}`);
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
        setError(e.error ?? "Stoor het misluk");
        return;
      }
      const updated: PrismaObservation = await res.json();
      onSaved(updated);
      onClose();
    } catch {
      setError("Netwerk fout — probeer weer");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-stone-800">Redigeer Waarneming</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700 text-xl leading-none">×</button>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs text-stone-500">
          <span><span className="font-semibold text-stone-700">Tipe:</span> {TYPE_LABEL[obs.type] ?? obs.type}</span>
          <span><span className="font-semibold text-stone-700">Kamp:</span> {obs.campId}</span>
          <span><span className="font-semibold text-stone-700">Datum:</span> {obs.observedAt.split("T")[0]}</span>
          {obs.animalId && <span><span className="font-semibold text-stone-700">Dier:</span> {obs.animalId}</span>}
          {obs.loggedBy && <span><span className="font-semibold text-stone-700">Aangeteken deur:</span> {obs.loggedBy}</span>}
        </div>

        <div>
          <label className="block text-xs font-semibold text-stone-600 mb-1">Besonderhede (JSON)</label>
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
            Kanselleer
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 text-sm bg-green-700 text-white rounded-xl hover:bg-green-800 disabled:opacity-50"
          >
            {saving ? "Stoor…" : "Stoor"}
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
            <option value="all">Alle Kampe</option>
            {CAMPS.map((c) => <option key={c.camp_id} value={c.camp_id}>{c.camp_name}</option>)}
          </select>

          <select
            value={typeFilter}
            onChange={(e) => handleFilterChange(campFilter, e.target.value as ObservationType | "all")}
            className="border border-stone-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            {OBS_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>

          {loading && <span className="self-center text-xs text-stone-400">Laai…</span>}
        </div>

        {/* Table */}
        <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-100 bg-stone-50">
                <th className="text-left px-4 py-3 font-semibold text-stone-600 whitespace-nowrap">Datum</th>
                <th className="text-left px-4 py-3 font-semibold text-stone-600">Tipe</th>
                <th className="text-left px-4 py-3 font-semibold text-stone-600">Kamp</th>
                <th className="text-left px-4 py-3 font-semibold text-stone-600">Dier</th>
                <th className="text-left px-4 py-3 font-semibold text-stone-600">Deur</th>
                <th className="text-left px-4 py-3 font-semibold text-stone-600 w-64">Besonderhede</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {!loading && observations.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-stone-400 text-sm">
                    Geen waarnemings gevind nie.
                  </td>
                </tr>
              )}
              {observations.map((obs) => (
                <tr key={obs.id} className="border-b border-stone-50 hover:bg-stone-50 transition-colors">
                  <td className="px-4 py-3 text-stone-500 whitespace-nowrap">
                    {obs.observedAt.split("T")[0]}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_BADGE[obs.type] ?? "bg-stone-100 text-stone-600"}`}>
                      {TYPE_LABEL[obs.type] ?? obs.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-stone-700 font-medium">{obs.campId}</td>
                  <td className="px-4 py-3 font-mono text-stone-600 text-xs">{obs.animalId ?? "—"}</td>
                  <td className="px-4 py-3 text-stone-500 text-xs">{obs.loggedBy ?? "—"}</td>
                  <td className="px-4 py-3 text-stone-500 text-xs max-w-xs truncate">
                    {parseDetails(obs.details)}
                    {obs.editedAt && (
                      <span className="ml-1 text-amber-600 text-xs" title={`Geredigeer deur ${obs.editedBy ?? "?"}`}>✎</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setEditTarget(obs)}
                      className="px-3 py-1 text-xs border border-stone-300 rounded-lg hover:bg-stone-100 text-stone-600"
                    >
                      Redigeer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center gap-2 justify-center">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1 || loading}
            className="px-3 py-1.5 text-sm border border-stone-300 rounded-lg disabled:opacity-40 hover:bg-stone-100"
          >
            ← Vorige
          </button>
          <span className="text-sm text-stone-500">Bladsy {page}</span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasMore || loading}
            className="px-3 py-1.5 text-sm border border-stone-300 rounded-lg disabled:opacity-40 hover:bg-stone-100"
          >
            Volgende →
          </button>
        </div>
      </div>
    </>
  );
}
