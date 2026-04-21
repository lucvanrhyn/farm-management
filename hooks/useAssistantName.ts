"use client";

/**
 * useAssistantName — tenant-scoped hook for Farm Einstein's display name.
 *
 * Wave 1 (Phase L) added `FarmSettings.aiSettings` as a JSON blob on the
 * tenant database; `aiSettings.assistantName` holds the per-farm wordmark a
 * farmer chose in Wave 3's settings editor (e.g. "Oupa", "Boerkloof"). This
 * hook surfaces that value to every Einstein surface without each caller
 * having to re-parse the blob or thread props through the tree.
 *
 * Contract:
 *   - Public API is parameterless: `const name = useAssistantName();`
 *   - Returns `DEFAULT_ASSISTANT_NAME` ("Einstein") when no provider is
 *     mounted or the stored name is unset/empty. This is the only place in
 *     the Einstein UI where the literal "Einstein" is allowed — every other
 *     surface MUST route through the hook so rename propagates.
 *   - Re-renders when the provider's `name` value changes (Wave 3's editor
 *     calls `PUT /api/farm-settings/ai` then updates the provider, which
 *     triggers re-render across all consumers).
 *
 * Session source:
 *   FarmTrack's existing tenant-scoped providers (FarmModeProvider,
 *   TierProvider) wrap `app/[farmSlug]/admin/layout.tsx`. Wave 3 will do the
 *   same with `<AssistantNameProvider>`, reading `aiSettings.assistantName`
 *   server-side and hydrating the provider with the initial value. Until
 *   Wave 3 integration lands, the hook safely returns the default so any
 *   Einstein component remains renderable in isolation (tests, Storybook,
 *   etc.).
 */

import {
  createContext,
  createElement,
  useContext,
  type ReactNode,
} from "react";

export const DEFAULT_ASSISTANT_NAME = "Einstein";

/**
 * Internal context value. Kept minimal — just the current name. A setter
 * isn't exposed here because renames go through the server (PUT
 * /api/farm-settings/ai) and then the layout re-renders with a new
 * initialName; local mutation would desync from the persisted state.
 */
interface AssistantNameContextValue {
  readonly name: string;
}

const AssistantNameContext = createContext<AssistantNameContextValue | null>(
  null,
);

interface AssistantNameProviderProps {
  /**
   * The tenant's configured assistant name. Falsy values (null, undefined,
   * empty string after trim) are normalized to the default so consumers
   * never have to defensive-check.
   */
  readonly name: string | null | undefined;
  readonly children: ReactNode;
}

/**
 * Provider used by tenant-scoped layouts (Wave 3 wires this into
 * `app/[farmSlug]/admin/layout.tsx`). Accepts the raw stored value and
 * normalizes it once so every consumer reads the same, non-empty string.
 */
export function AssistantNameProvider({
  name,
  children,
}: AssistantNameProviderProps) {
  const normalized = normalizeAssistantName(name);
  return createElement(
    AssistantNameContext.Provider,
    { value: { name: normalized } },
    children,
  );
}

/**
 * Returns the current tenant's assistant name, or `DEFAULT_ASSISTANT_NAME`
 * when used outside a provider.
 */
export function useAssistantName(): string {
  const ctx = useContext(AssistantNameContext);
  if (!ctx) return DEFAULT_ASSISTANT_NAME;
  return ctx.name;
}

/**
 * Normalize a stored assistant name. Treat whitespace-only strings as
 * "unset" so admins can't accidentally blank the wordmark by saving a
 * single space.
 *
 * Exported for use by server components that render the initial name
 * before hydration (e.g. SSR of the chat header wordmark).
 */
export function normalizeAssistantName(
  raw: string | null | undefined,
): string {
  if (typeof raw !== "string") return DEFAULT_ASSISTANT_NAME;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_ASSISTANT_NAME;
}
