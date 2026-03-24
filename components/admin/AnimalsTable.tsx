"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { getCategoryLabel, getCategoryChipColor, getAnimalAge } from "@/lib/utils";
import type { AnimalCategory, AnimalStatus, Camp, PrismaAnimal } from "@/lib/types";
import AnimalActions from "@/components/admin/finansies/AnimalActions";

const PAGE_SIZE = 50;

interface Props {
  animals: PrismaAnimal[];
  camps: Camp[];
  farmSlug: string;
}

const farmInput =
  "rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[rgba(122,92,30,0.4)]";
const farmSelect =
  "rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[rgba(122,92,30,0.4)]";

export default function AnimalsTable({ animals, camps, farmSlug }: Props) {
  const [tab, setTab] = useState<"active" | "deceased">("active");
  const [search, setSearch] = useState("");
  const [campFilter, setCampFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortKey, setSortKey] = useState<string>("animalId");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);

  const activeAnimals = useMemo(() => animals.filter((a) => a.status !== "Deceased"), [animals]);
  const deceasedAnimals = useMemo(() => animals.filter((a) => a.status === "Deceased"), [animals]);

  const filtered = useMemo(() => {
    const source = tab === "deceased" ? deceasedAnimals : activeAnimals;
    const q = search.toLowerCase();
    return source
      .filter((a) => {
        if (q && !a.animalId.toLowerCase().includes(q) && !(a.name ?? "").toLowerCase().includes(q)) return false;
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
  }, [tab, activeAnimals, deceasedAnimals, search, campFilter, categoryFilter, statusFilter, sortKey, sortDir]);

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
      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl w-fit" style={{ background: "#F0EBE4" }}>
        {(["active", "deceased"] as const).map((t) => {
          const count = t === "active" ? activeAnimals.length : deceasedAnimals.length;
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
                ? [["animalId", "ID"], ["category", "Category"], ["sex", "Sex"], ["dateOfBirth", "Age"], ["currentCamp", "Camp"], ["status", "Status"], ["", ""]] as [string, string][]
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
            {pageData.map((animal) => (
              <tr
                key={animal.animalId}
                className="transition-colors"
                style={{ borderBottom: "1px solid #E0D5C8" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(122,92,30,0.05)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <td className="px-3 py-2">
                  <Link
                    href={`/${farmSlug}/admin/animals/${animal.animalId}`}
                    className="font-mono text-sm font-semibold transition-colors"
                    style={{ color: "#1C1815" }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "#8B6914")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "#1C1815")}
                  >
                    {animal.animalId}
                  </Link>
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

      {/* Pagination */}
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
    </div>
  );
}
