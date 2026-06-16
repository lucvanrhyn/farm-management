/**
 * lib/server/briefing/narrator.ts — Weekly Farm Briefing v1 prose narrator.
 *
 * Turns the deterministic BriefingPayload into a short, warm prose intro for
 * the EMAIL. This is a ONE-SHOT Anthropic call (NOT streamAnswer — that's the
 * RAG Q&A path); it reuses the same lazy-client idiom as lib/einstein/answer.ts
 * (constructed locally; getAnthropicClient there is module-private).
 *
 * Two hard guarantees:
 *   1. GROUNDING — the model is fed ONLY the payload's already-true section
 *      lines and is told to summarise, never to invent facts beyond them. The
 *      payload is the source of truth (decision 4/5).
 *   2. MANDATORY FALLBACK — `narrateBriefing` NEVER throws and ALWAYS returns
 *      a string. With no ANTHROPIC_API_KEY, an over-budget tenant, or any API
 *      error, it returns `templatedBriefingNarration(payload)` — a pure
 *      projection of the payload built on the shared narration primitives —
 *      so a briefing ALWAYS renders (CI, local dev, trial tier, API outage).
 *
 * Budget: the SEND path (send-weekly-briefing.ts) owns the assertWithinBudget /
 * stamp / reconcile dance around this call — the narrator stays a thin,
 * fail-soft prose generator so the deterministic in-app card never touches it.
 */

import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_ANSWER_MODEL, DEFAULT_ASSISTANT_NAME } from "@/lib/einstein/defaults";
import { logger } from "@/lib/logger";
import { pluralize } from "@/lib/server/narration/templated-fallback";
import type { BriefingPayload } from "./payload";

/** Mirror of answer.ts's module-private lazy client — returns null (not throw)
 *  so the narrator can fall back to the template instead of erroring out. */
function getAnthropicClientOrNull(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

/**
 * Deterministic OFFLINE narration. PURE + TOTAL — built only from the
 * payload's section COUNTS (never the raw lines, to keep it short), so it
 * cannot drift from the source of truth or invent facts. This is the string
 * the email shows when the model is unreachable, and the unit-testable
 * contract that guarantees a briefing always renders.
 */
export function templatedBriefingNarration(
  payload: BriefingPayload,
  assistantName: string,
): string {
  const name = assistantName || DEFAULT_ASSISTANT_NAME;
  if (payload.isEmpty) {
    return `${name} here with the weekly briefing for ${payload.farmName}. Quiet week — no new alerts, nothing flagged to watch, and no actions on the shortlist. The herd is steady.`;
  }
  const parts: string[] = [];
  if (payload.whatChanged.length > 0) parts.push(`${pluralize(payload.whatChanged.length, "update")} on what changed`);
  if (payload.whatToWatch.length > 0) parts.push(`${pluralize(payload.whatToWatch.length, "item")} to watch`);
  if (payload.whatToDo.length > 0) parts.push(`${pluralize(payload.whatToDo.length, "recommended action")}`);
  return `${name} here with the weekly briefing for ${payload.farmName}. This week: ${joinAnd(parts)}. Details below.`;
}

/** Local Oxford-list join (kept minimal — the only shared narration primitive
 *  the offline path needs is pluralize). */
function joinAnd(parts: readonly string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

const SYSTEM_PROMPT = `You are a livestock farm AI assistant writing the opening paragraph of a South African farmer's WEEKLY briefing email.

RULES:
- Write 2-3 warm, plain-English sentences. No bullet points, no headings, no markdown.
- Summarise ONLY the facts in the briefing data provided. NEVER invent animals, numbers, events, or recommendations that are not in the data.
- The reader is a working farmer — be practical and direct, not flowery.
- Do not greet by the farmer's name (you don't have it). Do not sign off.
- Output ONLY the paragraph text, nothing else.`;

/** Serialise the payload sections as a compact data block for the model. */
function buildBriefingDataBlock(payload: BriefingPayload): string {
  const lines: string[] = [`Farm: ${payload.farmName}`];
  lines.push("WHAT CHANGED:");
  lines.push(...(payload.whatChanged.length ? payload.whatChanged.map((l) => `- ${l}`) : ["- (nothing)"]));
  lines.push("WHAT TO WATCH:");
  lines.push(...(payload.whatToWatch.length ? payload.whatToWatch.map((l) => `- ${l}`) : ["- (nothing)"]));
  lines.push("WHAT TO DO:");
  lines.push(...(payload.whatToDo.length ? payload.whatToDo.map((l) => `- ${l}`) : ["- (nothing)"]));
  return lines.join("\n");
}

/**
 * Generate the email's prose intro. ALWAYS returns a string; falls back to
 * `templatedBriefingNarration` on no-key / API error / empty model output.
 *
 * @param onUsage — optional callback invoked with the real token usage when
 *   the online path succeeds, so the send layer can reconcile the AI budget.
 */
export async function narrateBriefing(
  payload: BriefingPayload,
  assistantName: string,
  onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void,
): Promise<string> {
  const fallback = templatedBriefingNarration(payload, assistantName);

  const client = getAnthropicClientOrNull();
  if (!client) return fallback;

  try {
    const res = await client.messages.create({
      model: ANTHROPIC_ANSWER_MODEL,
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Write the weekly briefing intro from this data:\n\n${buildBriefingDataBlock(payload)}`,
        },
      ],
    });

    if (onUsage) {
      const u = res.usage as { input_tokens?: number; output_tokens?: number };
      onUsage({ inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0 });
    }

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    return text.length > 0 ? text : fallback;
  } catch (err) {
    // Fail-soft: a briefing must always render. Log loud, return the template.
    logger.warn("[briefing] narrateBriefing online call failed — using template", {
      err: err instanceof Error ? err.message : String(err),
    });
    return fallback;
  }
}
