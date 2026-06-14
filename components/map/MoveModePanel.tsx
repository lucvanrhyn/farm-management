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
  const { mode } = useFarmModeSafe();
  // Combine result with the key it was fetched for — loading is derived in
  // render without any synchronous setState in the effect body.
  const fetchKey = campId ? `${campId}|${mode}` : null;
  const [result, setResult] = useState<{ key: string; mobs: MobInfo[] } | null>(null);

  const mobs    = result?.key === fetchKey ? result.mobs : [];
  const loading = fetchKey !== null && result?.key !== fetchKey;

  useEffect(() => {
    if (!campId || !fetchKey) return;
    const controller = new AbortController();
    const key = fetchKey;
    fetch("/api/mobs", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : []))
      .then((all: MobInfo[]) => {
        // S7 / sp-M3 — no client-side species filter here. /api/mobs never
        // returns a `species` field (wire shape: id/name/current_camp/
        // animal_count) and already scopes the list server-side via the
        // farmtrack-mode cookie. The old `(m.species ?? "cattle") === mode`
        // filter therefore discarded EVERY mob in sheep/game mode. `mode`
        // stays in the fetch key so a mode switch refetches the
        // server-scoped list.
        const inCamp = all.filter((m) => m.current_camp === campId);
        setResult({ key, mobs: inCamp });
      })
      .catch((err: unknown) => {
        if ((err as { name?: string }).name !== "AbortError") setResult({ key, mobs: [] });
      });
    return () => controller.abort();
  }, [campId, mode, fetchKey]);

  return { mobs, loading };
}

function Heading({ text }: { text: string }) {
  return (
    <p className="ft-serif" style={{ color: "#EFE7D8", fontSize: 18, fontWeight: 500, letterSpacing: "-0.01em", margin: 0 }}>
      {text}
    </p>
  );
}

// Dark-glass panel — floats over the satellite map (outside any .dark-surface
// scope), so it carries literal glass values.
const PANEL_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 60,
  left: 12,
  zIndex: 20,
  width: 244,
  borderRadius: 16,
  background: "rgba(26,21,16,0.92)",
  border: "1px solid rgba(255,235,210,0.13)",
  backdropFilter: "blur(14px) saturate(140%)",
  boxShadow: "0 10px 36px -12px rgba(0,0,0,0.6)",
  color: "#EFE7D8",
  overflow: "hidden",
};

const HEADER_STYLE: React.CSSProperties = {
  padding: "13px 15px 9px",
  borderBottom: "1px solid rgba(255,235,210,0.1)",
};

const BODY_STYLE: React.CSSProperties = {
  padding: "11px 15px 15px",
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

  return (
    <div style={PANEL_STYLE}>
      <div style={HEADER_STYLE}>
        <Heading text="Move Mob" />
        {sourceCampId && (
          <p className="ft-mono" style={{ color: "var(--ft-accent)", fontSize: 11, marginTop: 4 }}>
            From: <strong>{campNameMap[sourceCampId] ?? sourceCampId}</strong>
          </p>
        )}
      </div>

      <div style={BODY_STYLE}>
        {/* Phase: idle — next-step instruction (#289). Superseded by the
            source-selected / mob-selected guidance below as the flow advances. */}
        {phase.tag === "idle" && (
          <p style={{ color: "rgba(255,235,210,0.6)", fontSize: 11, lineHeight: 1.5 }}>
            Tap a camp on the map to pick the mob&rsquo;s source.
          </p>
        )}

        {/* Phase: source selected — pick a mob */}
        {phase.tag === "source_selected" && (
          <>
            <p style={{ color: "rgba(255,235,210,0.6)", fontSize: 11, marginBottom: 8 }}>
              {loading ? "Loading mobs..." : mobs.length === 0 ? "No mobs in this camp." : "Select a mob to move:"}
            </p>
            {mobs.map((mob) => (
              <button
                key={mob.id}
                onClick={() => actions.selectMob(mob)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "9px 11px",
                  borderRadius: 10,
                  background: "rgba(42,35,28,0.7)",
                  border: "1px solid rgba(255,235,210,0.12)",
                  color: "#EFE7D8",
                  fontSize: 12.5,
                  fontWeight: 500,
                  cursor: "pointer",
                  marginBottom: 5,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span>{mob.name}</span>
                <span className="ft-mono ft-tabnums" style={{ color: "var(--ft-accent)", fontSize: 11 }}>{mob.animal_count} animals</span>
              </button>
            ))}
            <button
              onClick={actions.cancelMove}
              style={{ marginTop: 8, fontSize: 11, color: "rgba(255,235,210,0.45)", background: "none", border: "none", cursor: "pointer" }}
            >
              Cancel
            </button>
          </>
        )}

        {/* Phase: mob selected — pick destination */}
        {phase.tag === "mob_selected" && (
          <>
            <p className="ft-serif" style={{ color: "#EFE7D8", fontSize: 15, fontWeight: 500, marginBottom: 4 }}>
              {phase.mob.name}
            </p>
            <p style={{ color: "rgba(255,235,210,0.6)", fontSize: 11, marginBottom: 8 }}>
              Tap a destination camp on the map.
            </p>
            <button
              onClick={actions.cancelMove}
              style={{ fontSize: 11, color: "rgba(255,235,210,0.45)", background: "none", border: "none", cursor: "pointer" }}
            >
              Cancel
            </button>
          </>
        )}

        {/* Phase: destination selected — confirm */}
        {phase.tag === "dest_selected" && (
          <>
            <p style={{ color: "#EFE7D8", fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>
              Confirm move?
            </p>
            <p style={{ color: "rgba(255,235,210,0.7)", fontSize: 11, marginBottom: 12, lineHeight: 1.5 }}>
              <strong style={{ color: "var(--ft-accent)" }}>{phase.mob.name}</strong>{" "}
              ({phase.mob.animal_count} animals){" → "}
              <strong style={{ color: "var(--ft-accent)" }}>{campNameMap[phase.destCampId] ?? phase.destCampId}</strong>
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={handleConfirm}
                disabled={moving}
                style={{
                  flex: 1,
                  padding: "9px 0",
                  borderRadius: 10,
                  background: "var(--ft-accent)",
                  border: "none",
                  color: "#FFF6EE",
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: moving ? "default" : "pointer",
                  opacity: moving ? 0.6 : 1,
                }}
              >
                {moving ? "Moving…" : "Confirm"}
              </button>
              <button
                onClick={actions.cancelMove}
                style={{
                  padding: "9px 13px",
                  borderRadius: 10,
                  background: "rgba(42,35,28,0.7)",
                  border: "1px solid rgba(255,235,210,0.12)",
                  color: "rgba(255,235,210,0.7)",
                  fontSize: 12.5,
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
            padding: "9px 13px",
            borderRadius: 10,
            background: "rgba(26,21,16,0.92)",
            border: "1px solid rgba(255,235,210,0.13)",
            backdropFilter: "blur(14px) saturate(140%)",
            boxShadow: "0 10px 36px -12px rgba(0,0,0,0.6)",
            color: "#EFE7D8",
            fontSize: 11,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
