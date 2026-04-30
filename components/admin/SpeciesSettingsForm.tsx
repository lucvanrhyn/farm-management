"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Beef, Rabbit, Target, Plus, FileUp, PenLine, X } from "lucide-react";

export type SpeciesRow = {
  id: string;
  label: string;
  icon: string;
  enabled: boolean;
  required: boolean;
};

const ICON_MAP: Record<string, React.ElementType> = {
  Beef,
  Rabbit,
  Target,
};

type RowStatus = "idle" | "saving" | "saved" | "error";

// ── Add Species Modal ─────────────────────────────────────────────────────────

function AddSpeciesModal({
  farmSlug,
  onClose,
}: {
  farmSlug: string;
  onClose: () => void;
}) {
  const router = useRouter();

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function handleImportCsv() {
    onClose();
    router.push(`/${farmSlug}/admin/import`);
  }

  function handleAddManually() {
    onClose();
    router.push(`/${farmSlug}/admin/animals`);
  }

  return (
    <>
      {/* Backdrop */}
      <div
        data-testid="modal-backdrop"
        className="fixed inset-0 z-40"
        style={{ background: "rgba(28,24,21,0.55)" }}
        onClick={onClose}
      />

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-species-title"
        className="fixed inset-0 z-50 flex items-center justify-center px-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="relative w-full max-w-sm rounded-2xl p-6 flex flex-col gap-5"
          style={{
            background: "#FFFFFF",
            border: "1px solid rgba(28,24,21,0.1)",
            boxShadow: "0 8px 32px rgba(28,24,21,0.18)",
          }}
        >
          {/* Close button */}
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-lg transition-colors"
            style={{ color: "#9C8E7A" }}
          >
            <X className="w-4 h-4" />
          </button>

          {/* Heading */}
          <div>
            <h2 id="add-species-title" className="text-base font-bold" style={{ color: "#1C1815" }}>
              Add species
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "#9C8E7A" }}>
              Choose how you want to add a new species module
            </p>
          </div>

          {/* CTAs */}
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={handleImportCsv}
              className="flex items-center gap-3 w-full rounded-xl px-4 py-3 text-left transition-colors"
              style={{
                background: "rgba(58,107,73,0.07)",
                border: "1px solid rgba(58,107,73,0.18)",
              }}
            >
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: "rgba(58,107,73,0.12)" }}
              >
                <FileUp className="w-4 h-4" style={{ color: "#3A6B49" }} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold" style={{ color: "#1C1815" }}>
                  Import from CSV
                </p>
                <p className="text-xs mt-0.5" style={{ color: "#9C8E7A" }}>
                  Upload an Excel / CSV file with your existing records
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={handleAddManually}
              className="flex items-center gap-3 w-full rounded-xl px-4 py-3 text-left transition-colors"
              style={{
                background: "rgba(28,24,21,0.03)",
                border: "1px solid rgba(28,24,21,0.08)",
              }}
            >
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: "rgba(28,24,21,0.06)" }}
              >
                <PenLine className="w-4 h-4" style={{ color: "#6B5C4E" }} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold" style={{ color: "#1C1815" }}>
                  Add manually
                </p>
                <p className="text-xs mt-0.5" style={{ color: "#9C8E7A" }}>
                  Enter animals one by one from the animals page
                </p>
              </div>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Species toggle ────────────────────────────────────────────────────────────

function SpeciesToggle({
  enabled,
  disabled,
  onToggle,
}: {
  enabled: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={disabled}
      onClick={onToggle}
      className="relative inline-flex items-center h-6 w-11 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
      style={{
        background: enabled ? "#3A6B49" : "#9C8E7A",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <span
        className="inline-block w-4 h-4 rounded-full bg-white shadow transition-transform"
        style={{
          transform: enabled ? "translateX(26px)" : "translateX(2px)",
        }}
      />
    </button>
  );
}

// ── Species card ──────────────────────────────────────────────────────────────

function SpeciesCard({
  row,
  onToggle,
  status,
}: {
  row: SpeciesRow;
  onToggle: (id: string, newEnabled: boolean) => void;
  status: RowStatus;
}) {
  const Icon = ICON_MAP[row.icon] ?? Beef;

  return (
    <div
      className="flex items-center justify-between gap-4 rounded-xl p-4"
      style={{
        background: "#FFFFFF",
        border: "1px solid rgba(28,24,21,0.08)",
      }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: "rgba(58,107,73,0.1)" }}
        >
          <Icon className="w-4 h-4" style={{ color: "#3A6B49" }} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold" style={{ color: "#1C1815" }}>
            {row.label}
          </p>
          {row.required ? (
            <p className="text-xs mt-0.5" style={{ color: "#9C8E7A" }}>
              Core species — always enabled
            </p>
          ) : (
            <p className="text-xs mt-0.5" style={{ color: "#9C8E7A" }}>
              {row.enabled ? "Enabled" : "Disabled"}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {status === "saved" && (
          <span className="text-xs font-medium" style={{ color: "#3A6B49" }}>
            Saved
          </span>
        )}
        {status === "error" && (
          <span className="text-xs font-medium" style={{ color: "#B91C1C" }}>
            Error
          </span>
        )}
        {status === "saving" && (
          <span className="text-xs" style={{ color: "#9C8E7A" }}>
            Saving…
          </span>
        )}

        {row.required ? (
          <SpeciesToggle enabled={true} disabled={true} onToggle={() => {}} />
        ) : (
          <SpeciesToggle
            enabled={row.enabled}
            disabled={status === "saving"}
            onToggle={() => onToggle(row.id, !row.enabled)}
          />
        )}
      </div>
    </div>
  );
}

// ── Main form ─────────────────────────────────────────────────────────────────

export default function SpeciesSettingsForm({
  farmSlug,
  species,
}: {
  farmSlug: string;
  species: SpeciesRow[];
}) {
  const [rows, setRows] = useState<SpeciesRow[]>(species);
  const [rowStatus, setRowStatus] = useState<Record<string, RowStatus>>({});
  const [modalOpen, setModalOpen] = useState(false);

  const openModal = useCallback(() => setModalOpen(true), []);
  const closeModal = useCallback(() => setModalOpen(false), []);

  async function handleToggle(id: string, newEnabled: boolean) {
    // Optimistic update
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, enabled: newEnabled } : r))
    );
    setRowStatus((prev) => ({ ...prev, [id]: "saving" }));

    try {
      const res = await fetch(`/api/farm/species-settings?farmSlug=${encodeURIComponent(farmSlug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ species: id, enabled: newEnabled }),
      });

      if (!res.ok) {
        throw new Error("Request failed");
      }

      setRowStatus((prev) => ({ ...prev, [id]: "saved" }));
      setTimeout(() => {
        setRowStatus((prev) => ({ ...prev, [id]: "idle" }));
      }, 2000);
    } catch {
      // Revert optimistic update
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, enabled: !newEnabled } : r))
      );
      setRowStatus((prev) => ({ ...prev, [id]: "error" }));
      setTimeout(() => {
        setRowStatus((prev) => ({ ...prev, [id]: "idle" }));
      }, 3000);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        {rows.map((row) => (
          <SpeciesCard
            key={row.id}
            row={row}
            onToggle={handleToggle}
            status={rowStatus[row.id] ?? "idle"}
          />
        ))}

        {/* Add species button */}
        <button
          type="button"
          onClick={openModal}
          className="flex items-center justify-center gap-2 w-full rounded-xl py-3 px-4 text-sm font-medium transition-colors mt-1"
          style={{
            background: "rgba(58,107,73,0.05)",
            border: "1.5px dashed rgba(58,107,73,0.3)",
            color: "#3A6B49",
          }}
        >
          <Plus className="w-4 h-4" />
          <span>+ Add species</span>
        </button>
      </div>

      {modalOpen && (
        <AddSpeciesModal farmSlug={farmSlug} onClose={closeModal} />
      )}
    </>
  );
}
