"use client";

/**
 * EinsteinChat — streaming chat UI for Farm Einstein (Phase L Wave 2D).
 *
 * Responsibilities:
 *   - POST user question + last-10 message history to /api/einstein/ask.
 *   - Parse the SSE response stream (token / final / error frames) and
 *     render a progressive typewriter effect while tokens arrive.
 *   - Render numeric citation superscripts inline and delegate hover/
 *     navigation to <CitationChip>.
 *   - Dispatch thumbs up/down feedback to /api/einstein/feedback using the
 *     queryLogId emitted with the final frame.
 *   - Surface typed error codes (tier-lock, budget exhausted, citation
 *     fabrication, rate limit) with actionable copy instead of a generic
 *     "something went wrong".
 *
 * Non-goals:
 *   - No hardcoded "Einstein" strings. All user-visible references to the
 *     assistant's name route through {@link useAssistantName} so Wave 3's
 *     rename editor propagates everywhere.
 *   - No persistence — chat history is transient to this component (the
 *     server-side RagQueryLog table is the system of record).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import Link from "next/link";
import { useAssistantName } from "@/hooks/useAssistantName";
import { Icon } from "@/components/ds";
import CitationChip from "./CitationChip";
import type { Citation } from "@/lib/einstein/retriever";
import type { EinsteinAnswer } from "@/lib/einstein/answer";

// ---------------------------------------------------------------------------
// UI-only SSE frame types (inlined from former components/einstein/types.ts)
//
// Wave 3E consolidation: the former isolation stub duplicated Citation +
// EinsteinAnswer from lib/einstein. Those two now import directly from lib.
// The remaining types below are strictly UI concerns (SSE frames the chat
// consumes + user-facing error taxonomy) and live with the consumer.
// ---------------------------------------------------------------------------

/**
 * Final-frame payload the SSE stream emits. Extends the lib `EinsteinAnswer`
 * contract with a server-assigned RagQueryLog id that thumbs up/down needs.
 */
export type EinsteinFinalFrame = EinsteinAnswer & {
  readonly queryLogId?: string;
};

/** Typed error codes the ask endpoint may return. */
export type EinsteinErrorCode =
  | "EINSTEIN_TIER_LOCKED"
  | "EINSTEIN_BUDGET_EXHAUSTED"
  | "EINSTEIN_CITATION_FABRICATION"
  | "EINSTEIN_RATE_LIMITED"
  | "EINSTEIN_INTERNAL_ERROR";

export interface EinsteinErrorFrame {
  readonly code: EinsteinErrorCode;
  readonly message: string;
  /** For BUDGET_EXHAUSTED: human-readable reset date, e.g. "1 May". */
  readonly resetLabel?: string;
}

/**
 * UI-facing refusal reason alias. Mirrors lib's `EinsteinRefusalReason` but
 * keeps the existing "Refused" UI-name the chat component already uses.
 */
export type EinsteinRefusedReason =
  | "NO_GROUNDED_EVIDENCE"
  | "OUT_OF_SCOPE"
  | "TIER_LIMIT";

// ---------------------------------------------------------------------------
// Types + constants
// ---------------------------------------------------------------------------

export interface EinsteinChatProps {
  readonly farmSlug: string;
  readonly className?: string;
}

type MessageRole = "user" | "assistant" | "error";

interface ChatMessage {
  readonly id: string;
  readonly role: MessageRole;
  readonly content: string;
  readonly citations?: readonly Citation[];
  readonly queryLogId?: string;
  readonly refusedReason?: EinsteinRefusedReason;
  readonly errorCode?: EinsteinErrorCode;
  readonly resetLabel?: string;
  /** User's feedback; undefined = not yet rated. */
  readonly feedback?: "up" | "down";
}

interface UiError {
  readonly code: string;
  readonly message: string;
}

/** Cap on history sent to the server — avoids blowing the prompt budget. */
const HISTORY_WINDOW = 10;

/** Regex matching `[1]`, `[12]` etc. in the assistant's rendered answer. */
const CITATION_MARKER = /\[(\d+)\]/g;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EinsteinChat({ farmSlug, className }: EinsteinChatProps) {
  const assistantName = useAssistantName();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [currentStreamText, setCurrentStreamText] = useState("");
  const [error, setError] = useState<UiError | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messageIdRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll the transcript on new content.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, currentStreamText]);

  // Abort any in-flight stream on unmount to avoid setState-after-unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const nextMessageId = useCallback(() => {
    messageIdRef.current += 1;
    return `m${messageIdRef.current}`;
  }, []);

  // ------------------------------------------------------------------
  // Send handler
  // ------------------------------------------------------------------

  const handleSend = useCallback(async () => {
    const question = input.trim();
    if (!question || streaming) return;

    const userMessage: ChatMessage = {
      id: nextMessageId(),
      role: "user",
      content: question,
    };

    // Snapshot history at send-time so the network payload doesn't depend
    // on race-y React state reads.
    const historyAtSend = messages
      .filter((m): m is ChatMessage & { role: "user" | "assistant" } =>
        m.role === "user" || m.role === "assistant",
      )
      .slice(-HISTORY_WINDOW)
      .map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setStreaming(true);
    setCurrentStreamText("");
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/einstein/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          assistantName,
          history: historyAtSend,
          farmSlug,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        await handleNonOkResponse(response, setMessages, nextMessageId);
        setStreaming(false);
        setCurrentStreamText("");
        return;
      }

      const body = response.body;
      if (!body) {
        setError({ code: "EMPTY_BODY", message: "No response body from server." });
        setStreaming(false);
        setCurrentStreamText("");
        return;
      }

      await consumeStream(body, {
        onToken: (text) => setCurrentStreamText((curr) => curr + text),
        onFinal: (final) => {
          setMessages((prev) => [
            ...prev,
            {
              id: nextMessageId(),
              role: "assistant",
              content: final.answer,
              citations: final.citations,
              queryLogId: final.queryLogId,
              refusedReason: final.refusedReason,
            },
          ]);
          setCurrentStreamText("");
        },
        onError: (frame) => {
          setMessages((prev) => [
            ...prev,
            {
              id: nextMessageId(),
              role: "error",
              content: frame.message,
              errorCode: frame.code,
              resetLabel: frame.resetLabel,
            },
          ]);
          setCurrentStreamText("");
        },
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      const message =
        err instanceof Error ? err.message : "Connection lost — please retry.";
      setError({ code: "NETWORK", message });
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [
    input,
    streaming,
    messages,
    assistantName,
    farmSlug,
    nextMessageId,
  ]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter sends; Shift+Enter inserts a newline.
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  const onFeedback = useCallback(
    async (messageId: string, value: "up" | "down") => {
      const target = messages.find((m) => m.id === messageId);
      if (!target || target.role !== "assistant" || target.feedback) return;
      if (!target.queryLogId) return;

      // Optimistic update — the POST is fire-and-forget for UX responsiveness.
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, feedback: value } : m,
        ),
      );

      try {
        await fetch("/api/einstein/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            queryLogId: target.queryLogId,
            feedback: value,
            // Epic D1 (#488): the feedback route pins the tenant via an explicit
            // body slug (mirroring /ask), not Referer inference. Send the slug.
            farmSlug,
          }),
        });
      } catch {
        // Non-fatal — feedback is advisory telemetry, not load-bearing.
      }
    },
    [messages, farmSlug],
  );

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  const canSend = !streaming && input.trim().length > 0;

  return (
    <div
      className={`dark-surface ft-scope flex flex-col h-full ${className ?? ""}`}
      data-testid="einstein-chat"
      style={{ background: "var(--ft-bg)", color: "var(--ft-text)" }}
    >
      <EinsteinChatStyles />

      {/* Header — assistant wordmark (Fraunces) + mono online status */}
      <header
        className="flex items-center gap-3 px-5 py-4"
        style={{ borderBottom: "1px solid var(--ft-border)" }}
      >
        <span
          className="flex shrink-0 items-center justify-center"
          aria-hidden="true"
          style={{
            width: 38,
            height: 38,
            borderRadius: "var(--ft-r-sm)",
            background: "var(--ft-accent)",
            color: "#FFF6EE",
          }}
        >
          <Icon.einstein size={21} />
        </span>
        <div className="min-w-0 flex-1">
          <h2
            className="ft-serif"
            data-testid="assistant-wordmark"
            style={{
              fontSize: 19,
              fontWeight: 500,
              lineHeight: 1.05,
              letterSpacing: "-0.01em",
              margin: 0,
              color: "var(--ft-text)",
            }}
          >
            {assistantName}
          </h2>
          <div
            className="ft-mono mt-1.5 flex items-center gap-1.5"
            style={{
              fontSize: 10.5,
              letterSpacing: ".06em",
              color: "var(--ft-subtle)",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background: "#5DBB6B",
                boxShadow: "0 0 8px #5DBB6B",
              }}
            />
            AI ADVISOR · ONLINE
          </div>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="ft-scrollbar flex-1 overflow-y-auto px-5 py-5 space-y-3"
        data-testid="einstein-transcript"
      >
        {messages.length === 0 && !streaming ? (
          <EmptyState assistantName={assistantName} />
        ) : null}

        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            farmSlug={farmSlug}
            onFeedback={onFeedback}
          />
        ))}

        {streaming ? (
          <StreamingBubble currentStreamText={currentStreamText} />
        ) : null}

        {error ? (
          <div
            className="ft-card px-3 py-2 text-sm"
            role="alert"
            style={{
              background: "var(--ft-crit-bg)",
              borderColor: "color-mix(in oklab, var(--ft-crit) 40%, var(--ft-border))",
              color: "var(--ft-crit)",
            }}
          >
            <span className="ft-mono block text-[0.65rem] uppercase tracking-wider opacity-80">
              {error.code}
            </span>
            <span className="mt-1 block">{error.message}</span>
          </div>
        ) : null}
      </div>

      <form
        className="p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSend();
        }}
        style={{ borderTop: "1px solid var(--ft-border)" }}
      >
        <label className="sr-only" htmlFor="einstein-input">
          Ask {assistantName}
        </label>
        <div
          className="flex items-center gap-2 py-1 pl-4 pr-1"
          style={{
            borderRadius: 999,
            background: "var(--ft-surface)",
            border: "1px solid var(--ft-border)",
          }}
        >
          <textarea
            id="einstein-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={`Ask ${assistantName}…`}
            rows={1}
            className="flex-1 min-w-0 resize-none border-0 bg-transparent text-sm focus:outline-none"
            style={{ color: "var(--ft-text)" }}
            disabled={streaming}
            data-testid="einstein-input"
          />
          <button
            type="submit"
            disabled={!canSend}
            aria-label={`Ask ${assistantName}`}
            className="flex shrink-0 items-center justify-center transition-colors disabled:cursor-not-allowed"
            data-testid="einstein-send"
            style={{
              width: 38,
              height: 38,
              borderRadius: 999,
              background: canSend ? "var(--ft-accent)" : "var(--ft-surface2)",
              color: canSend ? "#FFF6EE" : "var(--ft-subtle)",
            }}
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12h14" />
              <path d="M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}

export default EinsteinChat;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/**
 * Component-scoped keyframes for the typing-dot animation. globals.css /
 * design-system.css are owned elsewhere, so the chat ships its one bespoke
 * animation inline (visual-only, no behavior).
 */
function EinsteinChatStyles() {
  return (
    <style>{`
@keyframes einsteinType {
  0%, 60%, 100% { opacity: .25; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-3px); }
}
`}</style>
  );
}

function EmptyState({ assistantName }: { assistantName: string }) {
  return (
    <div
      className="py-8 text-center text-sm"
      style={{ color: "var(--ft-muted)" }}
    >
      Ask {assistantName} a question about your farm. Answers cite the
      underlying records so you can verify every claim.
    </div>
  );
}

function StreamingBubble({
  currentStreamText,
}: {
  currentStreamText: string;
}) {
  return (
    <div className="flex justify-start" data-testid="streaming-bubble">
      <div
        className="ft-card max-w-[85%] px-3.5 py-2.5 text-sm"
        style={{
          background: "var(--ft-surface)",
          borderBottomLeftRadius: 5,
          color: "var(--ft-text)",
        }}
      >
        {currentStreamText.length === 0 ? (
          <span className="inline-flex items-center gap-1.5 align-middle">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                aria-hidden="true"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: "var(--ft-muted)",
                  animation: `einsteinType 1.2s ${i * 0.18}s infinite ease-in-out`,
                }}
              />
            ))}
            <span className="sr-only">thinking…</span>
          </span>
        ) : (
          <span className="whitespace-pre-wrap">{currentStreamText}</span>
        )}
      </div>
    </div>
  );
}

interface MessageBubbleProps {
  readonly message: ChatMessage;
  readonly farmSlug: string;
  readonly onFeedback: (messageId: string, value: "up" | "down") => void;
}

function MessageBubble({ message, farmSlug, onFeedback }: MessageBubbleProps) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[85%] px-3.5 py-2.5 text-sm whitespace-pre-wrap"
          style={{
            background: "var(--ft-accent)",
            color: "#FFF6EE",
            borderRadius: "var(--ft-r-lg)",
            borderBottomRightRadius: 5,
          }}
        >
          {message.content}
        </div>
      </div>
    );
  }

  if (message.role === "error") {
    return (
      <ErrorBubble
        code={message.errorCode ?? "EINSTEIN_INTERNAL_ERROR"}
        message={message.content}
        resetLabel={message.resetLabel}
      />
    );
  }

  return (
    <div className="flex flex-col items-start">
      <div
        className="ft-card max-w-[85%] px-3.5 py-2.5 text-sm"
        data-testid="assistant-bubble"
        style={{
          background: "var(--ft-surface)",
          borderBottomLeftRadius: 5,
          color: "var(--ft-text)",
        }}
      >
        <AnswerWithCitations
          text={message.content}
          citations={message.citations ?? []}
          farmSlug={farmSlug}
        />
      </div>
      {message.queryLogId ? (
        <FeedbackControls
          messageId={message.id}
          value={message.feedback}
          onFeedback={onFeedback}
        />
      ) : null}
    </div>
  );
}

interface AnswerWithCitationsProps {
  readonly text: string;
  readonly citations: readonly Citation[];
  readonly farmSlug: string;
}

/**
 * Replace `[1]`, `[2]` markers in the answer text with interactive
 * CitationChips. Falls through text segments as plain strings so React's
 * reconciler doesn't rebuild the entire answer when nothing changed.
 */
function AnswerWithCitations({
  text,
  citations,
  farmSlug,
}: AnswerWithCitationsProps) {
  const parts = useMemo(() => {
    const segments: Array<
      | { readonly kind: "text"; readonly content: string }
      | { readonly kind: "cite"; readonly index: number; readonly citation: Citation }
    > = [];
    let lastEnd = 0;
    // Clone regex because global lastIndex is stateful.
    const re = new RegExp(CITATION_MARKER.source, "g");
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const idx = Number(match[1]);
      const citation = citations[idx - 1];
      if (match.index > lastEnd) {
        segments.push({
          kind: "text",
          content: text.slice(lastEnd, match.index),
        });
      }
      if (citation) {
        segments.push({ kind: "cite", index: idx, citation });
      } else {
        // Marker without a matching citation — keep the raw text so the
        // reader sees the number rather than the content silently dropping.
        segments.push({ kind: "text", content: match[0] });
      }
      lastEnd = match.index + match[0].length;
    }
    if (lastEnd < text.length) {
      segments.push({ kind: "text", content: text.slice(lastEnd) });
    }
    return segments;
  }, [text, citations]);

  return (
    <span className="whitespace-pre-wrap">
      {parts.map((part, i) =>
        part.kind === "text" ? (
          <span key={`t-${i}`}>{part.content}</span>
        ) : (
          <CitationChip
            key={`c-${i}`}
            index={part.index}
            citation={part.citation}
            farmSlug={farmSlug}
          />
        ),
      )}
    </span>
  );
}

interface FeedbackControlsProps {
  readonly messageId: string;
  readonly value: "up" | "down" | undefined;
  readonly onFeedback: (messageId: string, value: "up" | "down") => void;
}

function FeedbackControls({
  messageId,
  value,
  onFeedback,
}: FeedbackControlsProps) {
  const disabled = value !== undefined;
  return (
    <div
      className="mt-1.5 flex gap-1.5"
      data-testid="feedback-controls"
      aria-label="Rate this answer"
    >
      <button
        type="button"
        onClick={() => onFeedback(messageId, "up")}
        disabled={disabled}
        aria-pressed={value === "up"}
        data-testid="feedback-up"
        className="rounded px-2 py-0.5 text-xs transition-colors disabled:cursor-not-allowed"
        style={{
          background:
            value === "up" ? "var(--ft-good-bg)" : "var(--ft-surface2)",
          color: value === "up" ? "var(--ft-good)" : "var(--ft-muted)",
          opacity: disabled && value !== "up" ? 0.4 : 1,
        }}
      >
        👍
      </button>
      <button
        type="button"
        onClick={() => onFeedback(messageId, "down")}
        disabled={disabled}
        aria-pressed={value === "down"}
        data-testid="feedback-down"
        className="rounded px-2 py-0.5 text-xs transition-colors disabled:cursor-not-allowed"
        style={{
          background:
            value === "down" ? "var(--ft-crit-bg)" : "var(--ft-surface2)",
          color: value === "down" ? "var(--ft-crit)" : "var(--ft-muted)",
          opacity: disabled && value !== "down" ? 0.4 : 1,
        }}
      >
        👎
      </button>
    </div>
  );
}

interface ErrorBubbleProps {
  readonly code: EinsteinErrorCode;
  readonly message: string;
  readonly resetLabel?: string;
}

function ErrorBubble({ code, message, resetLabel }: ErrorBubbleProps) {
  const copy = errorCopy(code, message, resetLabel);
  return (
    <div
      className="ft-card px-3 py-2 text-sm"
      role="alert"
      data-testid={`error-bubble-${code}`}
      style={copy.tone}
    >
      <span className="ft-mono block text-[0.65rem] uppercase tracking-wider opacity-70">
        {code}
      </span>
      <span className="mt-1 block">{copy.body}</span>
      {copy.cta ? <div className="mt-2">{copy.cta}</div> : null}
    </div>
  );
}

/** Inline token style for the warning (amber/rust) error tone. */
const TONE_WARN: React.CSSProperties = {
  background: "var(--ft-fair-bg)",
  borderColor: "color-mix(in oklab, var(--ft-fair) 40%, var(--ft-border))",
  color: "var(--ft-fair)",
};
/** Inline token style for a neutral, non-alarming error tone. */
const TONE_NEUTRAL: React.CSSProperties = {
  background: "var(--ft-surface)",
  borderColor: "var(--ft-border)",
  color: "var(--ft-muted)",
};
/** Inline token style for a critical error tone. */
const TONE_CRIT: React.CSSProperties = {
  background: "var(--ft-crit-bg)",
  borderColor: "color-mix(in oklab, var(--ft-crit) 40%, var(--ft-border))",
  color: "var(--ft-crit)",
};

function errorCopy(
  code: EinsteinErrorCode,
  serverMessage: string,
  resetLabel?: string,
): {
  readonly tone: React.CSSProperties;
  readonly body: string;
  readonly cta?: React.ReactNode;
} {
  switch (code) {
    case "EINSTEIN_TIER_LOCKED":
      return {
        tone: TONE_WARN,
        body: "This feature is available on the Advanced plan.",
        cta: (
          <Link
            href="/subscription"
            className="ft-btn ft-btn-primary"
            style={{ padding: "6px 12px", fontSize: 12 }}
            data-testid="upgrade-cta"
          >
            <span>Upgrade plan</span>
          </Link>
        ),
      };
    case "EINSTEIN_BUDGET_EXHAUSTED":
      return {
        tone: TONE_NEUTRAL,
        body: resetLabel
          ? `You've reached this month's usage cap. It resets on ${resetLabel}.`
          : "You've reached this month's usage cap. It resets at the start of next month.",
      };
    case "EINSTEIN_CITATION_FABRICATION":
      return {
        tone: TONE_CRIT,
        body:
          "The assistant produced an answer that couldn't be verified against your farm records. Try rephrasing, or ask about a specific camp, animal, or date range.",
      };
    case "EINSTEIN_RATE_LIMITED":
      return {
        tone: TONE_NEUTRAL,
        body:
          "Too many requests in the last few minutes — please wait and try again.",
      };
    case "EINSTEIN_INTERNAL_ERROR":
    default:
      return {
        tone: TONE_CRIT,
        body: serverMessage || "Something went wrong — please try again.",
      };
  }
}

// ---------------------------------------------------------------------------
// Network helpers
// ---------------------------------------------------------------------------

/**
 * Map a non-OK response (403, 429, 402, 500) into an inline error bubble
 * in the transcript rather than a floating banner — keeps the failure
 * attached to the question that triggered it.
 */
async function handleNonOkResponse(
  response: Response,
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  nextId: () => string,
): Promise<void> {
  let code: EinsteinErrorCode = "EINSTEIN_INTERNAL_ERROR";
  let message = "Request failed.";
  let resetLabel: string | undefined;
  try {
    const body = (await response.json()) as {
      code?: string;
      error?: string;
      message?: string;
      resetLabel?: string;
    };
    if (typeof body.code === "string") {
      code = body.code as EinsteinErrorCode;
    } else {
      // Fallback: infer from status code.
      if (response.status === 403) code = "EINSTEIN_TIER_LOCKED";
      else if (response.status === 402 || response.status === 429)
        code = response.status === 402
          ? "EINSTEIN_BUDGET_EXHAUSTED"
          : "EINSTEIN_RATE_LIMITED";
    }
    message = body.message ?? body.error ?? message;
    if (typeof body.resetLabel === "string") resetLabel = body.resetLabel;
  } catch {
    // Non-JSON body — keep the default message/code.
  }

  setMessages((prev) => [
    ...prev,
    {
      id: nextId(),
      role: "error",
      content: message,
      errorCode: code,
      resetLabel,
    },
  ]);
}

interface StreamHandlers {
  readonly onToken: (text: string) => void;
  readonly onFinal: (payload: EinsteinFinalFrame) => void;
  readonly onError: (frame: EinsteinErrorFrame) => void;
}

/**
 * Consume an SSE ReadableStream, splitting on `\n\n` frame boundaries
 * and dispatching each frame to the corresponding handler. Buffer any
 * trailing partial frame until the next chunk arrives so we don't
 * accidentally drop events on chunk boundaries (a class of bug surfaced
 * during onboarding SSE work — see lib/onboarding/client-types.ts).
 */
async function consumeStream(
  body: ReadableStream<Uint8Array>,
  handlers: StreamHandlers,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let separator = buffer.indexOf("\n\n");
      while (separator !== -1) {
        const rawFrame = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        dispatchFrame(rawFrame, handlers);
        separator = buffer.indexOf("\n\n");
      }
    }
    if (buffer.length > 0) dispatchFrame(buffer, handlers);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
}

function dispatchFrame(rawFrame: string, handlers: StreamHandlers): void {
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

  if (eventName === "token") {
    const p = payload as { text?: string };
    if (typeof p.text === "string") handlers.onToken(p.text);
  } else if (eventName === "final") {
    handlers.onFinal(payload as EinsteinFinalFrame);
  } else if (eventName === "error") {
    const p = payload as Partial<EinsteinErrorFrame>;
    handlers.onError({
      code: (p.code ?? "EINSTEIN_INTERNAL_ERROR") as EinsteinErrorCode,
      message: typeof p.message === "string" ? p.message : "Assistant failed",
      resetLabel: p.resetLabel,
    });
  }
}
