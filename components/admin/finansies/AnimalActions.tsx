"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  animalId: string;
  campId: string;
  variant?: "detail" | "row"; // detail = full buttons, row = compact ⋮ menu
}

type Modal = "none" | "sell" | "death";

export default function AnimalActions({ animalId, campId, variant = "detail" }: Props) {
  const router = useRouter();
  const [modal, setModal] = useState<Modal>("none");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Sell form state
  const [price, setPrice] = useState("");
  const [saleDate, setSaleDate] = useState(new Date().toISOString().slice(0, 10));
  const [buyer, setBuyer] = useState("");
  const [saleNotes, setSaleNotes] = useState("");

  // Death form state
  const [deathDate, setDeathDate] = useState(new Date().toISOString().slice(0, 10));
  const [cause, setCause] = useState("");
  // Issue #492 — first-class free-text note (Path A) on the death observation.
  const [deathNotes, setDeathNotes] = useState("");

  // Row menu state
  const [menuOpen, setMenuOpen] = useState(false);

  function open(m: Modal) {
    setModal(m);
    setMenuOpen(false);
    setError("");
  }
  function close() {
    setModal("none");
    setError("");
  }

  async function handleSell(e: React.FormEvent) {
    e.preventDefault();
    if (!price || parseFloat(price) <= 0) {
      setError("Please enter a valid price.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      // Sequential: create transaction first, then update animal status
      const txRes = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "income",
          category: "Animal Sales",
          amount: parseFloat(price),
          date: saleDate,
          description: [buyer ? `Buyer: ${buyer}` : null, saleNotes || null]
            .filter(Boolean).join(" · ") || `Sale: ${animalId}`,
          animalId,
          saleType: "private",
          counterparty: buyer || null,
          quantity: 1,
          animalIds: JSON.stringify([animalId]),
        }),
      });
      if (!txRes.ok) throw new Error("Transaction failed");

      const animalRes = await fetch(`/api/animals/${animalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "Sold" }),
      });
      if (!animalRes.ok) throw new Error("Animal update failed");

      close();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeath(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      // Sequential: create observation first, then update animal status
      const obsRes = await fetch("/api/observations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "death",
          camp_id: campId,
          animal_id: animalId,
          details: JSON.stringify({ date: deathDate, cause: cause || "Unknown" }),
          created_at: new Date(deathDate).toISOString(),
          // Issue #492 — top-level free-text note. Omitted when blank so the
          // row's `notes` column stays null.
          notes: deathNotes.trim() === "" ? undefined : deathNotes,
        }),
      });
      if (!obsRes.ok) throw new Error("Observation failed");

      const animalRes = await fetch(`/api/animals/${animalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "Deceased", deceasedAt: new Date(deathDate).toISOString() }),
      });
      if (!animalRes.ok) throw new Error("Animal update failed");

      close();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Trigger buttons */}
      {variant === "detail" ? (
        <div className="flex gap-2">
          <button
            onClick={() => open("sell")}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-[var(--ft-good)] text-white hover:bg-[var(--ft-good)] transition-colors"
          >
            Sell
          </button>
          <button
            onClick={() => open("death")}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-[var(--ft-crit-bg)] text-[var(--ft-crit)] hover:bg-[var(--ft-crit)] transition-colors"
          >
            Death
          </button>
        </div>
      ) : (
        <div className="relative">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="p-1.5 rounded-lg text-[var(--ft-subtle)] hover:text-[var(--ft-text)] hover:bg-[var(--ft-surface)] transition-colors"
          >
            ⋮
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-8 z-20 w-36 bg-[var(--ft-surface)] border border-[var(--ft-border)] rounded-xl shadow-lg overflow-hidden">
              <button
                onClick={() => open("sell")}
                className="w-full text-left px-4 py-2.5 text-sm text-[var(--ft-text)] hover:bg-[var(--ft-surface)]"
              >
                Sell
              </button>
              <button
                onClick={() => open("death")}
                className="w-full text-left px-4 py-2.5 text-sm text-[var(--ft-crit)] hover:bg-[var(--ft-crit-bg)]"
              >
                Death
              </button>
            </div>
          )}
        </div>
      )}

      {/* Sell modal */}
      {modal === "sell" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-[var(--ft-surface)] rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold text-[var(--ft-text)]">Animal Sale — {animalId}</h2>
            <form onSubmit={handleSell} className="space-y-4">
              <div>
                <label className="text-xs text-[var(--ft-subtle)] mb-1 block">Sale price (R) *</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="w-full border border-[var(--ft-border)] rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ft-good)]"
                  required
                />
              </div>
              <div>
                <label className="text-xs text-[var(--ft-subtle)] mb-1 block">Date *</label>
                <input
                  type="date"
                  value={saleDate}
                  onChange={(e) => setSaleDate(e.target.value)}
                  className="w-full border border-[var(--ft-border)] rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ft-good)]"
                  required
                />
              </div>
              <div>
                <label className="text-xs text-[var(--ft-subtle)] mb-1 block">Buyer (optional)</label>
                <input
                  type="text"
                  placeholder="Buyer name"
                  value={buyer}
                  onChange={(e) => setBuyer(e.target.value)}
                  className="w-full border border-[var(--ft-border)] rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ft-good)]"
                />
              </div>
              <div>
                <label className="text-xs text-[var(--ft-subtle)] mb-1 block">Notes (optional)</label>
                <textarea
                  placeholder="Any additional notes..."
                  value={saleNotes}
                  onChange={(e) => setSaleNotes(e.target.value)}
                  rows={2}
                  className="w-full border border-[var(--ft-border)] rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ft-good)] resize-none"
                />
              </div>
              {error && <p className="text-sm text-[var(--ft-crit)]">{error}</p>}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={close}
                  className="flex-1 py-2 rounded-xl border border-[var(--ft-border)] text-sm text-[var(--ft-muted)] hover:bg-[var(--ft-surface)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-2 rounded-xl bg-[var(--ft-good)] text-white text-sm font-medium hover:bg-[var(--ft-good)] disabled:opacity-50"
                >
                  {loading ? "Saving..." : "Confirm Sale"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Death modal */}
      {modal === "death" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-[var(--ft-surface)] rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold text-[var(--ft-text)]">Animal Deceased — {animalId}</h2>
            <form onSubmit={handleDeath} className="space-y-4">
              <div>
                <label className="text-xs text-[var(--ft-subtle)] mb-1 block">Date of death *</label>
                <input
                  type="date"
                  value={deathDate}
                  onChange={(e) => setDeathDate(e.target.value)}
                  className="w-full border border-[var(--ft-border)] rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ft-good)]"
                  required
                />
              </div>
              <div>
                <label className="text-xs text-[var(--ft-subtle)] mb-1 block">Cause (optional)</label>
                <select
                  value={cause}
                  onChange={(e) => setCause(e.target.value)}
                  className="w-full border border-[var(--ft-border)] rounded-xl px-4 py-2 text-sm bg-[var(--ft-surface)] focus:outline-none focus:ring-2 focus:ring-[var(--ft-good)]"
                >
                  <option value="">Unknown</option>
                  <option value="Disease">Disease</option>
                  <option value="Injury">Injury</option>
                  <option value="Old age">Old age</option>
                  <option value="Birth complications">Birth complications</option>
                  <option value="Predator">Predator</option>
                </select>
              </div>
              {/* Issue #492 — free-text note on the death observation. */}
              <div>
                <label className="text-xs text-[var(--ft-subtle)] mb-1 block">Notes (optional)</label>
                <textarea
                  placeholder="Free-text note — e.g. found in north camp, no predator signs"
                  value={deathNotes}
                  onChange={(e) => setDeathNotes(e.target.value)}
                  rows={2}
                  maxLength={2000}
                  className="w-full border border-[var(--ft-border)] rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ft-good)] resize-none"
                />
              </div>
              {error && <p className="text-sm text-[var(--ft-crit)]">{error}</p>}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={close}
                  className="flex-1 py-2 rounded-xl border border-[var(--ft-border)] text-sm text-[var(--ft-muted)] hover:bg-[var(--ft-surface)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-2 rounded-xl bg-[var(--ft-crit)] text-white text-sm font-medium hover:bg-[var(--ft-crit)] disabled:opacity-50"
                >
                  {loading ? "Saving..." : "Confirm"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
