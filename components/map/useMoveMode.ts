"use client";

import { useState, useCallback } from "react";

export interface MobInfo {
  id: string;
  name: string;
  animal_count: number;
  current_camp: string;
  species?: string;
}

type Phase =
  | { tag: "idle" }
  | { tag: "source_selected"; campId: string }
  | { tag: "mob_selected"; campId: string; mob: MobInfo }
  | { tag: "dest_selected"; campId: string; mob: MobInfo; destCampId: string };

export interface MoveModeState {
  active: boolean;
  phase: Phase;
  /** Camp currently acting as move source (for map highlighting) */
  sourceCampId: string | null;
}

export interface MoveModeActions {
  toggleActive: () => void;
  selectSourceCamp: (campId: string) => void;
  selectMob: (mob: MobInfo) => void;
  selectDestCamp: (campId: string) => void;
  cancelMove: () => void;
  resetToSourceSelect: () => void;
}

const IDLE: Phase = { tag: "idle" };

export function useMoveMode(): [MoveModeState, MoveModeActions] {
  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState<Phase>(IDLE);

  const sourceCampId =
    phase.tag === "source_selected" || phase.tag === "mob_selected" || phase.tag === "dest_selected"
      ? phase.campId
      : null;

  const toggleActive = useCallback(() => {
    setActive((v) => {
      if (v) setPhase(IDLE); // reset when deactivating
      return !v;
    });
  }, []);

  const selectSourceCamp = useCallback((campId: string) => {
    setPhase({ tag: "source_selected", campId });
  }, []);

  const selectMob = useCallback((mob: MobInfo) => {
    setPhase((prev) => {
      if (prev.tag === "source_selected") {
        return { tag: "mob_selected", campId: prev.campId, mob };
      }
      return prev;
    });
  }, []);

  const selectDestCamp = useCallback((campId: string) => {
    setPhase((prev) => {
      if (prev.tag === "mob_selected" && campId !== prev.campId) {
        return { tag: "dest_selected", campId: prev.campId, mob: prev.mob, destCampId: campId };
      }
      return prev;
    });
  }, []);

  const cancelMove = useCallback(() => setPhase(IDLE), []);

  const resetToSourceSelect = useCallback(() => {
    setPhase((prev) => {
      if (prev.tag !== "idle") return { tag: "source_selected", campId: prev.campId };
      return prev;
    });
  }, []);

  const state: MoveModeState = { active, phase, sourceCampId };
  const actions: MoveModeActions = {
    toggleActive,
    selectSourceCamp,
    selectMob,
    selectDestCamp,
    cancelMove,
    resetToSourceSelect,
  };

  return [state, actions];
}
