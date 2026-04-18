"use client";

/**
 * Step 2 — file upload + AI mapping call.
 *
 * Flow:
 *   idle     → user drops/chooses a file
 *   loading  → parsing in the browser, then POST /api/onboarding/map-columns
 *   success  → setProposal + router.push to /mapping
 *   fallback → show TemplateFallback with a kind-specific copy + retry
 *
 * Parse + hash run in parallel so the user waits on the slower of the two.
 * Parse errors surface as `validation-error` fallbacks.
 */

import { useCallback, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { FileDropzone } from "@/components/onboarding/FileDropzone";
import { StepShell } from "@/components/onboarding/StepShell";
import {
  TemplateFallback,
  type TemplateFallbackReason,
} from "@/components/onboarding/TemplateFallback";
import { useOnboarding } from "@/components/onboarding/OnboardingProvider";
import { hashFile, parseSpreadsheet } from "@/lib/onboarding/parse-file";
import type { ProposalResult } from "@/lib/onboarding/client-types";

type ViewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "fallback"; reason: TemplateFallbackReason };

export default function OnboardingUploadPage() {
  const router = useRouter();
  const params = useParams<{ farmSlug: string }>();
  const farmSlug = params.farmSlug;
  const { setParsedFile, setProposal } = useOnboarding();
  const [view, setView] = useState<ViewState>({ kind: "idle" });

  const handleFile = useCallback(
    async (file: File) => {
      setView({ kind: "loading" });

      let parsed: Awaited<ReturnType<typeof parseSpreadsheet>>;
      let hashHex: string;
      try {
        [parsed, hashHex] = await Promise.all([
          parseSpreadsheet(file),
          hashFile(file),
        ]);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown parse error";
        setView({
          kind: "fallback",
          reason: { kind: "validation-error", message },
        });
        return;
      }

      setParsedFile({
        file: { name: file.name, size: file.size, hashHex },
        parsedColumns: parsed.parsedColumns,
        sampleRows: parsed.sampleRows,
        fullRowCount: parsed.fullRowCount,
      });

      let response: Response;
      try {
        response = await fetch("/api/onboarding/map-columns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            parsedColumns: parsed.parsedColumns,
            sampleRows: parsed.sampleRows,
            fullRowCount: parsed.fullRowCount,
          }),
        });
      } catch {
        setView({ kind: "fallback", reason: { kind: "upstream-error" } });
        return;
      }

      if (response.ok) {
        try {
          const json = (await response.json()) as ProposalResult;
          setProposal(json);
        } catch {
          setView({
            kind: "fallback",
            reason: { kind: "unknown", message: "Could not read AI response" },
          });
          return;
        }
        if (farmSlug) router.push(`/${farmSlug}/onboarding/mapping`);
        return;
      }

      let errorBody: { error?: string; retryAfterMs?: number } = {};
      try {
        errorBody = (await response.json()) as typeof errorBody;
      } catch {
        /* leave empty — fallback copy covers this */
      }

      if (response.status === 429) {
        setView({
          kind: "fallback",
          reason: { kind: "rate-limit", retryAfterMs: errorBody.retryAfterMs },
        });
      } else if (response.status === 502 || response.status === 503) {
        setView({
          kind: "fallback",
          reason: { kind: "upstream-error", message: errorBody.error },
        });
      } else {
        setView({
          kind: "fallback",
          reason: { kind: "unknown", message: errorBody.error },
        });
      }
    },
    [farmSlug, router, setParsedFile, setProposal],
  );

  return (
    <StepShell
      eyebrow="Step 02 · Upload"
      title={
        <>
          Hand us your{" "}
          <span
            className="italic"
            style={{
              fontFamily: "var(--font-dm-serif)",
              color: "#E5B964",
            }}
          >
            spreadsheet
          </span>
          .
        </>
      }
      lead={
        <>
          Any format is fine — we&apos;ll figure the columns out. The file is parsed
          in your browser and only the header plus a 20-row preview are sent to the AI.
        </>
      }
    >
      {view.kind === "fallback" ? (
        <TemplateFallback
          reason={view.reason}
          onRetry={() => setView({ kind: "idle" })}
        />
      ) : (
        <FileDropzone onFile={handleFile} isLoading={view.kind === "loading"} />
      )}
    </StepShell>
  );
}
