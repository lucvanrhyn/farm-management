"use client";

/**
 * Step 4 — commit import with SSE progress.
 *
 * This step is where the full file contents finally cross into the server.
 * Earlier steps only sent 20 sample rows; the provider deliberately does not
 * store the full dataset or the original File. We ask the farmer to re-drop
 * the same file, verify the SHA-256 matches step 2, then materialize every
 * row through the approved mapping and stream via CommitProgress.
 */

import { useCallback, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, FileSpreadsheet, RotateCcw } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { CommitProgress } from "@/components/onboarding/CommitProgress";
import { FileDropzone } from "@/components/onboarding/FileDropzone";
import { StepShell } from "@/components/onboarding/StepShell";
import { useOnboarding } from "@/components/onboarding/OnboardingProvider";
import {
  hashFile,
  parseSpreadsheet,
} from "@/lib/onboarding/parse-file";
import { readAllRows } from "@/lib/onboarding/read-all-rows";
import type {
  CommitProgressFrame,
  CommitResultFrame,
  ImportRow,
  ProposalResult,
} from "@/lib/onboarding/client-types";
import { ONBOARDING_COLORS, SPRING_SOFT } from "@/components/onboarding/theme";

type ViewState =
  | { kind: "waiting" }
  | { kind: "verifying" }
  | { kind: "committing"; rows: ImportRow[]; mappingJson: string }
  | { kind: "error"; message: string };

/**
 * Build ImportRow[] from raw spreadsheet rows by applying:
 *   1. The AI's proposal.mapping (filtered by a non-empty target)
 *   2. User mappingOverrides on top (per-source key wins over the AI default)
 *   3. User unmappedOverrides merged in (source columns the AI left blank)
 *
 * Any target equal to "__ignored__" drops that source column. Empty-string
 * cell values are skipped so downstream validation doesn't reject a row for
 * an empty `sex` that was never populated.
 */
function materializeRows(
  rawRows: Record<string, unknown>[],
  proposal: ProposalResult,
  mappingOverrides: Record<string, string>,
  unmappedOverrides: Record<string, string>,
): ImportRow[] {
  const effectiveMap = new Map<string, string>();

  for (const m of proposal.proposal.mapping) {
    const override = mappingOverrides[m.source];
    const target = override ?? m.target;
    if (target && target !== "__ignored__") {
      effectiveMap.set(m.source, target);
    }
  }
  for (const [source, target] of Object.entries(unmappedOverrides)) {
    if (target && target !== "__ignored__") {
      effectiveMap.set(source, target);
    }
  }

  return rawRows.map((raw) => {
    const row: Record<string, unknown> = {};
    for (const [src, tgt] of effectiveMap) {
      const value = raw[src];
      if (value !== undefined && value !== null && value !== "") {
        row[tgt] = value;
      }
    }
    return row as ImportRow;
  });
}

/** Stable string form of the mapping that was actually applied. */
function serializeMapping(
  proposal: ProposalResult,
  mappingOverrides: Record<string, string>,
  unmappedOverrides: Record<string, string>,
): string {
  const entries: Array<{ source: string; target: string }> = [];
  for (const m of proposal.proposal.mapping) {
    const target = mappingOverrides[m.source] ?? m.target;
    if (target && target !== "__ignored__") {
      entries.push({ source: m.source, target });
    }
  }
  for (const [source, target] of Object.entries(unmappedOverrides)) {
    if (target && target !== "__ignored__") {
      entries.push({ source, target });
    }
  }
  return JSON.stringify({ version: 1, entries });
}

export default function OnboardingImportPage() {
  const router = useRouter();
  const params = useParams<{ farmSlug: string }>();
  const farmSlug = params.farmSlug;
  const { state, setProgress, setResult, setImportJobId } = useOnboarding();
  const [view, setView] = useState<ViewState>({ kind: "waiting" });

  const readyToImport =
    state.proposal !== null && state.file !== null && state.fullRowCount > 0;

  const mappingJson = useMemo(() => {
    if (!state.proposal) return "";
    return serializeMapping(
      state.proposal,
      state.mappingOverrides,
      state.unmappedOverrides,
    );
  }, [state.proposal, state.mappingOverrides, state.unmappedOverrides]);

  const handleFile = useCallback(
    async (file: File) => {
      if (!state.proposal || !state.file) {
        setView({
          kind: "error",
          message:
            "Mapping is missing — please go back and complete steps 2 and 3.",
        });
        return;
      }

      setView({ kind: "verifying" });

      let parsed: Awaited<ReturnType<typeof parseSpreadsheet>>;
      let hashHex: string;
      try {
        [parsed, hashHex] = await Promise.all([
          parseSpreadsheet(file),
          hashFile(file),
        ]);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Could not read the file";
        setView({ kind: "error", message });
        return;
      }

      if (hashHex !== state.file.hashHex) {
        setView({
          kind: "error",
          message:
            "That file doesn't match the one from step 2. Please re-upload the exact same spreadsheet.",
        });
        return;
      }

      const rawRows =
        parsed.sampleRows.length >= parsed.fullRowCount
          ? parsed.sampleRows
          : await readAllRows(file);
      const rows = materializeRows(
        rawRows,
        state.proposal,
        state.mappingOverrides,
        state.unmappedOverrides,
      );

      if (rows.length === 0) {
        setView({
          kind: "error",
          message: "No rows to import after applying the mapping.",
        });
        return;
      }

      setView({ kind: "committing", rows, mappingJson });
    },
    [
      state.proposal,
      state.file,
      state.mappingOverrides,
      state.unmappedOverrides,
      mappingJson,
    ],
  );

  const handleComplete = useCallback(
    (result: CommitResultFrame) => {
      setResult(result);
      if (farmSlug) router.push(`/${farmSlug}/onboarding/done`);
    },
    [farmSlug, router, setResult],
  );

  const handleError = useCallback((message: string) => {
    setView({ kind: "error", message });
  }, []);

  const handleProgress = useCallback(
    (p: CommitProgressFrame) => {
      setProgress(p);
    },
    [setProgress],
  );

  // Guard: if user landed here without a proposal, bounce back
  if (!readyToImport) {
    return (
      <StepShell
        eyebrow="Step 04 · Import"
        title="Missing upload data"
        lead={
          <>
            We need your file and an approved mapping before we can import.
            Start from step 2 to pick things up.
          </>
        }
      >
        <div>
          <button
            type="button"
            onClick={() =>
              farmSlug && router.push(`/${farmSlug}/onboarding/upload`)
            }
            className="inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold"
            style={{
              background:
                "linear-gradient(135deg, rgba(229,185,100,0.95) 0%, rgba(196,144,48,0.95) 45%, rgba(160,82,45,0.95) 100%)",
              color: "#1A1510",
              fontFamily: "var(--font-sans)",
            }}
          >
            Back to upload
          </button>
        </div>
      </StepShell>
    );
  }

  const file = state.file!;

  const aboveHeading = (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING_SOFT}
      className="mb-3 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11.5px]"
      style={{
        borderColor: "rgba(196,144,48,0.3)",
        background: "rgba(31,24,16,0.75)",
        color: ONBOARDING_COLORS.muted,
        fontFamily: "var(--font-mono, ui-monospace)",
        letterSpacing: "0.01em",
      }}
    >
      <FileSpreadsheet size={12} className="text-amber-300" strokeWidth={2} />
      {file.name}
      <span aria-hidden="true" style={{ color: ONBOARDING_COLORS.whisper }}>
        ·
      </span>
      <span>{state.fullRowCount.toLocaleString()} rows</span>
    </motion.div>
  );

  return (
    <StepShell
      eyebrow="Step 04 · Import"
      title={
        <>
          Ready to write{" "}
          <span
            className="italic"
            style={{
              fontFamily: "var(--font-dm-serif)",
              color: ONBOARDING_COLORS.amberBright,
            }}
          >
            {state.fullRowCount.toLocaleString()}
          </span>{" "}
          animals.
        </>
      }
      lead={
        <>
          To protect your data, FarmTrack never uploads the full spreadsheet —
          we only sent a 20-row preview to the AI. Re-drop <strong style={{ color: ONBOARDING_COLORS.parchment }}>{file.name}</strong> to start the import.
          We verify it&apos;s the same file before anything is written.
        </>
      }
      aboveHeading={aboveHeading}
    >
      {view.kind === "waiting" && (
        <FileDropzone onFile={handleFile} isLoading={false} />
      )}

      {view.kind === "verifying" && (
        <FileDropzone onFile={() => undefined} isLoading={true} />
      )}

      {view.kind === "committing" && state.proposal && (
        <CommitProgress
          rows={view.rows}
          defaultSpecies={state.species}
          sourceFilename={file.name}
          sourceFileHash={file.hashHex}
          mappingJson={view.mappingJson}
          importJobId={state.importJobId}
          onProgress={handleProgress}
          onComplete={(result) => {
            setImportJobId(null);
            handleComplete(result);
          }}
          onError={handleError}
        />
      )}

      {view.kind === "error" && (
        <motion.div
          role="alert"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={SPRING_SOFT}
          className="flex flex-col gap-3 rounded-2xl p-5"
          style={{
            background:
              "linear-gradient(180deg, rgba(200,81,58,0.08) 0%, rgba(36,28,20,0.95) 100%)",
            border: "1px solid rgba(200,81,58,0.4)",
          }}
        >
          <div className="flex items-start gap-3">
            <div
              className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full"
              style={{
                background: "rgba(200,81,58,0.15)",
                border: "1px solid rgba(200,81,58,0.4)",
                color: "#E88C78",
              }}
              aria-hidden="true"
            >
              <AlertTriangle size={14} strokeWidth={2.2} />
            </div>
            <p
              className="flex-1 text-[0.9375rem] font-medium leading-[1.55]"
              style={{
                color: "#F5C2B5",
                fontFamily: "var(--font-sans)",
              }}
            >
              {view.message}
            </p>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                setImportJobId(null);
                setProgress(null);
                setView({ kind: "waiting" });
              }}
              className="group inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm transition-colors"
              style={{
                background: "transparent",
                border: "1px solid rgba(196,144,48,0.4)",
                color: ONBOARDING_COLORS.parchment,
                fontFamily: "var(--font-sans)",
              }}
            >
              <RotateCcw size={12} strokeWidth={2.2} className="transition-transform group-hover:-rotate-45" />
              Try again
            </button>
          </div>
        </motion.div>
      )}
    </StepShell>
  );
}

