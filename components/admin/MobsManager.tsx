"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Camp, Mob } from "@/lib/types";
import { useFarmModeSafe } from "@/lib/farm-mode";
import AddAnimalToMobPicker from "./AddAnimalToMobPicker";

// Narrow membership row: only what's needed to render "in this mob" lists
// on the page. Unassigned animals used to live in this same array so the
// client could filter/search them for the "add to mob" picker; phase I.2
// moved that to a paginated /api/animals call to stop SSRing the whole
// active roster.
interface MembershipRow {
  animalId: string;
  name: string | null;
  mobId: string | null;
}

interface Props {
  initialMobs: Mob[];
  camps: Camp[];
  membership: MembershipRow[];
  farmSlug: string;
}

type ModalState =
  | { type: "create" }
  | { type: "move"; mob: Mob }
  | { type: "edit"; mob: Mob }
  | { type: "animals"; mob: Mob }
  | null;

export default function MobsManager({ initialMobs, camps, membership }: Props) {
  // Farm species is used by the paginated picker so it only shows relevant
  // animals (cattle/sheep/game). Safe hook falls back to "cattle" outside a
  // provider, which matches the historical default.
  const { mode } = useFarmModeSafe();
  const router = useRouter();
  const [mobs, setMobs] = useState<Mob[]>(initialMobs);
  const [modal, setModal] = useState<ModalState>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create mob form state
  const [newName, setNewName] = useState("");
  const [newCamp, setNewCamp] = useState(camps[0]?.camp_id ?? "");

  // Move mob state
  const [destCamp, setDestCamp] = useState("");

  // Edit mob state
  const [editName, setEditName] = useState("");

  // Animals modal state — selection is managed here because the submit
  // button lives in this component. The picker component reports toggles.
  const [selectedAnimalIds, setSelectedAnimalIds] = useState<Set<string>>(new Set());

  function campName(campId: string): string {
    return camps.find((c) => c.camp_id === campId)?.camp_name ?? campId;
  }

  function toggleAnimal(animalId: string): void {
    setSelectedAnimalIds((prev) => {
      const next = new Set(prev);
      if (next.has(animalId)) next.delete(animalId);
      else next.add(animalId);
      return next;
    });
  }

  async function handleCreate() {
    if (!newName.trim() || !newCamp) return;
    setLoading(true);
    setError(null);
    try {
      // Wave 4 A2: POST /api/mobs now requires `species`. The admin is
      // working inside a species-scoped context (FarmModeProvider), so the
      // active mode IS the species the new mob belongs to. The API will
      // 422 with CROSS_SPECIES_BLOCKED if the chosen camp doesn't match —
      // surfacing the mismatch instead of silently defaulting to cattle.
      const res = await fetch("/api/mobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          currentCamp: newCamp,
          species: mode,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to create mob");
      }
      const mob = await res.json();
      setMobs((prev) => [...prev, mob].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName("");
      setModal(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function handleMove(mob: Mob) {
    if (!destCamp || destCamp === mob.current_camp) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/mobs/${mob.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentCamp: destCamp }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to move mob");
      }
      const updated = await res.json();
      setMobs((prev) =>
        prev.map((m) =>
          m.id === mob.id ? { ...m, current_camp: updated.current_camp } : m,
        ),
      );
      setModal(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function handleRename(mob: Mob) {
    if (!editName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/mobs/${mob.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to rename mob");
      }
      const updated = await res.json();
      setMobs((prev) =>
        prev
          .map((m) => (m.id === mob.id ? { ...m, name: updated.name } : m))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      setModal(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(mob: Mob) {
    if (!confirm(`Delete mob "${mob.name}"? This cannot be undone.`)) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/mobs/${mob.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to delete mob");
      }
      setMobs((prev) => prev.filter((m) => m.id !== mob.id));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function handleAddAnimals(mob: Mob) {
    if (selectedAnimalIds.size === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/mobs/${mob.id}/animals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ animalIds: Array.from(selectedAnimalIds) }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to add animals");
      }
      setSelectedAnimalIds(new Set());
      setModal(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function handleRemoveAnimals(mob: Mob, animalIds: string[]) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/mobs/${mob.id}/animals`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ animalIds }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to remove animals");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  // Animals currently in a mob — derived from the narrow membership roster
  // the server sends. Unassigned animals arrive via the paginated picker.
  function getMobAnimals(mob: Mob) {
    return membership.filter((a) => a.mobId === mob.id);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Error banner */}
      {error && (
        <div
          className="rounded-xl px-4 py-3 text-sm"
          style={{
            background: "rgba(192,87,76,0.1)",
            border: "1px solid rgba(192,87,76,0.3)",
            color: "#C0574C",
          }}
        >
          {error}
          <button
            className="ml-3 underline text-xs"
            onClick={() => setError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Create button */}
      <button
        onClick={() => {
          setNewName("");
          setNewCamp(camps[0]?.camp_id ?? "");
          setError(null);
          setModal({ type: "create" });
        }}
        className="self-start px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
        style={{
          background: "#4A7C59",
          color: "#FFFFFF",
        }}
      >
        + Create Mob
      </button>

      {/* Mobs table */}
      {mobs.length === 0 ? (
        <div
          className="rounded-2xl p-8 text-center"
          style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
        >
          <p style={{ color: "#9C8E7A" }}>
            No mobs yet. Create one to start grouping animals.
          </p>
        </div>
      ) : (
        <div
          className="overflow-x-auto rounded-2xl"
          style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid #E0D5C8" }}>
                {["Name", "Camp", "Animals", "Actions"].map((h) => (
                  <th
                    key={h}
                    className="text-left px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide"
                    style={{ color: "#9C8E7A", background: "#F5F2EE" }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mobs.map((mob) => (
                <tr
                  key={mob.id}
                  className="transition-colors"
                  style={{ borderBottom: "1px solid #E0D5C8" }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "rgba(122,92,30,0.05)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  <td className="px-3 py-2 font-semibold" style={{ color: "#1C1815" }}>
                    {mob.name}
                  </td>
                  <td className="px-3 py-2 font-mono text-sm" style={{ color: "#6B5C4E" }}>
                    {campName(mob.current_camp)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className="inline-block px-2 py-0.5 rounded-full text-xs font-medium"
                      style={{
                        background: "rgba(74,124,89,0.12)",
                        color: "#4A7C59",
                      }}
                    >
                      {mob.animal_count ?? 0}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => {
                          setEditName(mob.name);
                          setError(null);
                          setModal({ type: "edit", mob });
                        }}
                        className="text-xs px-2.5 py-1 rounded-lg transition-colors"
                        style={{
                          border: "1px solid #E0D5C8",
                          color: "#6B5C4E",
                        }}
                      >
                        Rename
                      </button>
                      <button
                        onClick={() => {
                          setDestCamp("");
                          setError(null);
                          setModal({ type: "move", mob });
                        }}
                        className="text-xs px-2.5 py-1 rounded-lg transition-colors"
                        style={{
                          border: "1px solid #E0D5C8",
                          color: "#6B5C4E",
                        }}
                      >
                        Move
                      </button>
                      <button
                        onClick={() => {
                          setSelectedAnimalIds(new Set());
                          setError(null);
                          setModal({ type: "animals", mob });
                        }}
                        className="text-xs px-2.5 py-1 rounded-lg transition-colors"
                        style={{
                          border: "1px solid #E0D5C8",
                          color: "#6B5C4E",
                        }}
                      >
                        Animals
                      </button>
                      <button
                        onClick={() => handleDelete(mob)}
                        disabled={loading}
                        className="text-xs px-2.5 py-1 rounded-lg transition-colors"
                        style={{
                          border: "1px solid rgba(192,87,76,0.3)",
                          color: "#C0574C",
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => !loading && setModal(null)}
          />
          <div
            className="relative rounded-2xl p-6 w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto"
            style={{
              background: "#FAFAF8",
              border: "1px solid #E0D5C8",
              boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
            }}
          >
            {/* Create Modal */}
            {modal.type === "create" && (
              <>
                <h2
                  className="text-lg font-bold mb-4"
                  style={{ color: "#1C1815" }}
                >
                  Create Mob
                </h2>
                <div className="flex flex-col gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-semibold" style={{ color: "#9C8E7A" }}>
                      Name
                    </span>
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="e.g. Spring Weaners"
                      className="rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[rgba(122,92,30,0.4)]"
                      style={{
                        background: "#FFFFFF",
                        border: "1px solid #E0D5C8",
                        color: "#1C1815",
                      }}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-semibold" style={{ color: "#9C8E7A" }}>
                      Starting Camp
                    </span>
                    <select
                      value={newCamp}
                      onChange={(e) => setNewCamp(e.target.value)}
                      className="rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[rgba(122,92,30,0.4)]"
                      style={{
                        background: "#FFFFFF",
                        border: "1px solid #E0D5C8",
                        color: "#1C1815",
                      }}
                    >
                      {camps.map((c) => (
                        <option key={c.camp_id} value={c.camp_id}>
                          {c.camp_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => setModal(null)}
                      disabled={loading}
                      className="flex-1 px-4 py-2 rounded-xl text-sm"
                      style={{
                        border: "1px solid #E0D5C8",
                        color: "#6B5C4E",
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreate}
                      disabled={loading || !newName.trim() || !newCamp}
                      className="flex-1 px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50"
                      style={{
                        background: "#4A7C59",
                        color: "#FFFFFF",
                      }}
                    >
                      {loading ? "Creating..." : "Create"}
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* Move Modal */}
            {modal.type === "move" && (
              <>
                <h2
                  className="text-lg font-bold mb-1"
                  style={{ color: "#1C1815" }}
                >
                  Move Mob: {modal.mob.name}
                </h2>
                <p className="text-xs mb-4" style={{ color: "#9C8E7A" }}>
                  Currently in {campName(modal.mob.current_camp)} with{" "}
                  {modal.mob.animal_count ?? 0} animal(s). All animals move together.
                </p>
                <div className="flex flex-col gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-semibold" style={{ color: "#9C8E7A" }}>
                      Destination Camp
                    </span>
                    <select
                      value={destCamp}
                      onChange={(e) => setDestCamp(e.target.value)}
                      className="rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[rgba(122,92,30,0.4)]"
                      style={{
                        background: "#FFFFFF",
                        border: "1px solid #E0D5C8",
                        color: "#1C1815",
                      }}
                    >
                      <option value="">Select camp...</option>
                      {camps
                        .filter((c) => c.camp_id !== modal.mob.current_camp)
                        .map((c) => (
                          <option key={c.camp_id} value={c.camp_id}>
                            {c.camp_name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => setModal(null)}
                      disabled={loading}
                      className="flex-1 px-4 py-2 rounded-xl text-sm"
                      style={{
                        border: "1px solid #E0D5C8",
                        color: "#6B5C4E",
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleMove(modal.mob)}
                      disabled={loading || !destCamp}
                      className="flex-1 px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50"
                      style={{
                        background: "#4A7C59",
                        color: "#FFFFFF",
                      }}
                    >
                      {loading ? "Moving..." : "Move Mob"}
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* Edit/Rename Modal */}
            {modal.type === "edit" && (
              <>
                <h2
                  className="text-lg font-bold mb-4"
                  style={{ color: "#1C1815" }}
                >
                  Rename Mob
                </h2>
                <div className="flex flex-col gap-3">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[rgba(122,92,30,0.4)]"
                    style={{
                      background: "#FFFFFF",
                      border: "1px solid #E0D5C8",
                      color: "#1C1815",
                    }}
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => setModal(null)}
                      disabled={loading}
                      className="flex-1 px-4 py-2 rounded-xl text-sm"
                      style={{
                        border: "1px solid #E0D5C8",
                        color: "#6B5C4E",
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleRename(modal.mob)}
                      disabled={loading || !editName.trim()}
                      className="flex-1 px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50"
                      style={{
                        background: "#4A7C59",
                        color: "#FFFFFF",
                      }}
                    >
                      {loading ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* Animals Modal */}
            {modal.type === "animals" && (
              <>
                <h2
                  className="text-lg font-bold mb-1"
                  style={{ color: "#1C1815" }}
                >
                  Manage Animals: {modal.mob.name}
                </h2>
                <p className="text-xs mb-4" style={{ color: "#9C8E7A" }}>
                  Camp: {campName(modal.mob.current_camp)}
                </p>

                {/* Current animals in mob */}
                {(() => {
                  const mobAnimals = getMobAnimals(modal.mob);
                  return mobAnimals.length > 0 ? (
                    <div className="mb-4">
                      <p
                        className="text-xs font-semibold mb-2"
                        style={{ color: "#9C8E7A" }}
                      >
                        In this mob ({mobAnimals.length})
                      </p>
                      <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                        {mobAnimals.map((a) => (
                          <div
                            key={a.animalId}
                            className="flex items-center justify-between px-3 py-1.5 rounded-lg"
                            style={{ background: "rgba(74,124,89,0.06)" }}
                          >
                            <span className="text-sm font-mono" style={{ color: "#1C1815" }}>
                              {a.animalId}
                              {a.name && (
                                <span style={{ color: "#9C8E7A" }}> ({a.name})</span>
                              )}
                            </span>
                            <button
                              onClick={() => handleRemoveAnimals(modal.mob, [a.animalId])}
                              disabled={loading}
                              className="text-xs px-2 py-0.5 rounded-lg"
                              style={{ color: "#C0574C", border: "1px solid rgba(192,87,76,0.3)" }}
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs mb-4" style={{ color: "#9C8E7A" }}>
                      No animals assigned yet.
                    </p>
                  );
                })()}

                {/* Add animals section — paginated picker backed by
                    /api/animals?unassigned=1&search=… so we don't SSR the
                    full active roster on page load. */}
                <AddAnimalToMobPicker
                  species={mode}
                  selectedIds={selectedAnimalIds}
                  onToggle={toggleAnimal}
                  campLabel={campName}
                />
                {selectedAnimalIds.size > 0 && (
                  <button
                    onClick={() => handleAddAnimals(modal.mob)}
                    disabled={loading}
                    className="mt-2 w-full px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50"
                    style={{ background: "#4A7C59", color: "#FFFFFF" }}
                  >
                    {loading
                      ? "Adding..."
                      : `Add ${selectedAnimalIds.size} animal${selectedAnimalIds.size > 1 ? "s" : ""} to mob`}
                  </button>
                )}

                <button
                  onClick={() => setModal(null)}
                  className="mt-3 w-full px-4 py-2 rounded-xl text-sm"
                  style={{ border: "1px solid #E0D5C8", color: "#6B5C4E" }}
                >
                  Close
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
