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
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from "react";
import Link from "next/link";
import { useAssistantName } from "@/hooks/useAssistantName";
import { Icon, StatusDot, Button, Pill } from "@/components/ds";
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

/**
 * A single prioritized item shown in the "Today's brief" card. `status` colours
 * the leading dot (poor/fair/info). `text` is the human-readable line.
 */
export interface EinsteinBriefItem {
  readonly status: BriefStatus;
  readonly text: string;
}

/** Brief-card statuses — a strict subset of the DS <StatusDot> palette. */
type BriefStatus = "poor" | "fair" | "good" | "critical" | "info";

/**
 * Imperative handle a parent can hold to drive the chat from outside the
 * component (e.g. the desktop advisor page's action-button row). `sendPrompt`
 * funnels straight into the same streaming send path the composer uses.
 */
export interface EinsteinChatHandle {
  sendPrompt: (prompt: string) => void;
}

export interface EinsteinChatProps {
  readonly farmSlug: string;
  readonly className?: string;
  /** Imperative handle exposing `sendPrompt` for external action triggers. */
  readonly controlsRef?: Ref<EinsteinChatHandle>;
  /** First name for the greeting line in the empty-state brief (optional). */
  readonly firstName?: string;
  /**
   * When provided (and the transcript is empty) the empty view renders the
   * rich "Today's brief" presentation — a greeting bubble, a status-dotted
   * brief card and suggested-prompt chips — instead of the plain prompt copy.
   * Used by the phone bottom-sheet (and any surface that wants the briefing
   * on open). Tapping a chip submits it through the existing send path.
   */
  readonly brief?: readonly EinsteinBriefItem[];
  /** Suggested-prompt chips shown under the brief / empty-state. */
  readonly suggestedPrompts?: readonly string[];
  /** Override the composer placeholder (defaults to `Ask {assistantName}…`). */
  readonly placeholder?: string;
  /**
   * Render the "Advisor" mode pill beside the composer. Visual mode indicator,
   * on by default — does not alter the send payload.
   */
  readonly advisorMode?: boolean;
  /** Hide the internal chat header (host surfaces that supply their own). */
  readonly hideHeader?: boolean;
  /**
   * Suppress the empty-state copy entirely. Used by the desktop advisor page,
   * which renders its own always-on brief card above the chat — the chat below
   * should show only the composer (and transcript once messages arrive), not a
   * duplicate "Ask …" prompt. Has no effect once messages exist.
   */
  readonly hideEmptyState?: boolean;
  /**
   * Drop the form's top hairline + padding so the composer reads as a free
   * standing rounded bar rather than a panel footer. Used by the desktop
   * advisor page where the composer sits directly on the page surface.
   */
  readonly bareComposer?: boolean;
  /**
   * Surface mode. `"dark"` (default) forces the dark token set used by the
   * Home modal / phone bottom-sheet. `"inherit"` drops the dark-surface scope
   * and the opaque background so the chat reads on whatever themed surface the
   * host renders into (the desktop advisor page lives on the light paper admin
   * surface — `desk_5` shows a cream composer, not a dark one).
   */
  readonly surface?: "dark" | "inherit";
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

export function EinsteinChat({
  farmSlug,
  className,
  controlsRef,
  firstName,
  brief,
  suggestedPrompts,
  placeholder,
  advisorMode = true,
  hideHeader = false,
  hideEmptyState = false,
  bareComposer = false,
  surface = "dark",
}: EinsteinChatProps) {
  const inheritSurface = surface === "inherit";
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

  const handleSend = useCallback(async (preset?: string) => {
    // `preset` lets suggested-prompt chips / brief action buttons drive the
    // EXACT same send path as the composer — they pass their text directly so
    // we don't depend on a race-y setInput()→read cycle. With no preset we read
    // the composer value as before.
    const question = (preset ?? input).trim();
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

  // Suggested-prompt chips + brief action buttons funnel through here so they
  // reuse the SAME streaming/citation/error pipeline as the composer.
  const sendPrompt = useCallback(
    (prompt: string) => {
      void handleSend(prompt);
    },
    [handleSend],
  );

  // Expose the send path to a parent (desktop action-button row) without
  // forking any chat logic — the parent just calls handle.sendPrompt(text).
  useImperativeHandle(controlsRef, () => ({ sendPrompt }), [sendPrompt]);

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

  const hasTranscript = messages.length > 0 || streaming || error !== null;

  return (
    <div
      className={`${inheritSurface ? "" : "dark-surface "}ft-scope flex flex-col h-full ${className ?? ""}`}
      data-testid="einstein-chat"
      style={{
        background: inheritSurface ? "transparent" : "var(--ft-bg)",
        color: "var(--ft-text)",
      }}
    >
      <EinsteinChatStyles />

      {/* Header — assistant wordmark (Fraunces) + mono online status.
          Host surfaces that render their own header pass hideHeader. */}
      {hideHeader ? null : (
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
      )}

      <div
        ref={scrollRef}
        className={
          bareComposer
            ? // Desktop advisor page: the brief card above is the empty-state, so
              // the transcript area fills the gap between the card and the
              // bottom-pinned composer (desk_5). Light side padding so message
              // bubbles align under the brief card; vertical padding only once
              // there is real transcript content to show.
              `ft-scrollbar flex-1 overflow-y-auto space-y-3${hasTranscript ? " px-1 py-3" : ""}`
            : "ft-scrollbar flex-1 overflow-y-auto px-5 py-5 space-y-3"
        }
        data-testid="einstein-transcript"
      >
        {messages.length === 0 && !streaming && !hideEmptyState ? (
          brief && brief.length > 0 ? (
            <BriefEmptyState
              firstName={firstName}
              brief={brief}
              suggestedPrompts={suggestedPrompts}
              onPrompt={sendPrompt}
            />
          ) : (
            <EmptyState assistantName={assistantName} />
          )
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
        className={bareComposer ? "" : "p-4"}
        onSubmit={(e) => {
          e.preventDefault();
          void handleSend();
        }}
        style={
          bareComposer
            ? undefined
            : { borderTop: "1px solid var(--ft-border)" }
        }
      >
        <label className="sr-only" htmlFor="einstein-input">
          Ask {assistantName}
        </label>
        <div
          className="flex items-center gap-2 py-1 pl-2 pr-1"
          style={{
            borderRadius: 999,
            background: "var(--ft-surface)",
            border: "1px solid var(--ft-border)",
          }}
        >
          {advisorMode ? (
            <span
              className="ft-mono flex shrink-0 items-center gap-1.5 self-center"
              data-testid="einstein-advisor-pill"
              aria-label="Advisor mode on"
              style={{
                borderRadius: 999,
                padding: "5px 9px",
                fontSize: 10,
                letterSpacing: ".08em",
                textTransform: "uppercase",
                background: "var(--ft-accent-faint)",
                color: "var(--ft-accent)",
                border: "1px solid color-mix(in oklab, var(--ft-accent) 30%, transparent)",
                whiteSpace: "nowrap",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: 999,
                  background: "var(--ft-accent)",
                }}
              />
              Advisor
            </span>
          ) : null}
          <textarea
            id="einstein-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder ?? `Ask ${assistantName}…`}
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
// Desktop advisor panel — title + always-on brief + action row + chat
// ---------------------------------------------------------------------------

/** One numbered brief line. `bold` entities are emphasised in the body copy. */
export interface AdvisorBriefItem {
  readonly text: string;
  /** Substrings of `text` to render bold (e.g. ["Camp H", "VR-014"]). */
  readonly bold?: readonly string[];
}

/** A preset action button on the desktop advisor page. */
export interface AdvisorAction {
  readonly label: string;
  /** Prompt sent to the chat when clicked (defaults to the label). */
  readonly prompt?: string;
}

export interface EinsteinAdvisorPanelProps {
  readonly farmSlug: string;
  readonly assistantName: string;
  readonly firstName?: string;
  /** Greeting line above the numbered brief. */
  readonly greeting?: string;
  readonly briefItems: readonly AdvisorBriefItem[];
  readonly actions: readonly AdvisorAction[];
}

/**
 * Desktop "AI Advisor" composition. Renders the always-on brief card and an
 * action-button row ABOVE the real <EinsteinChat>, wiring both into the chat's
 * existing send path via an imperative handle — no chat logic is forked.
 *
 * Client component (owns the handle ref + click handlers) so the server page
 * shell can render it directly without its own client island.
 */
export function EinsteinAdvisorPanel({
  farmSlug,
  assistantName,
  firstName,
  greeting,
  briefItems,
  actions,
}: EinsteinAdvisorPanelProps) {
  const chatRef = useRef<EinsteinChatHandle>(null);
  const greetLine =
    greeting ??
    `Good morning${firstName?.trim() ? ` ${firstName.trim()}` : ""}. Three things worth your attention before lunch:`;

  return (
    <div className="ft-scope flex h-full min-h-0 flex-col gap-4">
      {/* Title row — serif H1 36px + mono model pill + subtitle */}
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1
            className="ft-serif"
            data-testid="advisor-title"
            style={{
              fontSize: 36,
              fontWeight: 500,
              letterSpacing: "-0.02em",
              lineHeight: 1.05,
              margin: 0,
              color: "var(--ft-text)",
            }}
          >
            AI Advisor
          </h1>
          <Pill tone="muted" className="ft-mono">
            {assistantName.toUpperCase()} · CLAUDE 3.5
          </Pill>
        </div>
        <div
          className="ft-mono"
          style={{
            fontSize: 12,
            color: "var(--ft-muted)",
            marginTop: 6,
            letterSpacing: ".02em",
          }}
        >
          Ask anything about the farm
        </div>
      </div>

      {/* Always-on brief card (accent beam) — icon + EINSTEIN label, greeting,
          numbered list, and the action buttons INSIDE the card (desk_5). The
          accent beam runs on this single card only. */}
      <div className="ft-brief px-5 py-4" data-testid="advisor-brief">
        {/* header row — sun avatar + assistant-name label (mono, accent) */}
        <div className="flex items-center gap-2.5">
          <span
            className="flex shrink-0 items-center justify-center"
            aria-hidden="true"
            style={{
              width: 28,
              height: 28,
              borderRadius: "var(--ft-r-sm)",
              background: "var(--ft-accent-faint)",
              color: "var(--ft-accent)",
            }}
          >
            <Icon.einstein size={16} />
          </span>
          <span
            className="ft-mono"
            style={{
              fontSize: 10,
              letterSpacing: ".14em",
              textTransform: "uppercase",
              color: "var(--ft-accent)",
            }}
          >
            {assistantName}
          </span>
        </div>
        <p
          style={{
            fontSize: 14.5,
            lineHeight: 1.6,
            color: "var(--ft-text)",
            margin: "10px 0 10px",
          }}
        >
          {greetLine}
        </p>
        <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {briefItems.map((item, i) => (
            <li
              key={i}
              className="flex items-start gap-2.5"
              style={{ marginTop: i === 0 ? 0 : 8 }}
            >
              <span
                className="ft-mono shrink-0"
                aria-hidden="true"
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--ft-accent)",
                  lineHeight: 1.6,
                  minWidth: 16,
                }}
              >
                {i + 1}.
              </span>
              <span
                style={{ fontSize: 14.5, lineHeight: 1.6, color: "var(--ft-text)" }}
              >
                <BoldEntities text={item.text} bold={item.bold} />
              </span>
            </li>
          ))}
        </ol>

        {/* Action buttons — outline retro buttons, inside the card → seed the
            chat send path (desk_5 places these at the card's lower edge). */}
        <div
          className="flex flex-wrap gap-2"
          data-testid="advisor-actions"
          style={{ marginTop: 16 }}
        >
          {actions.map((a) => (
            <Button
              key={a.label}
              variant="default"
              className="ft-mono"
              onClick={() => chatRef.current?.sendPrompt(a.prompt ?? a.label)}
              style={{
                textTransform: "uppercase",
                letterSpacing: ".06em",
                fontSize: 11,
              }}
            >
              {a.label}
            </Button>
          ))}
        </div>
      </div>

      {/* The real chat panel — bare (no card frame): the transcript flows under
          the brief card and the composer reads as a free-standing rounded bar
          on the light paper admin surface (desk_5). Behaviour unchanged —
          streaming, citations, feedback all live in <EinsteinChat>. */}
      <div className="flex min-h-0 flex-1 flex-col">
        <EinsteinChat
          farmSlug={farmSlug}
          controlsRef={chatRef}
          placeholder="Ask about herd performance…"
          className="h-full"
          hideHeader
          hideEmptyState
          bareComposer
          surface="inherit"
        />
      </div>
    </div>
  );
}

/** Render `text` with each `bold` substring wrapped in <strong> (text colour). */
function BoldEntities({
  text,
  bold,
}: {
  text: string;
  bold?: readonly string[];
}) {
  if (!bold || bold.length === 0) return <>{text}</>;
  // Build a single alternation regex, escaping each entity. Longest-first so
  // overlapping entities (e.g. "Camp H" vs "H") match the more specific one.
  const ordered = [...bold].sort((a, b) => b.length - a.length);
  const escaped = ordered.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${escaped.join("|")})`, "g");
  const parts = text.split(re);
  return (
    <>
      {parts.map((part, i) =>
        ordered.includes(part) ? (
          <strong key={i} style={{ fontWeight: 600, color: "var(--ft-text)" }}>
            {part}
          </strong>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

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

const WEEKDAY = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/**
 * Rich empty-state (phone bottom-sheet + any briefing surface): a greeting
 * "bubble", a status-dotted brief card and tappable suggested-prompt chips.
 * Every chip funnels through `onPrompt` → the component's real send path, so
 * the streaming / citation / error pipeline is reused verbatim.
 *
 * Hygiene: the assistant name is threaded through (never hardcoded "Einstein")
 * so the rename editor propagates here too and the empty-state guard test
 * (no literal "Einstein" in the transcript) stays green.
 */
function BriefEmptyState({
  firstName,
  brief,
  suggestedPrompts,
  onPrompt,
}: {
  firstName?: string;
  brief: readonly EinsteinBriefItem[];
  suggestedPrompts?: readonly string[];
  onPrompt: (prompt: string) => void;
}) {
  const who = firstName?.trim() ? firstName.trim() : "there";
  const weekday = WEEKDAY[new Date().getDay()];

  return (
    <div className="space-y-3" data-testid="einstein-brief-empty">
      {/* greeting "bubble" — plain warm-surface card (phone_5) */}
      <div className="flex justify-start">
        <div
          className="ft-card max-w-[88%] px-3.5 py-2.5 text-sm"
          style={{
            background: "var(--ft-surface)",
            borderBottomLeftRadius: 5,
            color: "var(--ft-text)",
          }}
        >
          Morning, {who} — here&rsquo;s your brief for {weekday}.
        </div>
      </div>

      {/* brief card — plain warm-surface card (phone_5 shows no beam ring and
          no label here, just the coloured-dot priority lines). */}
      <div
        className="ft-card px-3.5 py-3"
        data-testid="einstein-brief-card"
        style={{ background: "var(--ft-surface)", color: "var(--ft-text)" }}
      >
        <ul className="space-y-2.5" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {brief.map((item, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <span className="mt-[5px] shrink-0">
                <BriefDot status={item.status} />
              </span>
              <span
                style={{
                  fontSize: 13.5,
                  lineHeight: 1.5,
                  color: "var(--ft-text)",
                }}
              >
                {item.text}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {suggestedPrompts && suggestedPrompts.length > 0 ? (
        <SuggestedChips prompts={suggestedPrompts} onPrompt={onPrompt} />
      ) : null}
    </div>
  );
}

/** info-aware dot: <StatusDot> has no "info"/"good" overlap with brief tones. */
function BriefDot({ status }: { status: BriefStatus }) {
  if (status === "info") {
    return (
      <span
        aria-hidden="true"
        style={{
          display: "inline-block",
          width: 8,
          height: 8,
          borderRadius: 999,
          background: "var(--ft-info)",
          boxShadow: "0 0 0 3px color-mix(in oklab, var(--ft-info) 15%, transparent)",
        }}
      />
    );
  }
  return <StatusDot status={status} />;
}

/**
 * Tappable suggested-prompt chips. Each chip submits its own text through the
 * shared send path (no composer round-trip), so the chat logic is never forked.
 */
function SuggestedChips({
  prompts,
  onPrompt,
}: {
  prompts: readonly string[];
  onPrompt: (prompt: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 pt-1" data-testid="einstein-suggested-chips">
      {prompts.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onPrompt(p)}
          className="ft-mono transition-colors"
          data-testid="einstein-suggested-chip"
          style={{
            borderRadius: 999,
            padding: "7px 12px",
            fontSize: 12,
            letterSpacing: ".01em",
            textTransform: "none",
            background: "var(--ft-surface)",
            color: "var(--ft-text)",
            border: "1px solid var(--ft-border2)",
          }}
        >
          {p}
        </button>
      ))}
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
