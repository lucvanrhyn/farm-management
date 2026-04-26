"use client";

/**
 * AnimalPicker — Phase H
 * ──────────────────────
 *
 * Debounced typeahead used by the observation-create modal to target an
 * animal that may live outside the SSR-prefetched first 50 rows on the
 * `/admin/observations` page. Replaces the legacy `<select>` whose options
 * were limited to whatever the page hydrated.
 *
 * API contract:
 *   - Talks to `/api/animals?limit=20&search=<q>&species=<mode>[&camp=<id>]`.
 *   - Tenant scoping is enforced by the route via `getFarmContext()`; this
 *     component never sets a `farmSlug` query param — the proxy injects the
 *     signed identity tuple and the route binds prisma to that slug.
 *   - Empty query → no fetch (keeps the network quiet on mount + clear).
 *   - Search input is debounced ~250 ms.
 *   - A monotonic request-id guards against late-arriving stale responses.
 *
 * UI states: idle (untouched), loading, results, empty, error.
 */

import { useCallback, useEffect, useRef, useState } from "react";

interface PickerAnimal {
  animalId: string;
  name: string | null;
  category: string;
  currentCamp: string;
}

type PageResponse = {
  items: PickerAnimal[];
  nextCursor: string | null;
  hasMore: boolean;
};

interface Props {
  /** Species filter — typically the farm's current mode (cattle/sheep/game). */
  species: string | null | undefined;
  /** Currently selected animalId (controlled). Empty string == "no selection". */
  value: string;
  /** Called with the chosen animalId when the user clicks a result row. */
  onChange: (animalId: string) => void;
  /** Optional camp filter — used when the modal already has a camp selected. */
  campId?: string;
}

const PAGE_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 250;

const fieldInput: React.CSSProperties = {
  background: "#FFFFFF",
  border: "1px solid #E0D5C8",
  color: "#1C1815",
  borderRadius: "0.75rem",
  padding: "0.5rem 0.75rem",
  fontSize: "0.875rem",
  outline: "none",
  width: "100%",
};

export default function AnimalPicker({
  species,
  value,
  onChange,
  campId,
}: Props) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<PickerAnimal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const requestIdRef = useRef(0);

  // Debounce.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const fetchPage = useCallback(
    async (search: string) => {
      const myId = ++requestIdRef.current;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("limit", String(PAGE_LIMIT));
        params.set("search", search);
        if (species) params.set("species", species);
        if (campId) params.set("camp", campId);
        const res = await fetch(`/api/animals?${params.toString()}`);
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? "Failed to load animals");
        }
        const data = (await res.json()) as PageResponse;
        if (myId !== requestIdRef.current) return;
        setResults(data.items);
      } catch (err) {
        if (myId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : "Unknown error");
        setResults([]);
      } finally {
        if (myId === requestIdRef.current) setLoading(false);
      }
    },
    [species, campId],
  );

  // Empty query → no request. This prevents a spurious round-trip on mount
  // and on backspace-clear, which matters for the offline-first PWA.
  useEffect(() => {
    if (!debouncedQuery) {
      // Reset state so a previous result list doesn't linger after clear.
      setResults([]);
      setError(null);
      setHasSearched(false);
      return;
    }
    setHasSearched(true);
    void fetchPage(debouncedQuery);
  }, [debouncedQuery, fetchPage]);

  const showEmpty =
    !loading && hasSearched && results.length === 0 && !error;

  return (
    <div className="flex flex-col gap-2">
      <input
        type="text"
        placeholder={value ? `Selected: ${value} — type to change` : "Search by ID or name..."}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={fieldInput}
        className="block"
        aria-label="Search animals"
      />
      {error && (
        <p className="text-xs" style={{ color: "#C0574C" }} role="alert">
          {error}
        </p>
      )}
      {loading && (
        <p className="text-xs" style={{ color: "#9C8E7A" }}>
          Loading…
        </p>
      )}
      {showEmpty && (
        <p className="text-xs" style={{ color: "#9C8E7A" }}>
          No animals match.
        </p>
      )}
      {results.length > 0 && (
        <ul
          className="rounded-xl max-h-48 overflow-y-auto"
          style={{ border: "1px solid #E0D5C8", background: "#FFFFFF" }}
        >
          {results.map((a) => {
            const selected = a.animalId === value;
            return (
              <li key={a.animalId}>
                <button
                  type="button"
                  onClick={() => onChange(a.animalId)}
                  className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-[rgba(122,92,30,0.05)]"
                  style={{
                    background: selected ? "rgba(74,124,89,0.08)" : "transparent",
                    color: "#1C1815",
                  }}
                >
                  <span className="font-mono">{a.animalId}</span>
                  {a.name && (
                    <span className="text-xs" style={{ color: "#9C8E7A" }}>
                      {a.name}
                    </span>
                  )}
                  <span
                    className="text-[10px] ml-auto"
                    style={{ color: "#9C8E7A" }}
                  >
                    {a.category}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
