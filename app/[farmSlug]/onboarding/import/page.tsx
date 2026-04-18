"use client";

/**
 * Step 4 — commit import with SSE progress.
 *
 * This step is where the full file contents finally cross into the server.
 * Steps 1–3 only moved 20 sample rows around (for the AI call); the provider
 * deliberately does not store the full dataset or the original File object to
 * keep sessionStorage under its 5 MB quota.
 *
 * To import every row we ask the user to re-drop the same file. We verify the
 * SHA-256 matches the hash captured on step 2 — so the mapping reviewed on
 * step 3 still applies — then materialize ImportRow[] by applying the
 * effective mapping to every row and stream the commit via CommitProgress.
 */

import { useCallback, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { CommitProgress } from "@/components/onboarding/CommitProgress";
import { FileDropzone } from "@/components/onboarding/FileDropzone";
import { useOnboarding } from "@/components/onboarding/OnboardingProvider";
import { hashFile, parseSpreadsheet, sanitizeRow } from "@/lib/onboarding/parse-file";
import type {
  CommitProgressFrame,
  CommitResultFrame,
  ImportRow,
  ProposalResult,
} from "@/lib/onboarding/client-types";

type ViewState =
  | { kind: "waiting" } // no file yet — show dropzone
  | { kind: "verifying" } // parsing + hashing the re-uploaded file
  | {
      kind: "committing";
      rows: ImportRow[];
      mappingJson: string;
    }
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

/**
 * Stable string form of the mapping that was actually applied. Shipped to the
 * server as the ImportJob audit trail — reproducing this value reproduces the
 * exact row materialization.
 */
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
  const {
    state,
    setProgress,
    setResult,
    setImportJobId,
  } = useOnboarding();
  const [view, setView] = useState<ViewState>({ kind: "waiting" });

  const readyToImport =
    state.proposal !== null &&
    state.file !== null &&
    state.fullRowCount > 0;

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

      const rows = materializeRows(
        parsed.sampleRows.length >= parsed.fullRowCount
          ? parsed.sampleRows
          : await readAllRows(file),
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

  // Guard: if the user landed here without a proposal (e.g. direct URL),
  // bounce them back to the upload step.
  if (!readyToImport) {
    return (
      <div
        className="mt-6 flex flex-col gap-3 rounded-[2rem] px-8 py-8"
        style={{
          background: "#241C14",
          border: "1px solid rgba(196,144,48,0.18)",
        }}
      >
        <h2
          style={{
            fontFamily: "var(--font-display)",
            color: "#F0DEB8",
            fontSize: "1.25rem",
            fontWeight: 700,
          }}
        >
          Missing upload data
        </h2>
        <p
          style={{
            fontFamily: "var(--font-sans)",
            color: "#8A6840",
            fontSize: "0.875rem",
          }}
        >
          Please start from the beginning — we need your file and an approved
          mapping before we can import.
        </p>
        <div>
          <Button
            onClick={() =>
              farmSlug && router.push(`/${farmSlug}/onboarding/upload`)
            }
          >
            Back to upload
          </Button>
        </div>
      </div>
    );
  }

  // At this point state.file + state.proposal are both non-null.
  const file = state.file!;

  return (
    <div
      className="mt-6 flex flex-col gap-5 rounded-[2rem] px-8 py-8"
      style={{
        background: "#241C14",
        border: "1px solid rgba(196,144,48,0.18)",
        boxShadow:
          "0 0 48px rgba(196,144,48,0.06), 0 8px 40px rgba(0,0,0,0.55)",
      }}
    >
      <div className="flex flex-col gap-2">
        <h2
          style={{
            fontFamily: "var(--font-display)",
            color: "#F0DEB8",
            fontSize: "1.5rem",
            fontWeight: 700,
          }}
        >
          Ready to import {state.fullRowCount} animals
        </h2>
        <p
          style={{
            fontFamily: "var(--font-sans)",
            color: "#8A6840",
            fontSize: "0.875rem",
            lineHeight: 1.6,
          }}
        >
          To protect your data we keep spreadsheets in your browser, not on our
          servers. Re-select{" "}
          <span style={{ color: "#F0DEB8", fontWeight: 600 }}>{file.name}</span>{" "}
          to start the import. We verify it&apos;s the same file before anything
          is written.
        </p>
      </div>

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
            // Clear any importJobId so a later re-try creates a fresh job.
            setImportJobId(null);
            handleComplete(result);
          }}
          onError={handleError}
        />
      )}

      {view.kind === "error" && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-lg p-4"
          style={{
            background: "rgba(220,60,60,0.1)",
            border: "1px solid rgba(220,60,60,0.4)",
          }}
        >
          <p
            style={{
              fontFamily: "var(--font-sans)",
              color: "#F5C2B5",
              fontSize: "0.9375rem",
              fontWeight: 600,
            }}
          >
            {view.message}
          </p>
          <div>
            <Button
              variant="outline"
              onClick={() => {
                // Drop any stale importJobId so the retry creates a fresh
                // ImportJob server-side instead of trying to resume a
                // partially-failed one (see Phase 2 review HIGH #2).
                setImportJobId(null);
                setProgress(null);
                setView({ kind: "waiting" });
              }}
            >
              Try again
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Re-parse a file and return every row (not just the 20-row sample). The
 * dropzone path we hit from this page has already validated size + header
 * shape via parseSpreadsheet, so calling it again is cheap and re-uses the
 * same error messages.
 *
 * We only fall back to this when the cached sampleRows count is smaller than
 * fullRowCount — i.e. the file has more than the 20-row preview that step 2
 * shipped to the AI.
 */
async function readAllRows(
  file: File,
): Promise<Record<string, unknown>[]> {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });
  // Apply the same formula-injection defuser parseSpreadsheet applies to the
  // 20-row preview — otherwise payloads in rows 21+ slip through to the
  // server unsanitized. See Phase 2 review CRITICAL #1.
  return rows.map(sanitizeRow);
}
