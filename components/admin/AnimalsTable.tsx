"use client";

import {
  useState,
  useMemo,
  useDeferredValue,
  useCallback,
  useEffect,
} from "react";
import Link from "next/link";
import { getCategoryLabel, getAnimalAge } from "@/lib/utils";
import { formatNumber } from "@/lib/format/locale";
import type { AnimalCategory, AnimalStatus, Camp, Mob, PrismaAnimal } from "@/lib/types";
import AnimalActions from "@/components/admin/finansies/AnimalActions";
import { Pill, Kbd, Icon, Spark } from "@/components/ds";
import { useFarmModeSafe } from "@/lib/farm-mode";
import { getSpeciesModule, isValidSpecies } from "@/lib/species/registry";
import { useResyncOnPropChange } from "@/lib/client/use-resync-on-prop-change";

const PAGE_SIZE = 50;

// Grid column templates for the catalogue table (desk_2.jpg). The Active grid
// is the 9-column reference layout (ID · TYPE · SEX · CAMP · WEIGHT · ADG ·
// STATUS/FLAGS · ADG TREND · chevron); Deceased keeps a leaner 6-column grid.
const ACTIVE_COLS =
  "minmax(110px,1.2fr) 84px 48px 80px 90px 72px minmax(150px,1.5fr) 110px 40px";
const DECEASED_COLS = "minmax(110px,1.2fr) 84px 48px 90px minmax(120px,1fr) 130px";

// [sortKey, label, textAlign]. Empty key = non-sortable (chevron) column.
type HeaderCol = [string, string, ("left" | "right" | "center")?];
const ACTIVE_HEADERS: HeaderCol[] = [
  ["animalId", "ID"],
  ["category", "Type"],
  ["sex", "Sex"],
  ["currentCamp", "Camp"],
  ["", "Weight"],
  ["", "ADG"],
  ["status", "Status / flags"],
  ["", "ADG trend"],
  ["", ""],
];
const DECEASED_HEADERS: HeaderCol[] = [
  ["animalId", "ID"],
  ["category", "Type"],
  ["sex", "Sex"],
  ["dateOfBirth", "Age"],
  ["currentCamp", "Last camp"],
  ["deceasedAt", "Deceased on"],
];

/**
 * Real per-animal weight/ADG facts the catalogue table renders. Sourced from
 * `getAnimalWeightSummaries` (one batched weighing read, grouped server-side)
 * and serialized to a plain record keyed by `animalId`. An animal with no
 * weighing history is simply absent from `weightById`, so the row renders an
 * honest "—" — these numbers are never fabricated.
 */
export interface AnimalWeightInfo {
  /** kg of the latest weighing, or null when never weighed. */
  weight: number | null;
  /** Best available ADG (kg/day), or null when fewer than 2 weighings. */
  adg: number | null;
  /** true when `adg` sits below the farm's poor-doer threshold. */
  isPoorDoer: boolean;
  /** Chronological weight readings (kg) for the inline sparkline. */
  series: number[];
}

interface Props {
  animals: PrismaAnimal[];
  camps: Camp[];
  farmSlug: string;
  withdrawalIds?: Set<string>;
  mobs?: Mob[];
  /**
   * Real WEIGHT / ADG / ADG-trend per animal, keyed by `animalId`. Covers the
   * SSR-hydrated batch; rows streamed in via "Load more" (which the /api/animals
   * endpoint serves without weight history) fall back to "—". Never fabricated.
   */
  weightById?: Record<string, AnimalWeightInfo>;
  /** Farm's poor-doer ADG threshold (kg/day) — colours the ADG cell crit below it. */
  poorDoerThreshold?: number;
  /**
   * Cursor (`animalId`) pointing at the first row *past* the SSR-hydrated
   * batch. When null, there are no more rows to load. Optional so callers
   * that haven't been migrated to cursor pagination yet still compile.
   */
  initialNextCursor?: string | null;
  /**
   * Species filter already applied server-side. Forwarded to /api/animals so
   * the "Load more" fetch returns the same-species batch.
   */
  species?: string;
  /**
   * Total Active rows for the current species mode (server-side count). The
   * header reads "Showing {loaded} of {speciesTotal} {species}" and the
   * denominator stays stable as Load more streams batches in. Issue #205.
   */
  speciesTotal?: number;
  /**
   * Total Active rows across ALL species on the farm. Only used to surface
   * a reconciliation line ("X total Active across species") when the
   * tenant has animals outside the current species mode — otherwise a
   * cattle-only-mode farm with 81 cattle + 20 other-species Active rows
   * would render "Showing 50 of 81" with no hint of the 20 missing rows.
   * Sourced from `getCachedFarmSummary().animalCount`. Issue #205.
   */
  crossSpeciesActiveTotal?: number;
  /**
   * Total Deceased rows for the current species mode (server-side count).
   * Issue #255 — drives the Deceased tab badge so the count is accurate
   * BEFORE the user clicks the tab and triggers the deceased-rows fetch.
   * Pre-#255 the badge derived from a client-side filter over a hydrated
   * array that contained zero deceased rows (because SSR injected
   * status: "Active"), so the badge always read "0" — which is what made
   * BB-C013 invisible after death.
   */
  deceasedTotal?: number;
}

// Camp / status filters stay as styled native selects (the brief keeps these
// as selects; only the category filter becomes a retro chip row). Tokenised
// surface + border + accent focus ring.
const farmSelect =
  "rounded-[var(--ft-r-sm)] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--ft-accent)]";

/** Retro category filter chip — uppercase mono. Active = filled accent. */
function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="ft-mono"
      style={{
        padding: "5px 12px",
        borderRadius: "var(--ft-r-sm)",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: ".05em",
        textTransform: "uppercase",
        cursor: "pointer",
        whiteSpace: "nowrap",
        border: active ? "1px solid var(--ft-accent)" : "1px solid var(--ft-border2)",
        background: active ? "var(--ft-accent)" : "var(--ft-surface)",
        color: active ? "#FFF6EE" : "var(--ft-muted)",
        transition: "background .15s ease, color .15s ease, border-color .15s ease",
      }}
    >
      {label}
    </button>
  );
}

export default function AnimalsTable({
  animals: initialAnimals,
  camps,
  farmSlug,
  withdrawalIds,
  mobs,
  weightById,
  poorDoerThreshold = 0.7,
  initialNextCursor,
  species,
  speciesTotal,
  crossSpeciesActiveTotal,
  deceasedTotal,
}: Props) {
  const { mode } = useFarmModeSafe();
  const [tab, setTab] = useState<"active" | "deceased">("active");
  const [search, setSearch] = useState("");
  const [campFilter, setCampFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortKey, setSortKey] = useState<string>("animalId");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);

  // Streaming animals state: SSR hands us the first PAGE_SIZE rows plus a
  // `nextCursor` (or null when the tenant has fewer than PAGE_SIZE). The
  // `loadMore` handler appends subsequent pages from /api/animals and
  // advances the cursor.
  //
  // Issue #456 — keyed on the `species` prop. Flipping the ModeSwitcher calls
  // `router.refresh()`, which re-renders the page Server Component with fresh
  // `initialAnimals` / `initialNextCursor` props but does NOT remount this
  // component. A plain `useState(initialAnimals)` lazy initializer only reads
  // the prop at mount, so the table body kept rendering the PRIOR species'
  // rows while the prop-driven header count updated. `useResyncOnPropChange`
  // re-seeds these back to the fresh props the moment `species` changes —
  // React's "adjusting state on a prop change" recipe, same pattern as the
  // `lastFarmSlug` sentinel in `lib/farm-mode.tsx`.
  const [animals, setAnimals] = useResyncOnPropChange<PrismaAnimal[]>(
    species,
    () => initialAnimals,
  );
  const [nextCursor, setNextCursor] = useResyncOnPropChange<string | null>(
    species,
    () => initialNextCursor ?? null,
  );
  const [loadingMore, setLoadingMore] = useState(false);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const url = new URL("/api/animals", window.location.origin);
      url.searchParams.set("limit", String(PAGE_SIZE));
      url.searchParams.set("cursor", nextCursor);
      if (species) url.searchParams.set("species", species);
      // Issue #255 — catalogue table must include deceased rows so the
      // Deceased tab and tag-search surface the full mortality history.
      // The /api/animals route reads `?status=all` to opt out of the
      // status:Active default, which is the wire-equivalent of
      // `searchAnimals({ includeDeceased: true })`.
      url.searchParams.set("status", "all");
      const res = await fetch(url.pathname + url.search);
      if (!res.ok) return;
      const data = (await res.json()) as {
        items: PrismaAnimal[];
        nextCursor: string | null;
        hasMore: boolean;
      };
      setAnimals((prev) => [...prev, ...data.items]);
      setNextCursor(data.hasMore ? data.nextCursor : null);
    } finally {
      setLoadingMore(false);
    }
    // `setAnimals` / `setNextCursor` are the React `useState` dispatch
    // functions returned by `useResyncOnPropChange`, so their identity is
    // stable across renders — listing them keeps `exhaustive-deps` satisfied
    // now that they no longer come from a literal `useState` call the rule can
    // special-case as stable.
  }, [nextCursor, loadingMore, species, setAnimals, setNextCursor]);

  // Precompute a lowercase search index so we don't call toLowerCase() on
  // every animal on every keystroke. Keyed off `animals`/`camps`/`mobs`.
  // The index also covers camp (id + name) and mob name so the redesigned
  // "Search by ID, camp, mob…" placeholder is truthful — typing a camp or mob
  // name filters the loaded roster, not just animal ID / name.
  const indexed = useMemo(() => {
    const campNameById = new Map(camps.map((c) => [c.camp_id, c.camp_name]));
    const mobNameById = new Map((mobs ?? []).map((m) => [m.id, m.name]));
    return animals.map((a) => ({
      animal: a,
      idLower: a.animalId.toLowerCase(),
      nameLower: (a.name ?? "").toLowerCase(),
      campLower: `${a.currentCamp ?? ""} ${campNameById.get(a.currentCamp ?? "") ?? ""}`.toLowerCase(),
      mobLower: (a.mobId ? mobNameById.get(a.mobId) ?? "" : "").toLowerCase(),
    }));
  }, [animals, camps, mobs]);
  const activeAnimals = useMemo(
    () => indexed.filter((e) => e.animal.status !== "Deceased"),
    [indexed],
  );
  const deceasedAnimals = useMemo(
    () => indexed.filter((e) => e.animal.status === "Deceased"),
    [indexed],
  );

  // Defer the search query so the input stays responsive under large lists.
  const deferredSearch = useDeferredValue(search);

  // Issue #425 — remote search fallback. When the local subset returns zero
  // matches AND the herd has more rows than are currently loaded, we fire
  // `/api/animals?search=<q>` and render those rows in the same table. The
  // local fast-path is preserved: queries that match within `animals` never
  // hit the network. `remoteFor` pins which query produced `remoteResults`
  // so stale rows can't leak when the user keeps typing.
  //
  // Issue #456 — also keyed on `species` so a full-herd search result for the
  // prior species is cleared on a ModeSwitcher flip; otherwise a remote
  // payload fetched under (e.g.) `species=cattle` could flash into the sheep
  // catalogue before the effect below re-fires.
  const [remoteResults, setRemoteResults] = useResyncOnPropChange<
    PrismaAnimal[] | null
  >(species, () => null);
  const [remoteFor, setRemoteFor] = useResyncOnPropChange<string>(
    species,
    () => "",
  );
  const [remoteSearching, setRemoteSearching] = useState(false);

  const localFiltered = useMemo(() => {
    const source = tab === "deceased" ? deceasedAnimals : activeAnimals;
    const q = deferredSearch.toLowerCase();
    return source
      .filter(({ animal: a, idLower, nameLower, campLower, mobLower }) => {
        if (
          q &&
          !idLower.includes(q) &&
          !nameLower.includes(q) &&
          !campLower.includes(q) &&
          !mobLower.includes(q)
        )
          return false;
        if (campFilter !== "all" && a.currentCamp !== campFilter) return false;
        if (categoryFilter !== "all" && a.category !== categoryFilter) return false;
        if (tab === "active" && statusFilter !== "all" && a.status !== statusFilter) return false;
        return true;
      })
      .map((e) => e.animal)
      .sort((a, b) => {
        const av = String((a as unknown as Record<string, unknown>)[sortKey] ?? "");
        const bv = String((b as unknown as Record<string, unknown>)[sortKey] ?? "");
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      });
  }, [tab, activeAnimals, deceasedAnimals, deferredSearch, campFilter, categoryFilter, statusFilter, sortKey, sortDir]);

  // Trigger the remote fallback when (a) the user has typed something, (b)
  // the local subset returned zero matches for that query, (c) there's more
  // herd off-screen than what's hydrated, and (d) we haven't already
  // fetched for this exact query. Keyed on `deferredSearch` so we don't
  // hammer the API on every keystroke — `useDeferredValue` already low-pri
  // batches the input.
  const totalForSpecies =
    typeof speciesTotal === "number" ? speciesTotal : animals.length;
  const hasUnloadedRows = animals.length < totalForSpecies;
  const trimmedSearch = deferredSearch.trim();

  useEffect(() => {
    // Reset stale remote results the moment the local subset can answer the
    // query, or when the query is cleared / filtered away.
    if (!trimmedSearch || localFiltered.length > 0 || !hasUnloadedRows) {
      if (remoteResults !== null) {
        setRemoteResults(null);
        setRemoteFor("");
      }
      return;
    }
    // Already fetched for this exact query — don't re-fire.
    if (remoteFor === trimmedSearch) return;

    let cancelled = false;
    setRemoteSearching(true);
    (async () => {
      try {
        const url = new URL("/api/animals", window.location.origin);
        url.searchParams.set("search", trimmedSearch);
        if (species) url.searchParams.set("species", species);
        url.searchParams.set("status", "all");
        url.searchParams.set("limit", String(PAGE_SIZE));
        const res = await fetch(url.pathname + url.search);
        if (!res.ok) {
          if (!cancelled) {
            setRemoteResults([]);
            setRemoteFor(trimmedSearch);
          }
          return;
        }
        const data = (await res.json()) as
          | PrismaAnimal[]
          | { items: PrismaAnimal[]; nextCursor: string | null; hasMore: boolean };
        const items = Array.isArray(data) ? data : data.items;
        if (!cancelled) {
          setRemoteResults(items);
          setRemoteFor(trimmedSearch);
        }
      } catch {
        if (!cancelled) {
          setRemoteResults([]);
          setRemoteFor(trimmedSearch);
        }
      } finally {
        if (!cancelled) setRemoteSearching(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // `remoteResults` / `remoteFor` are intentionally read-only signals
    // inside the effect; including them would re-fire the effect after each
    // setState.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmedSearch, localFiltered.length, hasUnloadedRows, species]);

  // The "Searched full herd" hint and the rendered list switch over to the
  // remote payload ONLY when (a) the fetch was for the current query, (b)
  // the local subset is still empty for that query. Otherwise we render the
  // local subset as before — that keeps the fast-path latency-free and
  // prevents stale remote rows from flashing in.
  const remoteIsApplicable =
    remoteResults !== null &&
    remoteFor !== "" &&
    remoteFor === trimmedSearch &&
    localFiltered.length === 0;

  const filtered = useMemo(() => {
    if (remoteIsApplicable && remoteResults) {
      // Apply the same camp/category/status filters to the remote payload so
      // the rendered set is still consistent with the active dropdowns.
      return remoteResults
        .filter((a) => {
          if (tab === "deceased" && a.status !== "Deceased") return false;
          if (tab === "active" && a.status === "Deceased") return false;
          if (campFilter !== "all" && a.currentCamp !== campFilter) return false;
          if (categoryFilter !== "all" && a.category !== categoryFilter) return false;
          if (tab === "active" && statusFilter !== "all" && a.status !== statusFilter) return false;
          return true;
        })
        .sort((a, b) => {
          const av = String((a as unknown as Record<string, unknown>)[sortKey] ?? "");
          const bv = String((b as unknown as Record<string, unknown>)[sortKey] ?? "");
          return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
        });
    }
    return localFiltered;
  }, [
    remoteIsApplicable,
    remoteResults,
    localFiltered,
    tab,
    campFilter,
    categoryFilter,
    statusFilter,
    sortKey,
    sortDir,
  ]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageData = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(1);
  }

  const SortIcon = ({ col }: { col: string }) => (
    <span className="ml-1 text-xs" style={{ opacity: 0.4 }}>
      {sortKey === col ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
    </span>
  );

  // Issue #323 — taxonomy must follow the explicit route contract, not the
  // ambient (localStorage/cookie-backed) FarmMode. /sheep/animals passes
  // species="sheep"; if we read `mode` here a stale "cattle" cookie made the
  // Sheep Catalogue show the cattle taxonomy. The route prop wins; ambient
  // `mode` is only the fallback when no (or an unknown) species is supplied.
  const taxonomySpecies =
    species && isValidSpecies(species) ? species : mode;
  const categories: AnimalCategory[] = getSpeciesModule(
    taxonomySpecies,
  ).config.categories.map((c) => c.value);

  // Issue #205 — header count text. SSR previously hard-coded `animals.length`
  // in page.tsx so the number never updated when Load more streamed the next
  // window. Lives in the client component now and reacts to `animals` state.
  //
  // `speciesTotal` is the server-side count of Active rows for the current
  // mode (e.g. 81 cattle). When omitted (caller hasn't migrated yet), we fall
  // back to the legacy "Showing first N" message.
  //
  // The reconciliation line surfaces the cross-species Active total when it
  // differs from the species total — a cattle-only-mode farm with 81 cattle
  // + 20 other-species Active rows reads
  //   Showing 50 of 81 cattle (101 total Active across species)
  // so the farmer can see the 20 non-cattle rows are accounted for, not lost.
  //
  // Issue #367 — the SSR batch is hydrated via `searchAnimals(...,
  // includeDeceased: true)` so the Deceased / All tabs have rows. That batch
  // therefore contains deceased animals. The header numerator must be scoped
  // to the SAME subset the "N found" label counts (`filtered`, derived from
  // `activeAnimals` / `deceasedAnimals`): otherwise the Active tab rendered
  // "Showing 50 of 874" (raw batch) next to "49 animals found" (active subset)
  // — two label scopes contradicting each other. Counting the tab-scoped
  // hydrated subset keeps both numbers in agreement.
  const loaded =
    tab === "deceased" ? deceasedAnimals.length : activeAnimals.length;
  const showReconciliation =
    typeof crossSpeciesActiveTotal === "number" &&
    typeof speciesTotal === "number" &&
    crossSpeciesActiveTotal !== speciesTotal;

  return (
    <div className="flex flex-col gap-4">
      {/* Header count line — issue #205 */}
      <p
        className="text-sm"
        style={{ color: "var(--ft-subtle)" }}
        data-testid="animals-header-count"
      >
        {typeof speciesTotal === "number" ? (
          <>
            Showing {formatNumber(loaded)} of{" "}
            {formatNumber(speciesTotal)}
            {species ? ` ${species}` : ""}
            {showReconciliation && (
              <>
                {" "}
                ({formatNumber(crossSpeciesActiveTotal!)} total Active
                across species)
              </>
            )}
          </>
        ) : (
          <>
            Showing first {formatNumber(loaded)} · scroll or Load more to
            see the rest
          </>
        )}
      </p>

      {/* Active / Deceased tabs — tokenised segmented control */}
      <div className="ft-segmented w-fit" role="tablist" aria-label="Animal lifecycle">
        {(["active", "deceased"] as const).map((t) => {
          // Issue #255 — Deceased badge prefers the SSR-provided
          // `deceasedTotal` (true count from the DB) and falls back to the
          // hydrated-array filter only if a caller hasn't migrated yet.
          // Active falls back to `speciesTotal` for the same reason.
          const count =
            t === "active"
              ? typeof speciesTotal === "number"
                ? speciesTotal
                : activeAnimals.length
              : typeof deceasedTotal === "number"
                ? deceasedTotal
                : deceasedAnimals.length;
          const isActive = tab === t;
          return (
            <button
              key={t}
              role="tab"
              aria-selected={isActive}
              className={isActive ? "active" : ""}
              onClick={() => { setTab(t); setPage(1); setSearch(""); setCampFilter("all"); setCategoryFilter("all"); setStatusFilter("all"); }}
            >
              {t === "active" ? "Active / Sold" : "Deceased"}
              <span className="ft-mono ft-tabnums" style={{ fontSize: 10.5, color: "var(--ft-subtle)" }}>
                {formatNumber(count)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search + category chips in ONE bar — mirrors desk_2.jpg: full-width
          search with ⌘K keycap, a hairline divider, then the category chip row
          (All + real species categories; active = filled accent). */}
      <div
        className="ft-card flex flex-col gap-2 sm:flex-row sm:items-center"
        style={{ padding: 4 }}
      >
        <div className="flex flex-1 items-center gap-2.5" style={{ padding: "8px 14px" }}>
          <span style={{ color: "var(--ft-muted)" }}><Icon.search size={16} /></span>
          <input
            type="text"
            placeholder="Search by ID, camp, mob…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="flex-1 bg-transparent text-sm focus:outline-none"
            style={{ color: "var(--ft-text)", border: 0 }}
          />
          <Kbd>⌘K</Kbd>
        </div>
        <div
          aria-hidden="true"
          className="hidden sm:block"
          style={{ width: 1, height: 24, background: "var(--ft-border)" }}
        />
        <div
          className="flex flex-wrap items-center gap-1.5"
          style={{ padding: "2px 6px 2px 2px" }}
          role="group"
          aria-label="Filter by category"
        >
          <FilterChip
            label="All"
            active={categoryFilter === "all"}
            onClick={() => { setCategoryFilter("all"); setPage(1); }}
          />
          {categories.map((c) => (
            <FilterChip
              key={c}
              label={getCategoryLabel(c)}
              active={categoryFilter === c}
              onClick={() => { setCategoryFilter(c); setPage(1); }}
            />
          ))}
        </div>
      </div>

      {/* Secondary filters (camp / status) + result count. Not in the frozen
          reference, which only shows the chip row — kept here as a slim row so
          real camp/status filtering isn't lost (decision: match spec, relocate
          extras — nothing dropped). */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={campFilter}
          onChange={(e) => { setCampFilter(e.target.value); setPage(1); }}
          className={farmSelect}
          style={{
            background: "var(--ft-surface)",
            border: "1px solid var(--ft-border)",
            color: "var(--ft-text)",
          }}
        >
          <option value="all">All Camps</option>
          {camps.map((c) => (
            <option key={c.camp_id} value={c.camp_id}>
              {c.camp_name}
            </option>
          ))}
        </select>
        {tab === "active" && (
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className={farmSelect}
            style={{
              background: "var(--ft-surface)",
              border: "1px solid var(--ft-border)",
              color: "var(--ft-text)",
            }}
          >
            <option value="all">All Statuses</option>
            {(["Active", "Sold"] as AnimalStatus[]).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        <span className="ml-auto text-sm self-center ft-mono" style={{ color: "var(--ft-subtle)" }}>
          {formatNumber(filtered.length)} animals found
        </span>
      </div>

      {/* Issue #425 — remote-fallback hint. Renders ONLY when we had to go
          past the hydrated batch to answer the search (or are mid-flight to
          do so). Local-match queries keep the row clean. */}
      {(remoteIsApplicable || (remoteSearching && trimmedSearch)) && (
        <p
          className="text-xs -mt-2 flex items-center gap-1.5"
          style={{ color: "var(--ft-fair)" }}
          data-testid="animals-remote-search-hint"
        >
          <span
            aria-hidden="true"
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ background: "var(--ft-fair)" }}
          />
          {remoteSearching && !remoteIsApplicable
            ? "Searching full herd…"
            : "Searched full herd — results include rows not yet loaded above."}
        </p>
      )}

      {/* Table — CSS-grid catalogue matching desk_2.jpg. Active columns:
          ID · TYPE · SEX · CAMP · WEIGHT · ADG · STATUS / FLAGS · ADG TREND ·
          chevron. Header row is mono/uppercase on --ft-surface2 with a 1.5px
          divider; rows carry a 1px border + row-hover. WEIGHT / ADG / trend are
          real (weightById); animals never weighed render "—". */}
      <div className="ft-card overflow-x-auto" style={{ padding: 0 }} role="table" aria-label="Animals">
        <div style={{ minWidth: tab === "active" ? 820 : 640 }}>
          {/* Header row */}
          <div
            role="row"
            className="ft-mono"
            style={{
              display: "grid",
              gridTemplateColumns: tab === "active" ? ACTIVE_COLS : DECEASED_COLS,
              padding: "12px 20px",
              background: "var(--ft-surface2)",
              borderBottom: "1.5px solid var(--ft-border)",
              fontSize: 10,
              letterSpacing: ".08em",
              color: "var(--ft-subtle)",
              textTransform: "uppercase",
              fontWeight: 600,
              alignItems: "center",
            }}
          >
            {(tab === "active" ? ACTIVE_HEADERS : DECEASED_HEADERS).map(([key, label, align]) => (
              <div
                key={key || label || "__chevron"}
                role="columnheader"
                onClick={() => key && toggleSort(key)}
                className={key ? "cursor-pointer select-none" : ""}
                style={{ textAlign: align ?? "left" }}
              >
                {label}
                {key && <SortIcon col={key} />}
              </div>
            ))}
          </div>

          {/* Empty state */}
          {pageData.length === 0 && (
            <div
              role="row"
              className="px-4 py-10 text-center text-sm"
              style={{ color: "var(--ft-subtle)" }}
            >
              No animals found.
            </div>
          )}

          {/* Data rows */}
          {pageData.map((animal, i) => {
            const w = weightById?.[animal.animalId];
            const adgLow = w?.adg != null && w.adg < poorDoerThreshold;
            return (
              <div
                key={animal.animalId}
                role="row"
                className="ft-row-hover transition-colors"
                style={{
                  display: "grid",
                  gridTemplateColumns: tab === "active" ? ACTIVE_COLS : DECEASED_COLS,
                  padding: "14px 20px",
                  borderBottom: i < pageData.length - 1 ? "1px solid var(--ft-border)" : 0,
                  alignItems: "center",
                  fontSize: 13,
                }}
              >
                {/* ID */}
                <div role="cell">
                  <Link
                    href={`/${farmSlug}/admin/animals/${animal.animalId}`}
                    className="ft-mono text-sm font-semibold transition-colors"
                    style={{ color: "var(--ft-text)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "var(--ft-accent)")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "var(--ft-text)")}
                  >
                    {animal.animalId}
                  </Link>
                </div>
                {/* TYPE */}
                <div role="cell">
                  <Pill tone="muted">{getCategoryLabel(animal.category)}</Pill>
                </div>
                {/* SEX */}
                <div role="cell" className="ft-mono text-sm" style={{ color: "var(--ft-muted)" }}>
                  {animal.sex === "Male" ? "M" : "F"}
                </div>
                {tab === "active" ? (
                  <>
                    {/* CAMP */}
                    <div role="cell">
                      <Link
                        href={`/${farmSlug}/dashboard/camp/${animal.currentCamp}`}
                        className="text-sm font-medium ft-mono transition-colors"
                        style={{ color: "var(--ft-muted)" }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--ft-accent)")}
                        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--ft-muted)")}
                      >
                        {animal.currentCamp}
                      </Link>
                    </div>
                    {/* WEIGHT */}
                    <div role="cell" className="ft-mono ft-tabnums text-sm" style={{ color: "var(--ft-text)" }}>
                      {w?.weight != null ? `${Math.round(w.weight)} kg` : <span style={{ color: "var(--ft-subtle)" }}>—</span>}
                    </div>
                    {/* ADG */}
                    <div
                      role="cell"
                      className="ft-mono ft-tabnums text-sm"
                      style={{ color: adgLow ? "var(--ft-crit)" : "var(--ft-text)" }}
                    >
                      {w?.adg != null ? w.adg.toFixed(2) : <span style={{ color: "var(--ft-subtle)" }}>—</span>}
                    </div>
                    {/* STATUS / FLAGS — stacked token pills. The lifecycle
                        status (real: Active/Sold) leads in a green tone that
                        visually mirrors the reference's "HEALTHY" pill, then any
                        real flags stack below it. We deliberately do NOT relabel
                        "Active" as "Healthy" — the Animal row carries no health
                        assessment, only lifecycle status + the derived Low-ADG /
                        in-withdrawal signals. */}
                    <div role="cell">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Pill tone={animal.status === "Active" ? "good" : "muted"}>
                          {animal.status}
                        </Pill>
                        {adgLow && <Pill tone="poor">Low ADG</Pill>}
                        {withdrawalIds?.has(animal.animalId) && (
                          <Pill tone="fair">In withdrawal</Pill>
                        )}
                      </span>
                    </div>
                    {/* ADG TREND — real weight-series sparkline (only when ≥2 reads) */}
                    <div role="cell">
                      {w && w.series.length >= 2 ? (
                        <Spark
                          values={w.series}
                          w={90}
                          h={26}
                          color={adgLow ? "var(--ft-crit)" : "var(--ft-good)"}
                        />
                      ) : (
                        <span className="text-sm" style={{ color: "var(--ft-subtle)" }}>—</span>
                      )}
                    </div>
                    {/* Row actions + chevron */}
                    <div role="cell">
                      <div className="flex items-center justify-end gap-1">
                        {animal.status === "Active" && (
                          <AnimalActions animalId={animal.animalId} campId={animal.currentCamp} variant="row" />
                        )}
                        <Link
                          href={`/${farmSlug}/admin/animals/${animal.animalId}`}
                          aria-label={`View ${animal.animalId}`}
                          className="shrink-0 transition-colors"
                          style={{ color: "var(--ft-subtle)" }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--ft-accent)")}
                          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--ft-subtle)")}
                        >
                          <Icon.chevron size={16} />
                        </Link>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    {/* AGE */}
                    <div role="cell" className="ft-mono text-sm" style={{ color: "var(--ft-subtle)" }}>
                      {getAnimalAge(animal.dateOfBirth ?? undefined)}
                    </div>
                    {/* LAST CAMP */}
                    <div role="cell" className="ft-mono text-sm" style={{ color: "var(--ft-muted)" }}>
                      {animal.currentCamp}
                    </div>
                    {/* DECEASED ON */}
                    <div role="cell" className="ft-mono text-sm" style={{ color: "var(--ft-crit)" }}>
                      {animal.deceasedAt ? new Date(animal.deceasedAt).toLocaleDateString("en-ZA") : "—"}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* In-page pagination (client-side slice of the already-hydrated
          batch) */}
      {totalPages > 1 && (
        <div className="flex items-center gap-2 justify-center">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="ft-btn disabled:opacity-30"
          >
            ← Previous
          </button>
          <span className="text-sm ft-mono ft-tabnums" style={{ color: "var(--ft-subtle)" }}>
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="ft-btn disabled:opacity-30"
          >
            Next →
          </button>
        </div>
      )}

      {/* Server-side "Load more" — fetches the next cursor window from
          /api/animals. Rendered only when the SSR page hinted there's more
          beyond the initial PAGE_SIZE rows. */}
      {nextCursor && (
        <div className="flex justify-center pt-2">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="ft-btn disabled:opacity-50"
          >
            {loadingMore ? "Loading…" : `Load more (${formatNumber(animals.length)} loaded)`}
          </button>
        </div>
      )}
    </div>
  );
}
