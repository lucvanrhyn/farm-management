"use client";

import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import NvdDeclarations, { DEFAULT_DECLARATIONS, type DeclarationState } from "./NvdDeclarations";

interface Animal {
  animalId: string;
  name: string | null;
  sex: string;
  category: string;
  breed: string;
  currentCamp: string;
  status: string;
}

interface WithdrawalBlocker {
  animalId: string;
  name: string | null;
  treatmentType: string;
  daysRemaining: number;
}

interface NvdIssueFormProps {
  farmSlug: string;
  /** Called with the new NVD number after a successful issue */
  onIssued: (nvdNumber: string) => void;
}

const inputCls = "w-full rounded-lg px-3 py-2 text-sm outline-none transition-colors";
const inputStyle: React.CSSProperties = { background: "#FAFAF8", border: "1px solid #E0D5C8", color: "#1C1815" };
function focusStyle(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) {
  e.currentTarget.style.borderColor = "#4A7C59";
}
function blurStyle(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) {
  e.currentTarget.style.borderColor = "#E0D5C8";
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-5" style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}>
      <h3 className="text-sm font-semibold mb-4" style={{ color: "#1C1815" }}>{title}</h3>
      {children}
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4 items-center py-2.5" style={{ borderBottom: "1px solid #F0E8DE" }}>
      <label className="text-sm font-medium" style={{ color: "#1C1815" }}>{label}</label>
      <div className="sm:col-span-2">{children}</div>
    </div>
  );
}

export default function NvdIssueForm({ farmSlug, onIssued }: NvdIssueFormProps) {
  // Buyer fields
  const [saleDate, setSaleDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [buyerName, setBuyerName] = useState("");
  const [buyerAddress, setBuyerAddress] = useState("");
  const [buyerContact, setBuyerContact] = useState("");
  const [destinationAddress, setDestinationAddress] = useState("");

  // Animal selection
  const [animals, setAnimals] = useState<Animal[]>([]);
  const [animalsLoading, setAnimalsLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [campFilter, setCampFilter] = useState("");

  // Withdrawal validation
  const [blockers, setBlockers] = useState<WithdrawalBlocker[]>([]);
  const [validating, setValidating] = useState(false);

  // Declarations
  const [declarations, setDeclarations] = useState<DeclarationState>(DEFAULT_DECLARATIONS);

  // Submit state
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Load active animals
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/animals?status=Active");
        if (res.ok) setAnimals((await res.json()) as Animal[]);
      } finally {
        setAnimalsLoading(false);
      }
    })();
  }, []);

  // Validate selected animals for withdrawal on every selection change
  const validate = useCallback(async (ids: string[]) => {
    if (ids.length === 0) { setBlockers([]); return; }
    setValidating(true);
    try {
      const res = await fetch(`/api/${farmSlug}/nvd/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ animalIds: ids }),
      });
      if (res.ok) {
        const data = (await res.json()) as { ok: boolean; blockers?: WithdrawalBlocker[] };
        setBlockers(data.ok ? [] : (data.blockers ?? []));
      }
    } finally {
      setValidating(false);
    }
  }, [farmSlug]);

  function toggleAnimal(animalId: string) {
    const next = new Set(selectedIds);
    if (next.has(animalId)) {
      next.delete(animalId);
    } else {
      next.add(animalId);
    }
    setSelectedIds(next);
    void validate([...next]);
  }

  function toggleSelectAll() {
    const filtered = filteredAnimals.map((a) => a.animalId);
    const allSelected = filtered.every((id) => selectedIds.has(id));
    const next = new Set(selectedIds);
    if (allSelected) {
      for (const id of filtered) next.delete(id);
    } else {
      for (const id of filtered) next.add(id);
    }
    setSelectedIds(next);
    void validate([...next]);
  }

  // Derive unique camps for the filter dropdown
  const uniqueCamps = [...new Set(animals.map((a) => a.currentCamp))].sort();
  const filteredAnimals = campFilter
    ? animals.filter((a) => a.currentCamp === campFilter)
    : animals;

  const hasBlockers = blockers.length > 0;
  const canSubmit = (
    buyerName.trim().length > 0 &&
    saleDate.trim().length > 0 &&
    selectedIds.size > 0 &&
    !hasBlockers &&
    !validating &&
    status !== "submitting"
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setStatus("submitting");
    setErrorMsg(null);

    try {
      const res = await fetch(`/api/${farmSlug}/nvd`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          saleDate,
          buyerName: buyerName.trim(),
          buyerAddress: buyerAddress.trim() || undefined,
          buyerContact: buyerContact.trim() || undefined,
          destinationAddress: destinationAddress.trim() || undefined,
          animalIds: [...selectedIds],
          declarationsJson: JSON.stringify(declarations),
        }),
      });

      const data = (await res.json()) as { id?: string; nvdNumber?: string; error?: string };

      if (!res.ok) {
        throw new Error(data.error ?? "Failed to issue NVD");
      }

      setStatus("success");
      onIssued(data.nvdNumber!);

      // Reset form
      setBuyerName("");
      setBuyerAddress("");
      setBuyerContact("");
      setDestinationAddress("");
      setSelectedIds(new Set());
      setBlockers([]);
      setDeclarations(DEFAULT_DECLARATIONS);
      setSaleDate(new Date().toISOString().slice(0, 10));
      setTimeout(() => setStatus("idle"), 4000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Buyer Details */}
      <Section title="Sale &amp; Buyer Details">
        <FieldRow label="Sale Date">
          <input
            type="date"
            value={saleDate}
            onChange={(e) => setSaleDate(e.target.value)}
            required
            className={inputCls}
            style={inputStyle}
            onFocus={focusStyle}
            onBlur={blurStyle}
          />
        </FieldRow>
        <FieldRow label="Buyer Name *">
          <input
            type="text"
            value={buyerName}
            onChange={(e) => setBuyerName(e.target.value)}
            placeholder="Full name of buyer"
            required
            className={inputCls}
            style={inputStyle}
            onFocus={focusStyle}
            onBlur={blurStyle}
          />
        </FieldRow>
        <FieldRow label="Buyer Address">
          <input
            type="text"
            value={buyerAddress}
            onChange={(e) => setBuyerAddress(e.target.value)}
            placeholder="Street / farm address"
            className={inputCls}
            style={inputStyle}
            onFocus={focusStyle}
            onBlur={blurStyle}
          />
        </FieldRow>
        <FieldRow label="Buyer Contact">
          <input
            type="text"
            value={buyerContact}
            onChange={(e) => setBuyerContact(e.target.value)}
            placeholder="Phone or email"
            className={inputCls}
            style={inputStyle}
            onFocus={focusStyle}
            onBlur={blurStyle}
          />
        </FieldRow>
        <FieldRow label="Destination Address">
          <input
            type="text"
            value={destinationAddress}
            onChange={(e) => setDestinationAddress(e.target.value)}
            placeholder="Where animals are going (if different)"
            className={inputCls}
            style={inputStyle}
            onFocus={focusStyle}
            onBlur={blurStyle}
          />
        </FieldRow>
      </Section>

      {/* Animal Selection */}
      <Section title={`Animals to Include (${selectedIds.size} selected)`}>
        {/* Withdrawal blocker banner */}
        {hasBlockers && (
          <div
            className="flex items-start gap-3 rounded-lg px-4 py-3 mb-4"
            style={{ background: "rgba(139,58,58,0.08)", border: "1px solid rgba(139,58,58,0.25)" }}
          >
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "#8B3A3A" }} />
            <div>
              <p className="text-sm font-semibold" style={{ color: "#8B3A3A" }}>
                Cannot issue NVD — withdrawal period active
              </p>
              <ul className="mt-1 space-y-0.5">
                {blockers.map((b) => (
                  <li key={b.animalId} className="text-xs" style={{ color: "#8B3A3A" }}>
                    {b.animalId}{b.name ? ` (${b.name})` : ""} — {b.treatmentType}, {b.daysRemaining} day{b.daysRemaining !== 1 ? "s" : ""} remaining
                  </li>
                ))}
              </ul>
              <p className="text-xs mt-1.5" style={{ color: "rgba(139,58,58,0.7)" }}>
                Remove these animals from the selection to proceed.
              </p>
            </div>
          </div>
        )}

        {/* Camp filter */}
        <div className="flex items-center gap-3 mb-3">
          <select
            value={campFilter}
            onChange={(e) => setCampFilter(e.target.value)}
            className="rounded-lg px-3 py-1.5 text-sm outline-none"
            style={{ background: "#FAFAF8", border: "1px solid #E0D5C8", color: "#1C1815" }}
          >
            <option value="">All camps</option>
            {uniqueCamps.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          {filteredAnimals.length > 0 && (
            <button
              type="button"
              onClick={toggleSelectAll}
              className="text-xs font-medium px-2.5 py-1 rounded-lg"
              style={{ background: "rgba(74,124,89,0.1)", color: "#4A7C59" }}
            >
              {filteredAnimals.every((a) => selectedIds.has(a.animalId)) ? "Deselect all" : "Select all"}
            </button>
          )}

          {validating && (
            <div className="flex items-center gap-1.5 text-xs" style={{ color: "#9C8E7A" }}>
              <Loader2 className="w-3 h-3 animate-spin" />
              Checking…
            </div>
          )}
        </div>

        {animalsLoading ? (
          <p className="text-sm text-center py-4" style={{ color: "#9C8E7A" }}>Loading animals…</p>
        ) : filteredAnimals.length === 0 ? (
          <p className="text-sm text-center py-4" style={{ color: "#9C8E7A" }}>No active animals found.</p>
        ) : (
          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {filteredAnimals.map((a) => {
              const isBlocked = blockers.some((b) => b.animalId === a.animalId);
              return (
                <label
                  key={a.animalId}
                  className="flex items-center gap-3 rounded-lg px-3 py-2 cursor-pointer transition-colors"
                  style={{
                    background: selectedIds.has(a.animalId)
                      ? isBlocked ? "rgba(139,58,58,0.06)" : "rgba(74,124,89,0.06)"
                      : "#FAFAF8",
                    border: "1px solid",
                    borderColor: selectedIds.has(a.animalId)
                      ? isBlocked ? "rgba(139,58,58,0.2)" : "rgba(74,124,89,0.2)"
                      : "#E0D5C8",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(a.animalId)}
                    onChange={() => toggleAnimal(a.animalId)}
                    className="w-4 h-4 rounded shrink-0"
                    style={{ accentColor: isBlocked ? "#8B3A3A" : "#4A7C59" }}
                  />
                  <div className="flex-1 min-w-0 flex items-center gap-3 flex-wrap">
                    <span className="font-mono text-xs font-semibold" style={{ color: "#1C1815" }}>
                      {a.animalId}
                    </span>
                    {a.name && (
                      <span className="text-xs" style={{ color: "#9C8E7A" }}>{a.name}</span>
                    )}
                    <span className="text-xs" style={{ color: "#9C8E7A" }}>
                      {a.category} · {a.sex} · {a.currentCamp}
                    </span>
                  </div>
                  {isBlocked && (
                    <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(139,58,58,0.1)", color: "#8B3A3A" }}>
                      Withdrawal
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        )}
      </Section>

      {/* Declarations */}
      <Section title="Declarations">
        <NvdDeclarations value={declarations} onChange={setDeclarations} />
      </Section>

      {/* Submit */}
      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={!canSubmit}
          className="px-5 py-2.5 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-40"
          style={{ background: "#4A7C59", color: "#FFFFFF" }}
        >
          {status === "submitting" ? "Issuing NVD…" : "Issue NVD"}
        </button>

        {status === "success" && (
          <p className="text-sm font-medium" style={{ color: "#4A7C59" }}>
            NVD issued successfully.
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
