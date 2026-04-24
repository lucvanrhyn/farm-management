"use client";

/**
 * AddAnimalToMobPicker
 * ────────────────────
 * Client-side paginated picker for the "add animal to mob" flow. The mobs
 * admin page used to SSR every active animal so MobsManager could filter a
 * client-side array in place — on trio-b that was 874 rows / ~120 KB JSON
 * shipped on every visit. Phase I.2 splits display from edit: the page only
 * SSRs mob membership, and this component fetches unassigned animals via
 * /api/animals?unassigned=1&limit=50&search=… whenever the picker is open.
 *
 * Behaviour:
 * - Debounces the search input (~250 ms) before firing a new request.
 * - Shows the first page of unassigned animals on open.
 * - Supports "Load more" via cursor pagination when hasMore is true.
 * - The caller owns the selected-IDs state because it also drives the
 *   submit button in MobsManager's modal; this component only reports
 *   selection changes.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface PickerAnimal {
  animalId: string;
  name: string | null;
  category: string;
  currentCamp: string;
}

interface Props {
  species: string | null | undefined;
  selectedIds: Set<string>;
  onToggle: (animalId: string) => void;
  campLabel: (campId: string) => string;
}

type PageResponse = {
  items: Array<{
    animalId: string;
    name: string | null;
    category: string;
    currentCamp: string;
  }>;
  nextCursor: string | null;
  hasMore: boolean;
};

const PAGE_LIMIT = 50;
const SEARCH_DEBOUNCE_MS = 250;

export default function AddAnimalToMobPicker({
  species,
  selectedIds,
  onToggle,
  campLabel,
}: Props) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [animals, setAnimals] = useState<PickerAnimal[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against race conditions when the user types fast and an older
  // request resolves after a newer one.
  const requestIdRef = useRef(0);

  // Debounce the search term. 250 ms is the usual sweet-spot for type-ahead.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const fetchPage = useCallback(
    async (opts: { cursor?: string | null; append: boolean; search: string }) => {
      const myId = ++requestIdRef.current;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("limit", String(PAGE_LIMIT));
        params.set("unassigned", "1");
        if (species) params.set("species", species);
        if (opts.search) params.set("search", opts.search);
        if (opts.cursor) params.set("cursor", opts.cursor);
        const res = await fetch(`/api/animals?${params.toString()}`);
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? "Failed to load animals");
        }
        const data = (await res.json()) as PageResponse;
        // Bail if a newer request has already fired.
        if (myId !== requestIdRef.current) return;
        setAnimals((prev) => (opts.append ? [...prev, ...data.items] : data.items));
        setCursor(data.nextCursor);
        setHasMore(data.hasMore);
      } catch (err) {
        if (myId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        if (myId === requestIdRef.current) setLoading(false);
      }
    },
    [species],
  );

  // Whenever the debounced search changes, reset to the first page.
  useEffect(() => {
    void fetchPage({ cursor: null, append: false, search: debouncedQuery });
  }, [debouncedQuery, fetchPage]);

  return (
    <div
      className="rounded-xl p-3"
      style={{ border: "1px solid #E0D5C8", background: "#FFFFFF" }}
    >
      <p className="text-xs font-semibold mb-2" style={{ color: "#9C8E7A" }}>
        Add animals (unassigned only)
      </p>
      <input
        type="text"
        placeholder="Search by ID or name..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded-lg px-3 py-1.5 text-sm mb-2 focus:outline-none focus:ring-1 focus:ring-[rgba(122,92,30,0.4)]"
        style={{
          background: "#FAFAF8",
          border: "1px solid #E0D5C8",
          color: "#1C1815",
        }}
      />
      {error && (
        <p className="text-xs mb-2" style={{ color: "#C0574C" }}>
          {error}
        </p>
      )}
      <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
        {animals.length === 0 && !loading && (
          <p className="text-xs py-2 text-center" style={{ color: "#9C8E7A" }}>
            No unassigned animals match.
          </p>
        )}
        {animals.map((a) => {
          const checked = selectedIds.has(a.animalId);
          return (
            <label
              key={a.animalId}
              className="flex items-center gap-2 px-2 py-1 rounded-lg cursor-pointer hover:bg-[rgba(122,92,30,0.05)]"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(a.animalId)}
                className="rounded"
              />
              <span className="text-sm font-mono" style={{ color: "#1C1815" }}>
                {a.animalId}
              </span>
              {a.name && (
                <span className="text-xs" style={{ color: "#9C8E7A" }}>
                  {a.name}
                </span>
              )}
              <span className="text-[10px] ml-auto" style={{ color: "#9C8E7A" }}>
                {a.category} - {campLabel(a.currentCamp)}
              </span>
            </label>
          );
        })}
      </div>
      {hasMore && (
        <button
          type="button"
          onClick={() =>
            void fetchPage({ cursor, append: true, search: debouncedQuery })
          }
          disabled={loading}
          className="mt-2 w-full px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
          style={{ border: "1px solid #E0D5C8", color: "#6B5C4E" }}
        >
          {loading ? "Loading..." : "Load more"}
        </button>
      )}
      {loading && animals.length === 0 && (
        <p className="text-xs py-2 text-center" style={{ color: "#9C8E7A" }}>
          Loading…
        </p>
      )}
    </div>
  );
}
