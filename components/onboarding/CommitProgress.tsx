"use client";

/**
 * Streams progress from POST /api/onboarding/commit-import.
 *
 * The route emits named SSE frames (`event: progress|complete|error`) which
 * differs from the plain-data SSE used by the legacy AnimalImporter. We parse
 * both the event name and the data payload per frame and dispatch to the
 * appropriate callback. The request is fired once on mount and aborted on
 * unmount to avoid leaking streams if the user navigates away mid-import.
 */

import { useEffect, useState } from "react";
import type {
  CommitProgressFrame,
  CommitResultFrame,
  ImportRow,
  OnboardingSpecies,
} from "@/lib/onboarding/client-types";

type Props = {
  rows: ImportRow[];
  defaultSpecies: OnboardingSpecies;
  sourceFilename: string;
  sourceFileHash: string;
  /** Pre-stringified mapping JSON (either the AI proposal or the final overrides). */
  mappingJson: string;
  importJobId?: string | null;
  onProgress: (p: CommitProgressFrame) => void;
  onComplete: (r: CommitResultFrame) => void;
  onError: (message: string) => void;
};

const PHASE_LABELS: Record<CommitProgressFrame["phase"], string> = {
  validating: "Validating rows",
  pedigree: "Resolving pedigree",
  inserting: "Inserting animals",
  done: "Finishing up",
};

export function CommitProgress({
  rows,
  defaultSpecies,
  sourceFilename,
  sourceFileHash,
  mappingJson,
  importJobId,
  onProgress,
  onComplete,
  onError,
}: Props) {
  const [frame, setFrame] = useState<CommitProgressFrame | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function run() {
      let response: Response;
      try {
        response = await fetch("/api/onboarding/commit-import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rows,
            defaultSpecies,
            sourceFilename,
            sourceFileHash,
            mappingJson,
            ...(importJobId ? { importJobId } : {}),
          }),
          signal: controller.signal,
        });
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        const message =
          err instanceof Error ? err.message : "Network error — try again";
        onError(message);
        return;
      }

      if (!response.ok) {
        let errorText = "Import failed";
        try {
          const body = (await response.json()) as { error?: string };
          if (typeof body.error === "string") errorText = body.error;
        } catch {
          // Non-JSON error body — fall back to the generic message.
        }
        if (!cancelled) onError(errorText);
        return;
      }

      const body = response.body;
      if (!body) {
        if (!cancelled) onError("Empty response from server");
        return;
      }

      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          // Belt-and-braces abort check: the browser may continue buffering the
          // stream past controller.abort() until the reader yields. Bail before
          // every read so cancelled closures don't continue dispatching frames.
          if (cancelled) {
            try {
              await reader.cancel();
            } catch {
              /* reader already closed */
            }
            break;
          }
          const { done, value } = await reader.read();
          if (done || cancelled) break;
          buffer += decoder.decode(value, { stream: true });

          let separatorIndex = buffer.indexOf("\n\n");
          while (separatorIndex !== -1 && !cancelled) {
            const rawFrame = buffer.slice(0, separatorIndex);
            buffer = buffer.slice(separatorIndex + 2);
            handleFrame(rawFrame);
            separatorIndex = buffer.indexOf("\n\n");
          }
        }
        // Flush any remaining trailing frame (some servers don't add the
        // final \n\n before closing the stream).
        if (!cancelled && buffer.length > 0) handleFrame(buffer);
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        const message =
          err instanceof Error ? err.message : "Stream read failed";
        onError(message);
      }
    }

    function handleFrame(rawFrame: string) {
      if (cancelled) return;
      const lines = rawFrame.split("\n");
      let eventName: string | null = null;
      const dataLines: string[] = [];
      for (const line of lines) {
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trim());
        }
      }
      if (!eventName || dataLines.length === 0) return;
      const dataJson = dataLines.join("\n");
      let payload: unknown;
      try {
        payload = JSON.parse(dataJson);
      } catch {
        return;
      }

      if (eventName === "progress") {
        const p = payload as CommitProgressFrame;
        setFrame(p);
        onProgress(p);
      } else if (eventName === "complete") {
        onComplete(payload as CommitResultFrame);
      } else if (eventName === "error") {
        const msg =
          typeof (payload as { message?: unknown }).message === "string"
            ? (payload as { message: string }).message
            : "Import failed";
        onError(msg);
      }
    }

    void run();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // Intentionally run once on mount — the parent page mounts this component
    // after the user confirms the commit. Re-firing on prop changes would
    // double-charge the user's rate-limit budget.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pct =
    frame && frame.total > 0
      ? Math.min(100, Math.round((frame.processed / frame.total) * 100))
      : 0;

  return (
    <div
      className="flex flex-col gap-3 rounded-2xl p-6"
      style={{
        background: "#241C14",
        border: "1px solid rgba(196,144,48,0.18)",
        boxShadow: "0 8px 40px rgba(0,0,0,0.4)",
      }}
    >
      <div className="flex items-center justify-between">
        <p
          style={{
            fontFamily: "var(--font-sans)",
            color: "#F0DEB8",
            fontSize: "0.9375rem",
            fontWeight: 600,
          }}
        >
          {frame ? PHASE_LABELS[frame.phase] : "Preparing import"}
        </p>
        <p
          style={{
            fontFamily: "var(--font-sans)",
            color: "#8A6840",
            fontSize: "0.8125rem",
          }}
        >
          {frame ? `${frame.processed} / ${frame.total}` : "starting…"}
        </p>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-2 w-full overflow-hidden rounded-full"
        style={{ background: "rgba(140,100,60,0.2)" }}
      >
        <div
          className="h-full transition-[width] duration-300 ease-out"
          style={{
            width: `${pct}%`,
            background: "#C49030",
          }}
        />
      </div>
    </div>
  );
}
