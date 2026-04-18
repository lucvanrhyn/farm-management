"use client";

/**
 * SSE-driven import progress component.
 *
 * Renders a large copper progress ring while streaming named SSE events from
 * POST /api/onboarding/commit-import. The backend emits `event: progress`,
 * `event: complete`, and `event: error` frames — parsed by the read loop
 * below. `cancelled` is checked before every reader.read() so a fast unmount
 * doesn't dispatch callbacks after the component is gone.
 */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useTransform, animate } from "framer-motion";
import { Check, Database, Dna, ListChecks, Sparkles, type LucideIcon } from "lucide-react";
import type {
  CommitProgressFrame,
  CommitResultFrame,
  ImportRow,
  OnboardingSpecies,
} from "@/lib/onboarding/client-types";
import { ONBOARDING_COLORS, SPRING_SOFT } from "./theme";

type Props = {
  rows: ImportRow[];
  defaultSpecies: OnboardingSpecies;
  sourceFilename: string;
  sourceFileHash: string;
  /** Pre-stringified mapping JSON. */
  mappingJson: string;
  importJobId?: string | null;
  onProgress: (p: CommitProgressFrame) => void;
  onComplete: (r: CommitResultFrame) => void;
  onError: (message: string) => void;
};

const PHASE_LABELS: Record<CommitProgressFrame["phase"], string> = {
  validating: "Validating rows",
  pedigree: "Resolving pedigree",
  inserting: "Writing to the ledger",
  done: "Tidying up",
};

const PHASE_ICONS: Record<CommitProgressFrame["phase"], LucideIcon> = {
  validating: ListChecks,
  pedigree: Dna,
  inserting: Database,
  done: Sparkles,
};

// Ring geometry
const RING_SIZE = 220;
const RING_STROKE = 10;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;

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
  // Callback refs avoid stale-closure hazards in the mount-once effect below.
  const onProgressRef = useRef(onProgress);
  const onCompleteRef = useRef(onComplete);
  const onErrorRef = useRef(onError);
  onProgressRef.current = onProgress;
  onCompleteRef.current = onComplete;
  onErrorRef.current = onError;

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
        onErrorRef.current(message);
        return;
      }

      if (!response.ok) {
        let errorText = "Import failed";
        try {
          const body = (await response.json()) as { error?: string };
          if (typeof body.error === "string") errorText = body.error;
        } catch {
          /* fall back to the generic message */
        }
        if (!cancelled) onErrorRef.current(errorText);
        return;
      }

      const body = response.body;
      if (!body) {
        if (!cancelled) onErrorRef.current("Empty response from server");
        return;
      }

      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          if (cancelled) {
            try {
              await reader.cancel();
            } catch {
              /* already closed */
            }
            break;
          }
          const { done, value } = await reader.read();
          if (done || cancelled) break;
          buffer += decoder.decode(value, { stream: true });

          let separator = buffer.indexOf("\n\n");
          while (separator !== -1 && !cancelled) {
            const rawFrame = buffer.slice(0, separator);
            buffer = buffer.slice(separator + 2);
            handleFrame(rawFrame);
            separator = buffer.indexOf("\n\n");
          }
        }
        if (!cancelled && buffer.length > 0) handleFrame(buffer);
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        const message =
          err instanceof Error ? err.message : "Stream read failed";
        onErrorRef.current(message);
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
        onProgressRef.current(p);
      } else if (eventName === "complete") {
        onCompleteRef.current(payload as CommitResultFrame);
      } else if (eventName === "error") {
        const msg =
          typeof (payload as { message?: unknown }).message === "string"
            ? (payload as { message: string }).message
            : "Import failed";
        onErrorRef.current(msg);
      }
    }

    void run();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // Intentionally mount-once — re-firing would double-charge the rate limit.
    // Callbacks use refs above so stale closures aren't a concern.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <ProgressRing frame={frame} />;
}

// ---------------------------------------------------------------------------
// Visual ring
// ---------------------------------------------------------------------------

function ProgressRing({ frame }: { frame: CommitProgressFrame | null }) {
  const pct = frame && frame.total > 0
    ? Math.max(0, Math.min(1, frame.processed / frame.total))
    : 0;
  const Icon = frame ? PHASE_ICONS[frame.phase] : Sparkles;

  // Smoothly animate the counter digits.
  const counter = useMotionValue(0);
  const rounded = useTransform(counter, (v) => Math.round(v).toLocaleString());
  useEffect(() => {
    const target = frame?.processed ?? 0;
    const controls = animate(counter, target, {
      duration: 0.6,
      ease: "easeOut",
    });
    return controls.stop;
  }, [frame?.processed, counter]);

  return (
    <div className="relative flex flex-col items-center justify-center py-6">
      {/* Amber aurora behind the ring */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 60% at 50% 50%, rgba(229,185,100,0.18) 0%, transparent 60%)",
        }}
      />

      <div
        className="relative"
        style={{ width: RING_SIZE, height: RING_SIZE }}
      >
        <svg
          width={RING_SIZE}
          height={RING_SIZE}
          viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct * 100)}
          className="-rotate-90"
        >
          <defs>
            <linearGradient id="commitProgressRing" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#E5B964" />
              <stop offset="50%" stopColor="#C49030" />
              <stop offset="100%" stopColor="#A0522D" />
            </linearGradient>
          </defs>
          {/* Track */}
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            stroke="rgba(196,144,48,0.14)"
            strokeWidth={RING_STROKE}
            fill="none"
          />
          {/* Fill — strokeDashoffset spring-animates toward target */}
          <motion.circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            stroke="url(#commitProgressRing)"
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={RING_CIRC}
            style={{
              filter: "drop-shadow(0 0 12px rgba(196,144,48,0.45))",
            }}
            initial={{ strokeDashoffset: RING_CIRC }}
            animate={{ strokeDashoffset: RING_CIRC * (1 - pct) }}
            transition={SPRING_SOFT}
          />
        </svg>

        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <AnimatePresence mode="wait">
            <motion.div
              key={frame?.phase ?? "idle"}
              initial={{ opacity: 0, y: 6, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 300, damping: 24 }}
              className="flex flex-col items-center gap-1.5"
            >
              <div
                className="flex size-9 items-center justify-center rounded-full"
                style={{
                  background: "rgba(196,144,48,0.15)",
                  border: "1px solid rgba(229,185,100,0.35)",
                  color: ONBOARDING_COLORS.amberBright,
                }}
              >
                {frame?.phase === "done" ? (
                  <Check size={17} strokeWidth={3} />
                ) : (
                  <Icon size={16} strokeWidth={2} />
                )}
              </div>
              <div
                className="text-[1.9rem] leading-none tracking-tight"
                style={{
                  color: ONBOARDING_COLORS.cream,
                  fontFamily: "var(--font-display)",
                  fontWeight: 700,
                }}
              >
                <motion.span>{rounded}</motion.span>
                {frame ? (
                  <span
                    className="ml-1 text-[0.9rem] tracking-normal"
                    style={{
                      color: ONBOARDING_COLORS.muted,
                      fontFamily: "var(--font-sans)",
                      fontWeight: 500,
                    }}
                  >
                    / {frame.total.toLocaleString()}
                  </span>
                ) : null}
              </div>
              <div
                className="text-[10.5px] uppercase tracking-[0.22em]"
                style={{
                  color: ONBOARDING_COLORS.amberBright,
                  fontFamily: "var(--font-sans)",
                }}
              >
                {frame ? PHASE_LABELS[frame.phase] : "Preparing"}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Phase dots */}
      <div className="mt-8 flex items-center gap-2.5">
        {(["validating", "pedigree", "inserting", "done"] as const).map((p) => {
          const reached = frame
            ? ordinalOf(frame.phase) >= ordinalOf(p)
            : false;
          return (
            <span
              key={p}
              className="inline-block size-2 rounded-full transition-colors"
              style={{
                background: reached
                  ? ONBOARDING_COLORS.amberBright
                  : "rgba(196,144,48,0.2)",
                boxShadow: reached
                  ? "0 0 8px rgba(229,185,100,0.55)"
                  : "none",
              }}
              aria-label={p}
            />
          );
        })}
      </div>
    </div>
  );
}

function ordinalOf(phase: CommitProgressFrame["phase"]): number {
  return (["validating", "pedigree", "inserting", "done"] as const).indexOf(
    phase,
  );
}
