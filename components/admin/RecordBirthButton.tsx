"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Camp, PrismaAnimal } from "@/lib/types";

interface Props {
  animals: PrismaAnimal[];
  camps: Camp[];
}

export default function RecordBirthButton({ animals, camps }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [calfId, setCalfId] = useState("");
  const [sex, setSex] = useState<"Female" | "Male">("Female");
  const [category, setCategory] = useState("Calf");
  const [dob, setDob] = useState(new Date().toISOString().slice(0, 10));
  const [camp, setCamp] = useState(camps[0]?.camp_id ?? "");
  const [motherId, setMotherId] = useState("");
  const [fatherId, setFatherId] = useState("");
  const [notes, setNotes] = useState("");

  const females = animals.filter((a) => a.sex === "Female" && a.status === "Active");
  const males = animals.filter((a) => a.sex === "Male" && a.status === "Active");

  function reset() {
    setCalfId("");
    setSex("Female");
    setCategory("Calf");
    setDob(new Date().toISOString().slice(0, 10));
    setCamp(camps[0]?.camp_id ?? "");
    setMotherId("");
    setFatherId("");
    setNotes("");
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!calfId.trim()) { setError("Calf ID is required."); return; }
    if (!camp) { setError("Starting camp is required."); return; }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/animals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          animalId: calfId.trim(),
          sex,
          category,
          currentCamp: camp,
          dateOfBirth: dob,
          motherId: motherId || null,
          fatherId: fatherId || null,
          notes: notes || null,
          status: "Active",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to record birth");
      setOpen(false);
      reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save. Try again.");
    } finally {
      setLoading(false);
    }
  }

  const inputCls =
    "w-full border rounded-xl px-4 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[rgba(122,92,30,0.4)]";
  const labelCls = "text-xs mb-1 block font-medium";

  return (
    <>
      <button
        onClick={() => { reset(); setOpen(true); }}
        className="px-4 py-2 rounded-xl text-sm font-medium transition-colors"
        style={{ background: "#4A7C59", color: "#FFFFFF" }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "#3D6849")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "#4A7C59")}
      >
        + Record Birth
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto"
            style={{ border: "1px solid #E0D5C8" }}
          >
            <h2 className="text-lg font-bold" style={{ color: "#1C1815" }}>Record Birth</h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Calf ID */}
              <div>
                <label className={labelCls} style={{ color: "#6B5C4E" }}>Calf ID / Tag *</label>
                <input
                  type="text"
                  placeholder="e.g. TB-2026-001"
                  value={calfId}
                  onChange={(e) => setCalfId(e.target.value)}
                  className={inputCls}
                  style={{ border: "1px solid #E0D5C8", color: "#1C1815" }}
                  required
                />
              </div>

              {/* Sex + Category */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls} style={{ color: "#6B5C4E" }}>Sex *</label>
                  <div className="flex rounded-xl overflow-hidden" style={{ border: "1px solid #E0D5C8" }}>
                    {(["Female", "Male"] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSex(s)}
                        className="flex-1 py-2 text-sm font-medium transition-colors"
                        style={
                          sex === s
                            ? { background: "#7A5C1E", color: "#FFFFFF" }
                            : { background: "#FFFFFF", color: "#9C8E7A" }
                        }
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className={labelCls} style={{ color: "#6B5C4E" }}>Category *</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className={inputCls}
                    style={{ border: "1px solid #E0D5C8", color: "#1C1815" }}
                  >
                    {["Calf", "Heifer", "Cow", "Bull", "Ox"].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* DOB + Camp */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls} style={{ color: "#6B5C4E" }}>Date of birth *</label>
                  <input
                    type="date"
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                    className={inputCls}
                    style={{ border: "1px solid #E0D5C8", color: "#1C1815" }}
                    required
                  />
                </div>
                <div>
                  <label className={labelCls} style={{ color: "#6B5C4E" }}>Starting camp *</label>
                  <select
                    value={camp}
                    onChange={(e) => setCamp(e.target.value)}
                    className={inputCls}
                    style={{ border: "1px solid #E0D5C8", color: "#1C1815" }}
                    required
                  >
                    <option value="">Select camp…</option>
                    {camps.map((c) => (
                      <option key={c.camp_id} value={c.camp_id}>{c.camp_name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Dam */}
              <div>
                <label className={labelCls} style={{ color: "#6B5C4E" }}>Dam (mother)</label>
                <select
                  value={motherId}
                  onChange={(e) => setMotherId(e.target.value)}
                  className={inputCls}
                  style={{ border: "1px solid #E0D5C8", color: "#1C1815" }}
                >
                  <option value="">Unknown / not recorded</option>
                  {females.map((a) => (
                    <option key={a.animalId} value={a.animalId}>
                      {a.animalId}{a.name ? ` — ${a.name}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* Sire */}
              <div>
                <label className={labelCls} style={{ color: "#6B5C4E" }}>Sire (father)</label>
                <select
                  value={fatherId}
                  onChange={(e) => setFatherId(e.target.value)}
                  className={inputCls}
                  style={{ border: "1px solid #E0D5C8", color: "#1C1815" }}
                >
                  <option value="">Unknown / not recorded</option>
                  {males.map((a) => (
                    <option key={a.animalId} value={a.animalId}>
                      {a.animalId}{a.name ? ` — ${a.name}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* Notes */}
              <div>
                <label className={labelCls} style={{ color: "#6B5C4E" }}>Notes (optional)</label>
                <textarea
                  placeholder="Birth weight, complications, observations…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className={inputCls + " resize-none"}
                  style={{ border: "1px solid #E0D5C8", color: "#1C1815" }}
                />
              </div>

              {error && <p className="text-sm" style={{ color: "#8B3A3A" }}>{error}</p>}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setOpen(false); reset(); }}
                  className="flex-1 py-2 rounded-xl text-sm transition-colors"
                  style={{ border: "1px solid #E0D5C8", color: "#6B5C4E", background: "transparent" }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
                  style={{ background: "#4A7C59", color: "#FFFFFF" }}
                >
                  {loading ? "Saving…" : "Record Birth"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
