"use client";

import { useState, useMemo, useDeferredValue, useCallback } from "react";
import Link from "next/link";
import { getCategoryLabel, getCategoryChipColor, getAnimalAge } from "@/lib/utils";
import type { AnimalCategory, AnimalStatus, Camp, Mob, PrismaAnimal } from "@/lib/types";
import AnimalActions from "@/components/admin/finansies/AnimalActions";
import { useFarmModeSafe } from "@/lib/farm-mode";
import { getSpeciesModule } from "@/lib/species/registry";

const PAGE_SIZE = 50;

interface Props {
  animals: PrismaAnimal[];
  camps: Camp[];
  farmSlug: string;
  withdrawalIds?: Set<string>;
  mobs?: Mob[];
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

const farmInput =
  "rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[rgba(122,92,30,0.4)]";
const farmSelect =
  "rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[rgba(122,92,30,0.4)]";

export default function AnimalsTable({
  animals: initialAnimals,
  camps,
  farmSlug,
  withdrawalIds,
  mobs,
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
  const [animals, setAnimals] = useState<PrismaAnimal[]>(initialAnimals);
  const [nextCursor, setNextCursor] = useState<string | null>(
    initialNextCursor ?? null,
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
  }, [nextCursor, loadingMore, species]);

  // Precompute a lowercase search index so we don't call toLowerCase() on
  // every animal on every keystroke. Keyed off `animals` identity.
  const indexed = useMemo(
    () =>
      animals.map((a) => ({
        animal: a,
        idLower: a.animalId.toLowerCase(),
        nameLower: (a.name ?? "").toLowerCase(),
      })),
    [animals],
  );
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

  const filtered = useMemo(() => {
    const source = tab === "deceased" ? deceasedAnimals : activeAnimals;
    const q = deferredSearch.toLowerCase();
    return source
      .filter(({ animal: a, idLower, nameLower }) => {
        if (q && !idLower.includes(q) && !nameLower.includes(q)) return false;
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

  const mobMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const mob of mobs ?? []) m.set(mob.id, mob.name);
    return m;
  }, [mobs]);

  const categories: AnimalCategory[] = getSpeciesModule(mode).config.categories.map((c) => c.value);
  const statuses: AnimalStatus[] = ["Active", "Sold", "Deceased"];

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
  const loaded = animals.length;
  const showReconciliation =
    typeof crossSpeciesActiveTotal === "number" &&
    typeof speciesTotal === "number" &&
    crossSpeciesActiveTotal !== speciesTotal;

  return (
    <div className="flex flex-col gap-4">
      {/* Header count line — issue #205 */}
      <p
        className="text-sm"
        style={{ color: "#9C8E7A" }}
        data-testid="animals-header-count"
      >
        {typeof speciesTotal === "number" ? (
          <>
            Showing {loaded.toLocaleString()} of{" "}
            {speciesTotal.toLocaleString()}
            {species ? ` ${species}` : ""}
            {showReconciliation && (
              <>
                {" "}
                ({crossSpeciesActiveTotal!.toLocaleString()} total Active
                across species)
              </>
            )}
          </>
        ) : (
          <>
            Showing first {loaded.toLocaleString()} · scroll or Load more to
            see the rest
          </>
        )}
      </p>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl w-fit" style={{ background: "#F0EBE4" }}>
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
              onClick={() => { setTab(t); setPage(1); setSearch(""); setCampFilter("all"); setCategoryFilter("all"); setStatusFilter("all"); }}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-all"
              style={
                isActive
                  ? { background: "#FFFFFF", color: "#1C1815", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }
                  : { color: "#9C8E7A" }
              }
            >
              {t === "active" ? "Active / Sold" : "Deceased"}
              <span
                className="text-[10px] font-mono px-1.5 py-0.5 rounded-full"
                style={
                  isActive
                    ? { background: t === "active" ? "rgba(74,124,89,0.15)" : "rgba(192,87,76,0.12)", color: t === "active" ? "#4A7C59" : "#C0574C" }
                    : { background: "rgba(156,142,122,0.15)", color: "#9C8E7A" }
                }
              >
                {count.toLocaleString()}
              </span>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Search ID or name..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className={farmInput}
          style={{
            background: "#FFFFFF",
            border: "1px solid #E0D5C8",
            color: "#1C1815",
            width: "14rem",
          }}
        />
        <select
          value={campFilter}
          onChange={(e) => { setCampFilter(e.target.value); setPage(1); }}
          className={farmSelect}
          style={{
            background: "#FFFFFF",
            border: "1px solid #E0D5C8",
            color: "#1C1815",
          }}
        >
          <option value="all">All Camps</option>
          {camps.map((c) => (
            <option key={c.camp_id} value={c.camp_id}>
              {c.camp_name}
            </option>
          ))}
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
          className={farmSelect}
          style={{
            background: "#FFFFFF",
            border: "1px solid #E0D5C8",
            color: "#1C1815",
          }}
        >
          <option value="all">All Categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {getCategoryLabel(c)}
            </option>
          ))}
        </select>
        {tab === "active" && (
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className={farmSelect}
            style={{
              background: "#FFFFFF",
              border: "1px solid #E0D5C8",
              color: "#1C1815",
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
        <span className="ml-auto text-sm self-center" style={{ color: "#9C8E7A" }}>
          {filtered.length.toLocaleString()} animals found
        </span>
      </div>

      {/* Table */}
      <div
        className="overflow-x-auto rounded-2xl"
        style={{ background: "#FFFFFF", border: "1px solid #E0D5C8" }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid #E0D5C8" }}>
              {(tab === "active"
                ? [["animalId", "ID"], ["category", "Category"], ["sex", "Sex"], ["dateOfBirth", "Age"], ["currentCamp", "Camp"], ...(mobs && mobs.length > 0 ? [["mobId", "Mob"]] : []), ["status", "Status"], ["", ""]] as [string, string][]
                : [["animalId", "ID"], ["category", "Category"], ["sex", "Sex"], ["dateOfBirth", "Age"], ["currentCamp", "Last Camp"], ["deceasedAt", "Deceased On"]] as [string, string][]
              ).map(([key, label]) => (
                <th
                  key={key || "__actions"}
                  className={`text-left px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide ${key ? "cursor-pointer select-none" : ""}`}
                  style={{ color: "#9C8E7A", background: "#F5F2EE" }}
                  onClick={() => key && toggleSort(key)}
                >
                  {label}
                  {key && <SortIcon col={key} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageData.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-10 text-center text-sm"
                  style={{ color: "#9C8E7A" }}
                >
                  No animals found.
                </td>
              </tr>
            )}
            {pageData.map((animal) => (
              <tr
                key={animal.animalId}
                className="transition-colors"
                style={{ borderBottom: "1px solid #E0D5C8" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(122,92,30,0.05)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link
                      href={`/${farmSlug}/admin/animals/${animal.animalId}`}
                      className="font-mono text-sm font-semibold transition-colors"
                      style={{ color: "#1C1815" }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = "#8B6914")}
                      onMouseLeave={(e) => (e.currentTarget.style.color = "#1C1815")}
                    >
                      {animal.animalId}
                    </Link>
                    {withdrawalIds?.has(animal.animalId) && (
                      <span
                        className="text-[10px] font-semibold rounded-full px-2 py-0.5 shrink-0"
                        style={{
                          background: "rgba(196,144,48,0.15)",
                          color: "#C49030",
                          border: "1px solid rgba(196,144,48,0.3)",
                        }}
                      >
                        In withdrawal
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${getCategoryChipColor(animal.category)}`}>
                    {getCategoryLabel(animal.category)}
                  </span>
                </td>
                <td className="px-3 py-2 text-sm" style={{ color: "#6B5C4E" }}>
                  {animal.sex === "Male" ? "Male" : "Female"}
                </td>
                <td className="px-3 py-2 text-sm font-mono" style={{ color: "#9C8E7A" }}>
                  {getAnimalAge(animal.dateOfBirth ?? undefined)}
                </td>
                <td className="px-3 py-2">
                  <Link
                    href={`/${farmSlug}/dashboard/camp/${animal.currentCamp}`}
                    className="text-sm font-medium font-mono transition-colors"
                    style={{ color: "#6B5C4E" }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "#8B6914")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "#6B5C4E")}
                  >
                    {animal.currentCamp}
                  </Link>
                </td>
                {tab === "active" ? (
                  <>
                    {mobs && mobs.length > 0 && (
                      <td className="px-3 py-2 text-sm" style={{ color: "#6B5C4E" }}>
                        {animal.mobId ? (mobMap.get(animal.mobId) ?? "—") : "—"}
                      </td>
                    )}
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1.5">
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ background: animal.status === "Active" ? "#4A7C59" : "#9C8E7A" }}
                        />
                        <span className="text-xs" style={{ color: animal.status === "Active" ? "#4A7C59" : "#9C8E7A" }}>
                          {animal.status}
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {animal.status === "Active" && (
                        <AnimalActions animalId={animal.animalId} campId={animal.currentCamp} variant="row" />
                      )}
                    </td>
                  </>
                ) : (
                  <td className="px-3 py-2 text-sm font-mono" style={{ color: "#8B3A3A" }}>
                    {animal.deceasedAt ? new Date(animal.deceasedAt).toLocaleDateString("en-ZA") : "—"}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* In-page pagination (client-side slice of the already-hydrated
          batch) */}
      {totalPages > 1 && (
        <div className="flex items-center gap-2 justify-center">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 text-sm rounded-lg disabled:opacity-30 transition-colors"
            style={{
              border: "1px solid #E0D5C8",
              color: "#6B5C4E",
              background: "transparent",
            }}
          >
            ← Previous
          </button>
          <span className="text-sm font-mono" style={{ color: "#9C8E7A" }}>
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 text-sm rounded-lg disabled:opacity-30 transition-colors"
            style={{
              border: "1px solid #E0D5C8",
              color: "#6B5C4E",
              background: "transparent",
            }}
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
            className="px-4 py-2 text-sm font-medium rounded-xl transition-colors disabled:opacity-50"
            style={{
              border: "1px solid #E0D5C8",
              color: "#6B5C4E",
              background: "#FFFFFF",
            }}
          >
            {loadingMore ? "Loading…" : `Load more (${animals.length.toLocaleString()} loaded)`}
          </button>
        </div>
      )}
    </div>
  );
}
