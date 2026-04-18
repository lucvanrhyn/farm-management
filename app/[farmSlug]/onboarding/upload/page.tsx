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
 * Parse errors from the spreadsheet (e.g. "File too large") surface as a
 * `validation-error` fallback so the user gets the same escape hatch as API
 * failures. Hashing + parsing run in parallel so the user waits on the slower
 * of the two rather than the sum.
 */

import { useCallback, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { FileDropzone } from "@/components/onboarding/FileDropzone";
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

      // Parse + hash in parallel. Parse errors are surfaced as
      // validation-error fallbacks; hash failures are system errors.
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

      // Persist to provider so later steps can read sampleRows/fullRowCount
      // and the import step can confirm the re-uploaded file matches.
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
        setView({
          kind: "fallback",
          reason: { kind: "upstream-error" },
        });
        return;
      }

      if (response.ok) {
        try {
          const json = (await response.json()) as ProposalResult;
          setProposal(json);
        } catch {
          setView({
            kind: "fallback",
            reason: {
              kind: "unknown",
              message: "Could not read AI response",
            },
          });
          return;
        }
        if (farmSlug) router.push(`/${farmSlug}/onboarding/mapping`);
        return;
      }

      // Error path — decode the JSON error body so the fallback can show a
      // useful message.
      let errorBody: { error?: string; retryAfterMs?: number } = {};
      try {
        errorBody = (await response.json()) as typeof errorBody;
      } catch {
        /* leave empty — fallback copy covers this */
      }

      if (response.status === 429) {
        setView({
          kind: "fallback",
          reason: {
            kind: "rate-limit",
            retryAfterMs: errorBody.retryAfterMs,
          },
        });
      } else if (response.status === 502 || response.status === 503) {
        setView({
          kind: "fallback",
          reason: {
            kind: "upstream-error",
            message: errorBody.error,
          },
        });
      } else {
        setView({
          kind: "fallback",
          reason: {
            kind: "unknown",
            message: errorBody.error,
          },
        });
      }
    },
    [farmSlug, router, setParsedFile, setProposal],
  );

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
          Upload your animals file
        </h2>
        <p
          style={{
            fontFamily: "var(--font-sans)",
            color: "#8A6840",
            fontSize: "0.875rem",
            lineHeight: 1.6,
          }}
        >
          Any spreadsheet will do &mdash; we&apos;ll figure out the columns.
          Nothing is saved until you confirm on the next screen.
        </p>
      </div>

      {view.kind === "fallback" ? (
        <TemplateFallback
          reason={view.reason}
          onRetry={() => setView({ kind: "idle" })}
        />
      ) : (
        <FileDropzone onFile={handleFile} isLoading={view.kind === "loading"} />
      )}
    </div>
  );
}
