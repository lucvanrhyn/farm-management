"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface CampRow {
  camp_id: string;
  camp_name: string;
  water_source?: string;
  liveCount: number;
  grazing: string;
  fence: string;
  lastDate: string;
  lastBy: string;
}

function grazingColor(g: string): { color: string; bg: string } {
  if (g === "Excellent") return { color: "#4A7C59", bg: "rgba(74,124,89,0.18)" };
  if (g === "Good")      return { color: "#6B9E5E", bg: "rgba(107,158,94,0.15)" };
  if (g === "Poor")      return { color: "#A0522D", bg: "rgba(160,82,45,0.18)" };
  return { color: "#8B6914", bg: "rgba(139,105,20,0.15)" };
}

export default function CampsTableClient({ rows, farmSlug }: { rows: CampRow[]; farmSlug: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  async function handleDelete(campId: string, campName: string) {
    if (!window.confirm(`Delete camp "${campName}"? This cannot be undone.`)) return;
    setDeleting(campId);
    try {
      const res = await fetch(`/api/camps/${campId}`, { method: "DELETE" });
      if (!res.ok) {
        const { error } = await res.json();
        alert(error ?? "Failed to delete camp.");
      } else {
        router.refresh();
      }
    } finally {
      setDeleting(null);
    }
  }

  async function handleRemoveAll() {
    if (!window.confirm("Remove ALL camps? This cannot be undone.")) return;
    setResetting(true);
    try {
      const res = await fetch("/api/camps/reset", { method: "DELETE" });
      if (!res.ok) {
        const { error } = await res.json();
        alert(error ?? "Failed to remove camps.");
      } else {
        router.refresh();
      }
    } finally {
      setResetting(false);
    }
  }

  return (
    <div>
      {rows.length > 0 && (
        <div className="flex justify-end mb-3">
          <button
            onClick={handleRemoveAll}
            disabled={resetting}
            className="text-xs px-3 py-1.5 rounded-lg transition-opacity hover:opacity-70 disabled:opacity-40"
            style={{ background: "rgba(192,87,76,0.12)", color: "#C0574C", border: "1px solid rgba(192,87,76,0.25)" }}
          >
            {resetting ? "Removing…" : "Remove All Camps"}
          </button>
        </div>
      )}

      <div
        className="overflow-x-auto rounded-2xl"
        style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
      >
        {rows.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm" style={{ color: "#9C8E7A" }}>
            No camps yet. Add your first camp above.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr
                className="text-xs uppercase tracking-wide"
                style={{ borderBottom: "1px solid #E0D5C8", background: "#F5F2EE", color: "#9C8E7A" }}
              >
                <th className="text-left px-4 py-3 font-semibold">Camp</th>
                <th className="text-right px-4 py-3 font-semibold">Animals</th>
                <th className="text-left px-4 py-3 font-semibold">Water Source</th>
                <th className="text-left px-4 py-3 font-semibold">Last Inspection</th>
                <th className="text-left px-4 py-3 font-semibold">Grazing</th>
                <th className="text-left px-4 py-3 font-semibold">Fence</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((camp) => {
                const gc = grazingColor(camp.grazing);
                const isDeleting = deleting === camp.camp_id;
                return (
                  <tr
                    key={camp.camp_id}
                    className="admin-row"
                    style={{ borderBottom: "1px solid #E0D5C8", opacity: isDeleting ? 0.5 : 1 }}
                  >
                    <td className="px-4 py-3 font-semibold" style={{ color: "#1C1815" }}>
                      {camp.camp_name}
                    </td>
                    <td className="px-4 py-3 text-right font-mono" style={{ color: "#6B5C4E" }}>
                      {camp.liveCount}
                    </td>
                    <td className="px-4 py-3 capitalize" style={{ color: "#9C8E7A" }}>
                      {camp.water_source ?? "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs" style={{ color: "#9C8E7A" }}>
                      {camp.lastDate !== "—" ? `${camp.lastDate} · ${camp.lastBy}` : "Never"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-block px-2 py-0.5 rounded-full text-xs font-medium"
                        style={{ background: gc.bg, color: gc.color }}
                      >
                        {camp.grazing}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-block px-2 py-0.5 rounded-full text-xs font-medium"
                        style={
                          camp.fence === "Intact"
                            ? { background: "rgba(74,124,89,0.18)", color: "#4A7C59" }
                            : { background: "rgba(139,20,20,0.2)", color: "#C0574C" }
                        }
                      >
                        {camp.fence === "Intact" ? "Intact" : "Damaged"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Link
                          href={`/${farmSlug}/admin/camps/${camp.camp_id}`}
                          className="text-xs transition-opacity hover:opacity-70"
                          style={{ color: "#8B6914" }}
                        >
                          Performance →
                        </Link>
                        <Link
                          href={`/${farmSlug}/dashboard/camp/${camp.camp_id}`}
                          className="text-xs transition-opacity hover:opacity-70"
                          style={{ color: "#6B5C4E" }}
                        >
                          Map →
                        </Link>
                        <button
                          onClick={() => handleDelete(camp.camp_id, camp.camp_name)}
                          disabled={isDeleting}
                          className="text-xs transition-opacity hover:opacity-70 disabled:opacity-40"
                          style={{ color: "#C0574C" }}
                        >
                          {isDeleting ? "…" : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
