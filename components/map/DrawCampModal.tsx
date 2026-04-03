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
      {/* Modal card */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#1E1710",
          border: "1px solid rgba(139,105,20,0.3)",
          borderRadius: 16,
          padding: "24px 28px",
          minWidth: 320,
          maxWidth: 400,
          color: "#F5EBD4",
          boxShadow: "0 24px 64px rgba(0,0,0,0.7)",
        }}
      >
        {/* Header */}
        <p
          style={{
            fontFamily: "var(--font-dm-serif, serif)",
            fontSize: 18,
            fontWeight: 700,
            marginBottom: 4,
            color: "#F5EBD4",
          }}
        >
          Camp Boundary Drawn
        </p>
        <p
          style={{
            fontSize: 12,
            color: "rgba(210,180,140,0.6)",
            marginBottom: 20,
            fontFamily: "var(--font-sans)",
          }}
        >
          Area: <strong style={{ color: "#D2B48C" }}>{hectares} ha</strong>
        </p>

        {/* Mode toggle */}
        <div
          style={{
            display: "flex",
            borderRadius: 8,
            border: "1px solid rgba(139,105,20,0.2)",
            background: "rgba(139,105,20,0.05)",
            padding: 2,
            gap: 2,
            marginBottom: 20,
          }}
        >
          {(["new", "existing"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                flex: 1,
                padding: "6px 12px",
                borderRadius: 6,
                fontSize: 12,
                fontFamily: "var(--font-sans)",
                fontWeight: 500,
                cursor: "pointer",
                border: "none",
                transition: "background 0.15s, color 0.15s",
                background: mode === m ? "rgba(139,105,20,0.25)" : "transparent",
                color: mode === m ? "#D2B48C" : "rgba(210,180,140,0.45)",
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
              style={{
                display: "block",
                fontSize: 11,
                color: "rgba(210,180,140,0.6)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: 6,
                fontFamily: "var(--font-sans)",
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
                padding: "8px 12px",
                borderRadius: 8,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(139,105,20,0.3)",
                color: "#F5EBD4",
                fontSize: 14,
                fontFamily: "var(--font-sans)",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
        ) : (
          <div style={{ marginBottom: 20 }}>
            <label
              style={{
                display: "block",
                fontSize: 11,
                color: "rgba(210,180,140,0.6)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: 6,
                fontFamily: "var(--font-sans)",
              }}
            >
              Select Camp
            </label>
            {campsWithoutBoundary.length === 0 ? (
              <p style={{ fontSize: 12, color: "rgba(210,180,140,0.5)" }}>
                All camps already have boundaries.
              </p>
            ) : (
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: "rgba(36,28,20,0.9)",
                  border: "1px solid rgba(139,105,20,0.3)",
                  color: "#F5EBD4",
                  fontSize: 14,
                  fontFamily: "var(--font-sans)",
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
              padding: "8px 16px",
              borderRadius: 8,
              fontSize: 12,
              fontFamily: "var(--font-sans)",
              fontWeight: 500,
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(139,105,20,0.2)",
              color: "rgba(210,180,140,0.6)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            style={{
              padding: "8px 20px",
              borderRadius: 8,
              fontSize: 12,
              fontFamily: "var(--font-sans)",
              fontWeight: 600,
              background: canConfirm ? "rgba(139,105,20,0.85)" : "rgba(139,105,20,0.2)",
              border: "1px solid rgba(139,105,20,0.4)",
              color: canConfirm ? "#F5EBD4" : "rgba(210,180,140,0.35)",
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
