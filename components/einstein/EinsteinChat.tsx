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
import { useAssistantName } from "@/hooks/useAssistantName";
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
          }),
        });
      } catch {
        // Non-fatal — feedback is advisory telemetry, not load-bearing.
      }
    },
    [messages],
  );

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <div
      className={`flex flex-col h-full bg-stone-950 text-stone-100 ${className ?? ""}`}
      data-testid="einstein-chat"
    >
      <header className="border-b border-stone-800 px-4 py-3">
        <h2
          className="font-mono text-lg font-semibold tracking-tight text-amber-200"
          data-testid="assistant-wordmark"
        >
          {assistantName}
        </h2>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
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
            className="rounded-md border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-200"
            role="alert"
          >
            <span className="block font-mono text-[0.65rem] uppercase tracking-wider text-red-300">
              {error.code}
            </span>
            <span className="block mt-1">{error.message}</span>
          </div>
        ) : null}
      </div>

      <form
        className="border-t border-stone-800 p-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSend();
        }}
      >
        <label className="sr-only" htmlFor="einstein-input">
          Ask {assistantName}
        </label>
        <textarea
          id="einstein-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`Ask ${assistantName}…`}
          rows={1}
          className="flex-1 resize-none rounded-md border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-500 focus:border-amber-400 focus:outline-none"
          disabled={streaming}
          data-testid="einstein-input"
        />
        <button
          type="submit"
          disabled={streaming || input.trim().length === 0}
          className="rounded-md bg-amber-600 px-4 text-sm font-medium text-stone-950 transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="einstein-send"
        >
          Send
        </button>
      </form>
    </div>
  );
}

export default EinsteinChat;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EmptyState({ assistantName }: { assistantName: string }) {
  return (
    <div className="text-center text-sm text-stone-400 py-8">
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
      <div className="max-w-[85%] rounded-lg bg-stone-900 border border-stone-800 px-3 py-2 text-sm text-stone-100">
        {currentStreamText.length === 0 ? (
          <span className="text-stone-400 italic">thinking…</span>
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
        <div className="max-w-[85%] rounded-lg bg-amber-600/20 border border-amber-800 px-3 py-2 text-sm text-stone-100 whitespace-pre-wrap">
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
        className="max-w-[85%] rounded-lg bg-stone-900 border border-stone-800 px-3 py-2 text-sm text-stone-100"
        data-testid="assistant-bubble"
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
      className="mt-1 flex gap-1"
      data-testid="feedback-controls"
      aria-label="Rate this answer"
    >
      <button
        type="button"
        onClick={() => onFeedback(messageId, "up")}
        disabled={disabled}
        aria-pressed={value === "up"}
        data-testid="feedback-up"
        className={`rounded px-2 py-0.5 text-xs transition-colors ${
          value === "up"
            ? "bg-emerald-700 text-white"
            : "bg-stone-800 text-stone-400 hover:bg-stone-700 disabled:opacity-40"
        }`}
      >
        👍
      </button>
      <button
        type="button"
        onClick={() => onFeedback(messageId, "down")}
        disabled={disabled}
        aria-pressed={value === "down"}
        data-testid="feedback-down"
        className={`rounded px-2 py-0.5 text-xs transition-colors ${
          value === "down"
            ? "bg-red-700 text-white"
            : "bg-stone-800 text-stone-400 hover:bg-stone-700 disabled:opacity-40"
        }`}
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
      className={`rounded-md border px-3 py-2 text-sm ${copy.tone}`}
      role="alert"
      data-testid={`error-bubble-${code}`}
    >
      <span className="block font-mono text-[0.65rem] uppercase tracking-wider opacity-70">
        {code}
      </span>
      <span className="block mt-1">{copy.body}</span>
      {copy.cta ? <div className="mt-2">{copy.cta}</div> : null}
    </div>
  );
}

function errorCopy(
  code: EinsteinErrorCode,
  serverMessage: string,
  resetLabel?: string,
): {
  readonly tone: string;
  readonly body: string;
  readonly cta?: React.ReactNode;
} {
  switch (code) {
    case "EINSTEIN_TIER_LOCKED":
      return {
        tone: "border-amber-700 bg-amber-950/40 text-amber-100",
        body: "This feature is available on the Advanced plan.",
        cta: (
          <a
            href="/subscription"
            className="inline-block rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-stone-950 hover:bg-amber-500"
            data-testid="upgrade-cta"
          >
            Upgrade plan
          </a>
        ),
      };
    case "EINSTEIN_BUDGET_EXHAUSTED":
      return {
        tone: "border-stone-700 bg-stone-900/60 text-stone-200",
        body: resetLabel
          ? `You've reached this month's usage cap. It resets on ${resetLabel}.`
          : "You've reached this month's usage cap. It resets at the start of next month.",
      };
    case "EINSTEIN_CITATION_FABRICATION":
      return {
        tone: "border-red-800 bg-red-950/40 text-red-100",
        body:
          "The assistant produced an answer that couldn't be verified against your farm records. Try rephrasing, or ask about a specific camp, animal, or date range.",
      };
    case "EINSTEIN_RATE_LIMITED":
      return {
        tone: "border-stone-700 bg-stone-900/60 text-stone-200",
        body:
          "Too many requests in the last few minutes — please wait and try again.",
      };
    case "EINSTEIN_INTERNAL_ERROR":
    default:
      return {
        tone: "border-red-800 bg-red-950/40 text-red-100",
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
