"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { CAMPS } from "@/lib/dummy-data";
import { getCategoryLabel, getCategoryChipColor, getAnimalAge } from "@/lib/utils";
import type { AnimalCategory, AnimalStatus, PrismaAnimal } from "@/lib/types";
import AnimalActions from "@/components/admin/finansies/AnimalActions";

const PAGE_SIZE = 50;

interface Props {
  animals: PrismaAnimal[];
}

const farmInput =
  "rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[rgba(139,105,20,0.5)]";
const farmSelect =
  "rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[rgba(139,105,20,0.5)]";

export default function AnimalsTable({ animals }: Props) {
  const [search, setSearch] = useState("");
  const [campFilter, setCampFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortKey, setSortKey] = useState<string>("animalId");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return animals
      .filter((a) => {
        if (q && !a.animalId.toLowerCase().includes(q) && !(a.name ?? "").toLowerCase().includes(q)) return false;
        if (campFilter !== "all" && a.currentCamp !== campFilter) return false;
        if (categoryFilter !== "all" && a.category !== categoryFilter) return false;
        if (statusFilter !== "all" && a.status !== statusFilter) return false;
        return true;
      })
      .sort((a, b) => {
        const av = String((a as unknown as Record<string, unknown>)[sortKey] ?? "");
        const bv = String((b as unknown as Record<string, unknown>)[sortKey] ?? "");
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      });
  }, [animals, search, campFilter, categoryFilter, statusFilter, sortKey, sortDir]);

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

  const categories: AnimalCategory[] = ["Cow", "Calf", "Heifer", "Bull", "Ox"];
  const statuses: AnimalStatus[] = ["Active", "Sold", "Deceased"];

  return (
    <div className="flex flex-col gap-4">
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
            background: "#241C14",
            border: "1px solid rgba(139,105,20,0.25)",
            color: "#F5EBD4",
            width: "14rem",
          }}
        />
        <select
          value={campFilter}
          onChange={(e) => { setCampFilter(e.target.value); setPage(1); }}
          className={farmSelect}
          style={{
            background: "#241C14",
            border: "1px solid rgba(139,105,20,0.25)",
            color: "#F5EBD4",
          }}
        >
          <option value="all">All Camps</option>
          {CAMPS.map((c) => (
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
            background: "#241C14",
            border: "1px solid rgba(139,105,20,0.25)",
            color: "#F5EBD4",
          }}
        >
          <option value="all">All Categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {getCategoryLabel(c)}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className={farmSelect}
          style={{
            background: "#241C14",
            border: "1px solid rgba(139,105,20,0.25)",
            color: "#F5EBD4",
          }}
        >
          <option value="all">All Statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span className="ml-auto text-sm self-center" style={{ color: "rgba(210,180,140,0.55)" }}>
          {filtered.length.toLocaleString()} animals found
        </span>
      </div>

      {/* Table */}
      <div
        className="overflow-x-auto rounded-2xl"
        style={{ background: "#241C14", border: "1px solid rgba(139,105,20,0.18)" }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(139,105,20,0.15)" }}>
              {([
                ["animalId", "ID"],
                ["category", "Category"],
                ["sex", "Sex"],
                ["dateOfBirth", "Age"],
                ["currentCamp", "Camp"],
                ["status", "Status"],
                ["", ""],
              ] as [string, string][]).map(([key, label]) => (
                <th
                  key={key || "__actions"}
                  className={`text-left px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide ${key ? "cursor-pointer select-none" : ""}`}
                  style={{ color: "rgba(210,180,140,0.55)", background: "rgba(139,105,20,0.06)" }}
                  onClick={() => key && toggleSort(key)}
                >
                  {label}
                  {key && <SortIcon col={key} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageData.map((animal) => (
              <tr
                key={animal.animalId}
                className="transition-colors"
                style={{ borderBottom: "1px solid rgba(139,105,20,0.08)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(139,105,20,0.06)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/animals/${animal.animalId}`}
                    className="font-mono text-sm font-semibold transition-colors"
                    style={{ color: "#F5EBD4" }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "#8B6914")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "#F5EBD4")}
                  >
                    {animal.animalId}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${getCategoryChipColor(animal.category)}`}>
                    {getCategoryLabel(animal.category)}
                  </span>
                </td>
                <td className="px-3 py-2 text-sm" style={{ color: "rgba(210,180,140,0.75)" }}>
                  {animal.sex === "Male" ? "Male" : "Female"}
                </td>
                <td className="px-3 py-2 text-sm font-mono" style={{ color: "rgba(210,180,140,0.6)" }}>
                  {getAnimalAge(animal.dateOfBirth ?? undefined)}
                </td>
                <td className="px-3 py-2">
                  <Link
                    href={`/dashboard/camp/${animal.currentCamp}`}
                    className="text-sm font-medium font-mono transition-colors"
                    style={{ color: "rgba(210,180,140,0.85)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "#8B6914")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(210,180,140,0.85)")}
                  >
                    {animal.currentCamp}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{
                        background:
                          animal.status === "Active" ? "#4A7C59"
                          : animal.status === "Sold" ? "rgba(210,180,140,0.4)"
                          : "#8B3A3A",
                      }}
                    />
                    <span
                      className="text-xs"
                      style={{
                        color:
                          animal.status === "Active" ? "#4A7C59"
                          : animal.status === "Sold" ? "rgba(210,180,140,0.55)"
                          : "#8B3A3A",
                      }}
                    >
                      {animal.status === "Active" ? "Active" : animal.status === "Sold" ? "Sold" : "Deceased"}
                    </span>
                  </span>
                </td>
                <td className="px-3 py-2">
                  {animal.status === "Active" && (
                    <AnimalActions animalId={animal.animalId} campId={animal.currentCamp} variant="row" />
                  )}
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
            className="px-3 py-1.5 text-sm rounded-lg disabled:opacity-30 transition-colors"
            style={{
              border: "1px solid rgba(139,105,20,0.25)",
              color: "rgba(210,180,140,0.85)",
              background: "transparent",
            }}
          >
            ← Previous
          </button>
          <span className="text-sm font-mono" style={{ color: "rgba(210,180,140,0.55)" }}>
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 text-sm rounded-lg disabled:opacity-30 transition-colors"
            style={{
              border: "1px solid rgba(139,105,20,0.25)",
              color: "rgba(210,180,140,0.85)",
              background: "transparent",
            }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
