"use client";

import { useState } from "react";

interface Props {
  hectares: number;
  campsWithoutBoundary: { id: string; name: string }[];
  onConfirm: (campId: string | null, campName?: string) => void;
  onCancel: () => void;
}

type Mode = "new" | "existing";

export default function DrawCampModal({
  hectares,
  campsWithoutBoundary,
  onConfirm,
  onCancel,
}: Props) {
  const [mode, setMode]           = useState<Mode>("new");
  const [newName, setNewName]     = useState("");
  const [selectedId, setSelectedId] = useState(
    campsWithoutBoundary[0]?.id ?? ""
  );

  function handleConfirm() {
    if (mode === "new") {
      onConfirm(null, newName.trim());
    } else {
      onConfirm(selectedId || null);
    }
  }

  const canConfirm =
    mode === "existing"
      ? selectedId !== ""
      : newName.trim().length > 0;

  return (
    // Backdrop
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(4px)",
      }}
      onClick={onCancel}
    >
      {/* Modal card — dark-glass surface */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "rgba(26,21,16,0.96)",
          border: "1px solid rgba(255,235,210,0.13)",
          backdropFilter: "blur(14px) saturate(140%)",
          borderRadius: 16,
          padding: "24px 28px",
          minWidth: 320,
          maxWidth: 400,
          color: "#EFE7D8",
          boxShadow: "0 24px 80px -20px rgba(0,0,0,0.7)",
        }}
      >
        {/* Header */}
        <p
          className="ft-serif"
          style={{
            fontSize: 22,
            fontWeight: 500,
            letterSpacing: "-0.01em",
            marginBottom: 6,
            color: "#EFE7D8",
          }}
        >
          Camp boundary drawn
        </p>
        <p
          className="ft-mono"
          style={{
            fontSize: 12,
            color: "rgba(255,235,210,0.6)",
            marginBottom: 20,
          }}
        >
          Area: <strong style={{ color: "var(--ft-accent)" }}>{hectares} ha</strong>
        </p>

        {/* Mode toggle — segmented look */}
        <div
          style={{
            display: "flex",
            borderRadius: 10,
            border: "1px solid rgba(255,235,210,0.12)",
            background: "rgba(42,35,28,0.6)",
            padding: 3,
            gap: 3,
            marginBottom: 20,
          }}
        >
          {(["new", "existing"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                flex: 1,
                padding: "7px 12px",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
                border: "none",
                transition: "background 0.15s, color 0.15s",
                background: mode === m ? "var(--ft-accent)" : "transparent",
                color: mode === m ? "#fff" : "rgba(255,235,210,0.5)",
              }}
            >
              {m === "new" ? "Create New Camp" : "Assign to Existing"}
            </button>
          ))}
        </div>

        {/* Inputs */}
        {mode === "new" ? (
          <div style={{ marginBottom: 20 }}>
            <label
              className="ft-label"
              style={{
                display: "block",
                fontSize: 11,
                color: "rgba(255,235,210,0.55)",
                marginBottom: 6,
              }}
            >
              Camp Name
            </label>
            <input
              autoFocus
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Rivier, Koppie…"
              style={{
                width: "100%",
                padding: "9px 12px",
                borderRadius: 10,
                background: "rgba(42,35,28,0.7)",
                border: "1px solid rgba(255,235,210,0.13)",
                color: "#EFE7D8",
                fontSize: 14,
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
        ) : (
          <div style={{ marginBottom: 20 }}>
            <label
              className="ft-label"
              style={{
                display: "block",
                fontSize: 11,
                color: "rgba(255,235,210,0.55)",
                marginBottom: 6,
              }}
            >
              Select Camp
            </label>
            {campsWithoutBoundary.length === 0 ? (
              <p style={{ fontSize: 12, color: "rgba(255,235,210,0.5)" }}>
                All camps already have boundaries.
              </p>
            ) : (
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  borderRadius: 10,
                  background: "rgba(42,35,28,0.9)",
                  border: "1px solid rgba(255,235,210,0.13)",
                  color: "#EFE7D8",
                  fontSize: 14,
                  outline: "none",
                  cursor: "pointer",
                }}
              >
                {campsWithoutBoundary.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            style={{
              padding: "9px 16px",
              borderRadius: 10,
              fontSize: 12.5,
              fontWeight: 500,
              background: "rgba(42,35,28,0.7)",
              border: "1px solid rgba(255,235,210,0.12)",
              color: "rgba(255,235,210,0.7)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            style={{
              padding: "9px 20px",
              borderRadius: 10,
              fontSize: 12.5,
              fontWeight: 600,
              background: canConfirm ? "var(--ft-accent)" : "rgba(42,35,28,0.7)",
              border: canConfirm ? "1px solid transparent" : "1px solid rgba(255,235,210,0.12)",
              color: canConfirm ? "#FFF6EE" : "rgba(255,235,210,0.35)",
              cursor: canConfirm ? "pointer" : "not-allowed",
              transition: "all 0.2s",
            }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
