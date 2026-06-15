// lib/server/nudges/narrate.ts — deterministic OFFLINE "why now" prose for nudges.
//
// Proactive Nudges v1 (#nudges) — decision 9. Built on the shared narration
// primitives (lib/server/narration/templated-fallback.ts), mirroring
// triage/narrate.ts. PURE + TOTAL: same DoNextItem → same string, no I/O, no
// clock read. An online Einstein one-liner is OPTIONAL at the call site and
// degrades to this string on no-key / error. The action target + label are
// engine-derived — the LLM never chooses them.

import type { DoNextItem } from "./feed";

/**
 * One-line "why now + what to do" for a nudge. Leads with urgency by severity,
 * restates the alert's own message (the "why"), then the recommended next step
 * (the action label), and the deadline when one is present.
 */
export function narrateNudge(item: DoNextItem): string {
  const lead = item.severity === "red" ? "Do now" : "Do soon";
  const parts = [`${lead}: ${item.message}.`];
  if (item.dueDate) {
    parts.push(`Due ${item.dueDate}.`);
  }
  if (item.action.label) {
    parts.push(`Next step: ${item.action.label}.`);
  }
  return parts.join(" ");
}
