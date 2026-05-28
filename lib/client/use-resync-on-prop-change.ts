"use client";

import { useState, type Dispatch, type SetStateAction } from "react";

/**
 * useResyncOnPropChange — local state that re-syncs to a freshly-computed
 * value whenever a `trigger` prop changes.
 *
 * ## Problem
 * `const [x, setX] = useState(initialFromProp)` reads the prop ONLY at mount.
 * When the App Router re-renders a Server Component with fresh props but does
 * NOT remount the client component (e.g. after `router.refresh()` from a
 * ModeSwitcher flip), the lazy initializer never re-runs — so the local state
 * keeps the stale prop value while sibling prop-driven UI updates around it.
 * (Issue #456: AnimalsTable header count updated on species flip but the table
 * body kept rendering the prior species' rows.)
 *
 * ## Solution
 * React's official "adjusting some state when a prop changes" recipe
 * (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes):
 * keep the previous `trigger` in state, compare it during render, and
 * `setState` synchronously when it differs. React re-runs the component with
 * the updated state before painting, so the reset is transparent — no flash,
 * no `useEffect`, no `key={prop}` remount, no `useRef` mutation during render
 * (the latter is blocked by Next 16's lint rules). This mirrors the proven
 * `lastFarmSlug` sentinel in `lib/farm-mode.tsx` (FarmModeProvider) and the
 * memory note `feedback-react-state-from-props.md`.
 *
 * The returned tuple is API-compatible with `useState`: edits made through the
 * setter persist across re-renders that keep the same `trigger`, and are
 * discarded the moment the `trigger` changes (state resets to `compute()`).
 *
 * ## Usage
 * ```ts
 * // Reset the streamed batch back to the SSR-hydrated prop on species flip.
 * const [animals, setAnimals] = useResyncOnPropChange(species, () => initialAnimals);
 * ```
 *
 * @param trigger  The prop to watch. State resets when this changes
 *                 (compared with `Object.is`).
 * @param compute  Factory producing the value to (re)seed state with. Called
 *                 once at mount, then exactly once per `trigger` change. Read
 *                 the current props inside it so each reset picks up fresh
 *                 prop values.
 * @returns        A `[state, setState]` tuple, exactly like `useState`.
 */
export function useResyncOnPropChange<T>(
  trigger: unknown,
  compute: () => T,
): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<T>(compute);
  const [lastTrigger, setLastTrigger] = useState(trigger);

  // Adjust state during render when the trigger changes. React discards this
  // render's output and immediately re-renders with the updated state, so the
  // recomputed value is what actually commits — no extra paint, no effect.
  if (!Object.is(lastTrigger, trigger)) {
    setLastTrigger(trigger);
    setState(compute());
  }

  return [state, setState];
}
