"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { ANIMALS, CAMPS } from "@/lib/dummy-data";
import { getCategoryLabel, getCategoryChipColor, getAnimalAge } from "@/lib/utils";
import type { AnimalCategory, AnimalStatus } from "@/lib/types";

const PAGE_SIZE = 50;

export default function AnimalsTable() {
  const [search, setSearch] = useState("");
  const [campFilter, setCampFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortKey, setSortKey] = useState<string>("animal_id");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return ANIMALS.filter((a) => {
      if (q && !a.animal_id.toLowerCase().includes(q) && !(a.name ?? "").toLowerCase().includes(q)) return false;
      if (campFilter !== "all" && a.current_camp !== campFilter) return false;
      if (categoryFilter !== "all" && a.category !== categoryFilter) return false;
      if (statusFilter !== "all" && a.status !== statusFilter) return false;
      return true;
    }).sort((a, b) => {
      const av = String((a as unknown as Record<string, unknown>)[sortKey] ?? "");
      const bv = String((b as unknown as Record<string, unknown>)[sortKey] ?? "");
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [search, campFilter, categoryFilter, statusFilter, sortKey, sortDir]);

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
    <span className="ml-1 opacity-40 text-xs">
      {sortKey === col ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
    </span>
  );

  const categories: AnimalCategory[] = ["Cow", "Calf", "Heifer", "Bull", "Ox"];
  const statuses: AnimalStatus[] = ["Active", "Sold", "Deceased"];

  return (
    <div className="flex flex-col gap-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Soek ID of naam..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="border border-stone-300 rounded-xl px-4 py-2 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-green-500"
        />
        <select
          value={campFilter}
          onChange={(e) => { setCampFilter(e.target.value); setPage(1); }}
          className="border border-stone-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
        >
          <option value="all">Alle Kampe</option>
          {CAMPS.map((c) => <option key={c.camp_id} value={c.camp_id}>{c.camp_name}</option>)}
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
          className="border border-stone-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
        >
          <option value="all">Alle Kategorieë</option>
          {categories.map((c) => <option key={c} value={c}>{getCategoryLabel(c)}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="border border-stone-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
        >
          <option value="all">Alle Status</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="ml-auto text-sm text-stone-500 self-center">
          {filtered.length.toLocaleString()} diere gevind
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100 bg-stone-50">
              {([
                ["animal_id", "ID"],
                ["category", "Kategorie"],
                ["sex", "Geslag"],
                ["date_of_birth", "Ouderdom"],
                ["current_camp", "Kamp"],
                ["status", "Status"],
              ] as [string, string][]).map(([key, label]) => (
                <th
                  key={key}
                  className="text-left px-4 py-3 font-semibold text-stone-600 cursor-pointer select-none hover:text-stone-900"
                  onClick={() => toggleSort(key)}
                >
                  {label}<SortIcon col={key} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageData.map((animal) => (
              <tr key={animal.animal_id} className="border-b border-stone-50 hover:bg-stone-50 transition-colors">
                <td className="px-4 py-3">
                  <Link href={`/dashboard/animal/${animal.animal_id}`} className="font-mono font-semibold text-stone-800 hover:text-green-700">
                    {animal.animal_id}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${getCategoryChipColor(animal.category)}`}>
                    {getCategoryLabel(animal.category)}
                  </span>
                </td>
                <td className="px-4 py-3 text-stone-600">{animal.sex === "Male" ? "Manlik" : "Vroulik"}</td>
                <td className="px-4 py-3 text-stone-500">{getAnimalAge(animal.date_of_birth)}</td>
                <td className="px-4 py-3">
                  <Link href={`/dashboard/camp/${animal.current_camp}`} className="text-stone-700 hover:text-green-700 font-medium">
                    {animal.current_camp}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                    animal.status === "Active" ? "bg-green-100 text-green-700"
                    : animal.status === "Sold" ? "bg-stone-100 text-stone-600"
                    : "bg-red-100 text-red-600"
                  }`}>
                    {animal.status === "Active" ? "Aktief" : animal.status === "Sold" ? "Verkoop" : "Oorlede"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center gap-2 justify-center">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 text-sm border border-stone-300 rounded-lg disabled:opacity-40 hover:bg-stone-100"
          >
            ← Vorige
          </button>
          <span className="text-sm text-stone-500">Bladsy {page} van {totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 text-sm border border-stone-300 rounded-lg disabled:opacity-40 hover:bg-stone-100"
          >
            Volgende →
          </button>
        </div>
      )}
    </div>
  );
}
