"use client";

import { useState, useEffect } from "react";
import { submitMobMove } from "@/lib/logger-actions";
import type { MobInfo, MoveModeActions } from "./useMoveMode";
import { useFarmModeSafe } from "@/lib/farm-mode";
import { useOffline } from "@/components/logger/OfflineProvider";

interface Props {
  phase:
    | { tag: "idle" }
    | { tag: "source_selected"; campId: string }
    | { tag: "mob_selected"; campId: string; mob: MobInfo }
    | { tag: "dest_selected"; campId: string; mob: MobInfo; destCampId: string };
  campNameMap: Record<string, string>;
  actions: MoveModeActions;
  onMoveDone: () => void;
}

function useMobsForCamp(campId: string | null): { mobs: MobInfo[]; loading: boolean } {
  const [mobs, setMobs] = useState<MobInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const { mode } = useFarmModeSafe();

  useEffect(() => {
    if (!campId) { setMobs([]); return; }
    const controller = new AbortController();
    setLoading(true);
    fetch("/api/mobs", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : []))
      .then((all: MobInfo[]) => {
        const inCamp = all
          .filter((m) => m.current_camp === campId)
          .filter((m) => (m.species ?? "cattle") === mode);
        setMobs(inCamp);
      })
      .catch((err: unknown) => {
        if ((err as { name?: string }).name !== "AbortError") setMobs([]);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [campId, mode]);

  return { mobs, loading };
}

function Heading({ text }: { text: string }) {
  return (
    <p style={{ color: "#F0DEB8", fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>
      {text}
    </p>
  );
}

const PANEL_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 60,
  left: 12,
  zIndex: 20,
  width: 240,
  borderRadius: 16,
  background: "rgba(26,21,16,0.96)",
  border: "1px solid rgba(196,144,48,0.3)",
  backdropFilter: "blur(10px)",
  boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
  fontFamily: "var(--font-sans)",
  overflow: "hidden",
};

const HEADER_STYLE: React.CSSProperties = {
  padding: "12px 14px 8px",
  borderBottom: "1px solid rgba(196,144,48,0.15)",
};

const BODY_STYLE: React.CSSProperties = {
  padding: "10px 14px 14px",
};

export default function MoveModePanel({ phase, campNameMap, actions, onMoveDone }: Props) {
  const { isOnline, refreshPendingCount, syncNow } = useOffline();
  const [moving, setMoving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const sourceCampId =
    phase.tag !== "idle" ? phase.campId : null;

  const { mobs, loading } = useMobsForCamp(
    phase.tag === "source_selected" ? phase.campId : null,
  );

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  async function handleConfirm() {
    if (phase.tag !== "dest_selected") return;
    setMoving(true);
    const result = await submitMobMove(
      {
        mobId: phase.mob.id,
        mobName: phase.mob.name,
        animalCount: phase.mob.animal_count,
        fromCampId: phase.campId,
        toCampId: phase.destCampId,
      },
      { isOnline, refreshPendingCount, syncNow },
    );
    setMoving(false);
    if (result.success) {
      showToast(`${phase.mob.name} moved successfully`);
      setTimeout(onMoveDone, 1500);
    } else {
      showToast("Move failed — try again");
      actions.resetToSourceSelect();
    }
  }

  if (phase.tag === "idle") return null;

  return (
    <div style={PANEL_STYLE}>
      <div style={HEADER_STYLE}>
        <Heading text="Move Mob" />
        {sourceCampId && (
          <p style={{ color: "#C49030", fontSize: 11, marginTop: 2 }}>
            From: <strong>{campNameMap[sourceCampId] ?? sourceCampId}</strong>
          </p>
        )}
      </div>

      <div style={BODY_STYLE}>
        {/* Phase: source selected — pick a mob */}
        {phase.tag === "source_selected" && (
          <>
            <p style={{ color: "rgba(210,180,140,0.6)", fontSize: 11, marginBottom: 8 }}>
              {loading ? "Loading mobs..." : mobs.length === 0 ? "No mobs in this camp." : "Select a mob to move:"}
            </p>
            {mobs.map((mob) => (
              <button
                key={mob.id}
                onClick={() => actions.selectMob(mob)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: "rgba(196,144,48,0.08)",
                  border: "1px solid rgba(196,144,48,0.2)",
                  color: "#F0DEB8",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                  marginBottom: 4,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span>{mob.name}</span>
                <span style={{ color: "#C49030", fontSize: 11 }}>{mob.animal_count} animals</span>
              </button>
            ))}
            <button
              onClick={actions.cancelMove}
              style={{ marginTop: 8, fontSize: 11, color: "rgba(210,180,140,0.4)", background: "none", border: "none", cursor: "pointer" }}
            >
              Cancel
            </button>
          </>
        )}

        {/* Phase: mob selected — pick destination */}
        {phase.tag === "mob_selected" && (
          <>
            <p style={{ color: "#F0DEB8", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
              {phase.mob.name}
            </p>
            <p style={{ color: "rgba(210,180,140,0.6)", fontSize: 11, marginBottom: 8 }}>
              Tap a destination camp on the map.
            </p>
            <button
              onClick={actions.cancelMove}
              style={{ fontSize: 11, color: "rgba(210,180,140,0.4)", background: "none", border: "none", cursor: "pointer" }}
            >
              Cancel
            </button>
          </>
        )}

        {/* Phase: destination selected — confirm */}
        {phase.tag === "dest_selected" && (
          <>
            <p style={{ color: "#F0DEB8", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
              Confirm move?
            </p>
            <p style={{ color: "rgba(210,180,140,0.7)", fontSize: 11, marginBottom: 12, lineHeight: 1.5 }}>
              <strong style={{ color: "#C49030" }}>{phase.mob.name}</strong>{" "}
              ({phase.mob.animal_count} animals){" → "}
              <strong style={{ color: "#C49030" }}>{campNameMap[phase.destCampId] ?? phase.destCampId}</strong>
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={handleConfirm}
                disabled={moving}
                style={{
                  flex: 1,
                  padding: "8px 0",
                  borderRadius: 8,
                  background: "#B87333",
                  border: "none",
                  color: "#F5F0E8",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: moving ? "default" : "pointer",
                  opacity: moving ? 0.6 : 1,
                }}
              >
                {moving ? "Moving…" : "Confirm"}
              </button>
              <button
                onClick={actions.cancelMove}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: "rgba(210,180,140,0.08)",
                  border: "1px solid rgba(210,180,140,0.2)",
                  color: "rgba(210,180,140,0.7)",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: "absolute",
            bottom: -48,
            left: 0,
            right: 0,
            textAlign: "center",
            padding: "8px 12px",
            borderRadius: 8,
            background: "rgba(26,21,16,0.96)",
            border: "1px solid rgba(196,144,48,0.3)",
            color: "#F0DEB8",
            fontSize: 11,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
