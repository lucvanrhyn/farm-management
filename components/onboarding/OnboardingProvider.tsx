"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import type {
  CommitProgressFrame,
  CommitResultFrame,
  FileMeta,
  OnboardingSpecies,
  OnboardingState,
  ProposalResult,
} from "@/lib/onboarding/client-types";
import {
  clearOnboardingState,
  loadOnboardingState,
  saveOnboardingState,
} from "@/lib/onboarding/storage";

// ---------------------------------------------------------------------------
// Initial state + reducer
// ---------------------------------------------------------------------------

const INITIAL_STATE: OnboardingState = {
  species: "cattle",
  file: null,
  parsedColumns: [],
  sampleRows: [],
  fullRowCount: 0,
  proposal: null,
  mappingOverrides: {},
  unmappedOverrides: {},
  importJobId: null,
  progress: null,
  result: null,
};

type OnboardingAction =
  | { type: "HYDRATE"; payload: Partial<OnboardingState> }
  | { type: "SET_SPECIES"; payload: OnboardingSpecies }
  | {
      type: "SET_PARSED_FILE";
      payload: {
        file: FileMeta;
        parsedColumns: string[];
        sampleRows: Record<string, unknown>[];
        fullRowCount: number;
      };
    }
  | { type: "SET_PROPOSAL"; payload: ProposalResult | null }
  | { type: "SET_MAPPING_OVERRIDE"; payload: { source: string; target: string } }
  | { type: "SET_UNMAPPED_OVERRIDE"; payload: { source: string; target: string } }
  | { type: "SET_IMPORT_JOB_ID"; payload: string | null }
  | { type: "SET_PROGRESS"; payload: CommitProgressFrame | null }
  | { type: "SET_RESULT"; payload: CommitResultFrame | null }
  | { type: "RESET" };

function reducer(state: OnboardingState, action: OnboardingAction): OnboardingState {
  switch (action.type) {
    case "HYDRATE":
      return { ...state, ...action.payload };
    case "SET_SPECIES":
      return { ...state, species: action.payload };
    case "SET_PARSED_FILE":
      return {
        ...state,
        file: action.payload.file,
        parsedColumns: action.payload.parsedColumns,
        sampleRows: action.payload.sampleRows,
        fullRowCount: action.payload.fullRowCount,
        // Clear downstream state whenever a new file is parsed — stale proposal
        // from a previous file would otherwise be rendered against new columns.
        proposal: null,
        mappingOverrides: {},
        unmappedOverrides: {},
        importJobId: null,
        progress: null,
        result: null,
      };
    case "SET_PROPOSAL":
      return { ...state, proposal: action.payload };
    case "SET_MAPPING_OVERRIDE":
      return {
        ...state,
        mappingOverrides: {
          ...state.mappingOverrides,
          [action.payload.source]: action.payload.target,
        },
      };
    case "SET_UNMAPPED_OVERRIDE":
      return {
        ...state,
        unmappedOverrides: {
          ...state.unmappedOverrides,
          [action.payload.source]: action.payload.target,
        },
      };
    case "SET_IMPORT_JOB_ID":
      return { ...state, importJobId: action.payload };
    case "SET_PROGRESS":
      return { ...state, progress: action.payload };
    case "SET_RESULT":
      return { ...state, result: action.payload };
    case "RESET":
      return INITIAL_STATE;
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

export type OnboardingCtx = {
  state: OnboardingState;
  setSpecies: (s: OnboardingSpecies) => void;
  setParsedFile: (args: {
    file: FileMeta;
    parsedColumns: string[];
    sampleRows: Record<string, unknown>[];
    fullRowCount: number;
  }) => void;
  setProposal: (p: ProposalResult | null) => void;
  setMappingOverride: (source: string, target: string) => void;
  setUnmappedOverride: (source: string, target: string) => void;
  setImportJobId: (id: string | null) => void;
  setProgress: (p: CommitProgressFrame | null) => void;
  setResult: (r: CommitResultFrame | null) => void;
  reset: () => void;
};

export const OnboardingContext = createContext<OnboardingCtx | null>(null);

export function useOnboarding(): OnboardingCtx {
  const ctx = useContext(OnboardingContext);
  if (!ctx) {
    throw new Error("useOnboarding must be used within OnboardingProvider");
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  // Hydrate from sessionStorage after mount — deliberately deferred so the
  // first client render matches the server render (no hydration mismatch).
  useEffect(() => {
    const loaded = loadOnboardingState();
    if (loaded) {
      dispatch({ type: "HYDRATE", payload: loaded });
    }
  }, []);

  // Persist every state change. Storage module no-ops during SSR and on failure.
  // Exclude `sampleRows` (multi-KB, re-derivable from the re-uploaded file at
  // import step) and `progress` (transient SSE frame state) to keep
  // serialization cheap — every mapping-override click would otherwise
  // re-stringify the full sample grid.
  useEffect(() => {
    const { sampleRows: _sampleRows, progress: _progress, ...persistable } = state;
    void _sampleRows;
    void _progress;
    saveOnboardingState(persistable);
  }, [state]);

  const value = useMemo<OnboardingCtx>(
    () => ({
      state,
      setSpecies: (s) => dispatch({ type: "SET_SPECIES", payload: s }),
      setParsedFile: (args) => dispatch({ type: "SET_PARSED_FILE", payload: args }),
      setProposal: (p) => dispatch({ type: "SET_PROPOSAL", payload: p }),
      setMappingOverride: (source, target) =>
        dispatch({
          type: "SET_MAPPING_OVERRIDE",
          payload: { source, target },
        }),
      setUnmappedOverride: (source, target) =>
        dispatch({
          type: "SET_UNMAPPED_OVERRIDE",
          payload: { source, target },
        }),
      setImportJobId: (id) => dispatch({ type: "SET_IMPORT_JOB_ID", payload: id }),
      setProgress: (p) => dispatch({ type: "SET_PROGRESS", payload: p }),
      setResult: (r) => dispatch({ type: "SET_RESULT", payload: r }),
      reset: () => {
        clearOnboardingState();
        dispatch({ type: "RESET" });
      },
    }),
    [state],
  );

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
}
