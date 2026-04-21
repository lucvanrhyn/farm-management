"use client";

/**
 * AiSettingsForm — rename, response language, and monthly budget cap.
 *
 * Paid-tier gate is enforced server-side; the `disabled` prop greys the
 * form for Basic so they see what Advanced unlocks. Consulting hides the
 * budget input because the tier is budget-exempt.
 */

import { useCallback, useState } from "react";
import {
  ASSISTANT_NAME_MAX_LEN,
  ASSISTANT_NAME_REGEX,
  BUDGET_CAP_MAX_ZAR,
  BUDGET_CAP_MIN_ZAR,
  type ResponseLanguage,
} from "@/lib/einstein/settings-schema";
import { DEFAULT_ASSISTANT_NAME } from "@/lib/einstein/defaults";

export interface AiSettingsFormProps {
  readonly farmSlug: string;
  readonly initialAssistantName: string;
  readonly initialLanguage: ResponseLanguage;
  readonly initialBudgetCapZar: number;
  /** True when the tenant is Consulting — hides the budget input. */
  readonly budgetExempt: boolean;
  readonly disabled?: boolean;
}

interface SaveState {
  readonly status: "idle" | "saving" | "saved" | "error";
  readonly message?: string;
}

const LANGUAGE_OPTIONS: ReadonlyArray<{
  readonly value: ResponseLanguage;
  readonly label: string;
  readonly hint: string;
}> = [
  { value: "auto", label: "Match my question", hint: "Reply in whichever language I ask in." },
  { value: "en", label: "English", hint: "Always reply in English." },
  { value: "af", label: "Afrikaans", hint: "Altyd in Afrikaans antwoord." },
];

export default function AiSettingsForm({
  farmSlug,
  initialAssistantName,
  initialLanguage,
  initialBudgetCapZar,
  budgetExempt,
  disabled = false,
}: AiSettingsFormProps) {
  const [nameInput, setNameInput] = useState<string>(
    // Blank input if the farmer hasn't picked a name yet (display name falls
    // back to "Einstein"). If they HAVE picked one, prefill it.
    initialAssistantName === DEFAULT_ASSISTANT_NAME ? "" : initialAssistantName,
  );
  const [language, setLanguage] = useState<ResponseLanguage>(initialLanguage);
  const [budget, setBudget] = useState<string>(() => String(initialBudgetCapZar));
  const [save, setSave] = useState<SaveState>({ status: "idle" });

  const nameValid = (() => {
    const trimmed = nameInput.trim();
    if (trimmed.length === 0) return true; // empty = reset
    if (trimmed.length > ASSISTANT_NAME_MAX_LEN) return false;
    return ASSISTANT_NAME_REGEX.test(trimmed);
  })();

  const budgetValid = (() => {
    if (budgetExempt) return true;
    const n = Number(budget);
    if (!Number.isFinite(n)) return false;
    return n >= BUDGET_CAP_MIN_ZAR && n <= BUDGET_CAP_MAX_ZAR;
  })();

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (disabled) return;
      if (!nameValid || !budgetValid) {
        setSave({
          status: "error",
          message: !nameValid
            ? `Name must be 1–${ASSISTANT_NAME_MAX_LEN} letters, numbers, spaces, . ' or -`
            : `Budget must be between R${BUDGET_CAP_MIN_ZAR} and R${BUDGET_CAP_MAX_ZAR}`,
        });
        return;
      }
      setSave({ status: "saving" });
      try {
        const payload: Record<string, unknown> = {
          assistantName: nameInput.trim(),
          responseLanguage: language,
        };
        if (!budgetExempt) {
          payload.budgetCapZarPerMonth = Number(budget);
        }
        const response = await fetch(`/api/${farmSlug}/farm-settings/ai`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          let message = "Save failed";
          try {
            const body = (await response.json()) as {
              error?: string;
              message?: string;
            };
            message = body.message ?? body.error ?? message;
          } catch {
            /* non-JSON — keep default */
          }
          setSave({ status: "error", message });
          return;
        }
        setSave({
          status: "saved",
          message: "Saved — refresh to see the new name everywhere.",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Network error";
        setSave({ status: "error", message });
      }
    },
    [
      disabled,
      farmSlug,
      nameInput,
      language,
      budget,
      nameValid,
      budgetValid,
      budgetExempt,
    ],
  );

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-5 rounded-xl p-5"
      style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
      data-testid="ai-settings-form"
    >
      {/* Rename ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1">
        <label
          htmlFor="ai-assistant-name"
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: "#6B5E50" }}
        >
          Assistant name
        </label>
        <input
          id="ai-assistant-name"
          type="text"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          placeholder={DEFAULT_ASSISTANT_NAME}
          maxLength={ASSISTANT_NAME_MAX_LEN + 8 /* generous, server re-validates */}
          disabled={disabled}
          className="rounded-md border px-3 py-2 text-sm disabled:bg-stone-100 disabled:cursor-not-allowed"
          style={{
            borderColor: nameValid ? "#E0D5C8" : "#B23B3B",
            color: "#1C1815",
          }}
          data-testid="assistant-name-input"
        />
        <p className="text-[11px]" style={{ color: "#9C8E7A" }}>
          Rename Einstein — e.g. "Oupa", "Boerkloof". Leave blank to reset. Up
          to {ASSISTANT_NAME_MAX_LEN} characters; letters, numbers, spaces, .
          ' and - only.
        </p>
      </div>

      {/* Response language ──────────────────────────────────────────────── */}
      <fieldset className="flex flex-col gap-2" disabled={disabled}>
        <legend
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: "#6B5E50" }}
        >
          Response language
        </legend>
        {LANGUAGE_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className="flex items-start gap-2 text-sm cursor-pointer"
            style={{ color: "#1C1815" }}
          >
            <input
              type="radio"
              name="ai-response-language"
              value={opt.value}
              checked={language === opt.value}
              onChange={() => setLanguage(opt.value)}
              className="mt-1"
            />
            <span>
              <span className="font-medium">{opt.label}</span>
              <span className="block text-[11px]" style={{ color: "#9C8E7A" }}>
                {opt.hint}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {/* Budget cap ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1">
        <label
          htmlFor="ai-budget-cap"
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: "#6B5E50" }}
        >
          Monthly budget cap (ZAR)
        </label>
        {budgetExempt ? (
          <p
            className="rounded-md px-3 py-2 text-sm"
            style={{ background: "#F5F0EA", color: "#3A6B49" }}
            data-testid="budget-unlimited"
          >
            Unlimited on your Consulting plan.
          </p>
        ) : (
          <>
            <input
              id="ai-budget-cap"
              type="number"
              min={BUDGET_CAP_MIN_ZAR}
              max={BUDGET_CAP_MAX_ZAR}
              step={10}
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              disabled={disabled}
              className="rounded-md border px-3 py-2 text-sm disabled:bg-stone-100 disabled:cursor-not-allowed"
              style={{
                borderColor: budgetValid ? "#E0D5C8" : "#B23B3B",
                color: "#1C1815",
              }}
              data-testid="budget-cap-input"
            />
            <p className="text-[11px]" style={{ color: "#9C8E7A" }}>
              Hard stop at this many Rand per month. Default is R100 — roughly
              300 questions. Range: R{BUDGET_CAP_MIN_ZAR}–R{BUDGET_CAP_MAX_ZAR}.
            </p>
          </>
        )}
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={disabled || save.status === "saving" || !nameValid || !budgetValid}
          className="rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background: "#8B6914",
            color: "#F5EBD4",
          }}
          data-testid="ai-settings-save"
        >
          {save.status === "saving" ? "Saving…" : "Save settings"}
        </button>
        {save.status === "saved" ? (
          <span className="text-sm" style={{ color: "#3A6B49" }}>
            ✓ {save.message}
          </span>
        ) : null}
        {save.status === "error" ? (
          <span className="text-sm" style={{ color: "#B23B3B" }}>
            {save.message ?? "Save failed"}
          </span>
        ) : null}
      </div>
    </form>
  );
}
