import type { Animal, AnimalCategory, Camp, CampStats, DailyCampLog, GrazingQuality } from "./types";
import { ANIMALS, CAMPS, DAILY_LOGS } from "./dummy-data";

// Re-export CAMPS for use in components that only import from utils
export { CAMPS };

// ============================================================
// LOOKUPS
// ============================================================

export function getCampById(campId: string): Camp | undefined {
  return CAMPS.find((c) => c.camp_id === campId);
}

export function getAnimalById(animalId: string): Animal | undefined {
  return ANIMALS.find((a) => a.animal_id === animalId);
}

export function getAnimalsByCamp(campId: string): Animal[] {
  return ANIMALS.filter((a) => a.current_camp === campId && a.status === "Active");
}

// ============================================================
// LABELS
// ============================================================

export function getCategoryLabel(category: AnimalCategory): string {
  switch (category) {
    case "Cow":    return "Cow";
    case "Calf":   return "Calf";
    case "Heifer": return "Heifer";
    case "Bull":   return "Bull";
    case "Ox":     return "Ox";
  }
}

export function getCategoryPluralLabel(category: AnimalCategory): string {
  switch (category) {
    case "Cow":    return "Cows";
    case "Calf":   return "Calves";
    case "Heifer": return "Heifers";
    case "Bull":   return "Bulls";
    case "Ox":     return "Oxen";
  }
}

// ============================================================
// GRAZING COLORS
// ============================================================

export function getGrazingColor(quality: GrazingQuality): string {
  switch (quality) {
    case "Good":       return "#22c55e";
    case "Fair":       return "#eab308";
    case "Poor":       return "#f97316";
    case "Overgrazed": return "#ef4444";
  }
}

export function getGrazingTailwindBg(quality: GrazingQuality): string {
  switch (quality) {
    case "Good":       return "bg-lime-900/50 text-lime-300";
    case "Fair":       return "bg-amber-900/50 text-amber-300";
    case "Poor":       return "bg-orange-900/50 text-orange-300";
    case "Overgrazed": return "bg-red-900/50 text-red-300";
  }
}

export function getGrazingDot(quality: GrazingQuality): string {
  switch (quality) {
    case "Good":       return "bg-lime-700";
    case "Fair":       return "bg-amber-500";
    case "Poor":       return "bg-orange-700";
    case "Overgrazed": return "bg-red-700";
  }
}

// ============================================================
// CAMP STATS
// ============================================================

export function getCampStats(campId: string): CampStats {
  const animals = getAnimalsByCamp(campId);
  const byCategory: Partial<Record<AnimalCategory, number>> = {};
  for (const a of animals) {
    byCategory[a.category] = (byCategory[a.category] ?? 0) + 1;
  }
  return { total: animals.length, byCategory };
}

// ============================================================
// INSPECTION LOGS
// ============================================================

export function getLastInspection(campId: string): DailyCampLog | undefined {
  const logs = DAILY_LOGS.filter((l) => l.camp_id === campId);
  return logs.sort((a, b) => b.date.localeCompare(a.date))[0];
}

export function getLast7DaysLogs(campId: string): DailyCampLog[] {
  return DAILY_LOGS.filter((l) => l.camp_id === campId)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ============================================================
// RELATIVE TIME
// ============================================================

export function relativeTime(dateStr: string): string {
  const now = new Date();
  const then = new Date(dateStr.includes("T") ? dateStr : `${dateStr}T08:00:00`);
  const diffMs = now.getTime() - then.getTime();
  const diffH = Math.floor(diffMs / (1000 * 60 * 60));
  const diffD = Math.floor(diffH / 24);

  if (diffH < 1) return "Just now";
  if (diffH < 24) return `${diffH}h ago`;
  if (diffD === 1) return "Yesterday";
  if (diffD < 7) return `${diffD} days ago`;
  return `${Math.floor(diffD / 7)}w ago`;
}

// ============================================================
// ANIMAL AGE
// ============================================================

export function getAnimalAge(dob: string | undefined): string {
  if (!dob) return "Unknown";
  const now = new Date();
  const birth = new Date(dob);
  const months = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth());
  if (months < 24) return `${months} months`;
  const years = Math.floor(months / 12);
  return `${years} years`;
}

// ============================================================
// CATEGORY COLOR CHIP
// ============================================================

export function getCategoryChipColor(category: AnimalCategory): string {
  switch (category) {
    case "Cow":    return "bg-emerald-100 text-emerald-800";
    case "Calf":   return "bg-sky-100 text-sky-800";
    case "Heifer": return "bg-violet-100 text-violet-800";
    case "Bull":   return "bg-amber-100 text-amber-800";
    case "Ox":     return "bg-stone-100 text-stone-700";
  }
}

// ============================================================
// ADMIN STATS
// ============================================================

export function getTotalAnimals(): number {
  return ANIMALS.filter((a) => a.status === "Active").length;
}

export function getInspectedToday(): number {
  const today = new Date().toISOString().split("T")[0];
  const todayLogs = DAILY_LOGS.filter((l) => l.date === today);
  return new Set(todayLogs.map((l) => l.camp_id)).size;
}

// ============================================================
// ALERT + DENSITY HELPERS (for Schematic Map)
// ============================================================

/** Count camps that have at least one active alert condition */
export function getAlertCount(): number {
  return CAMPS.filter((camp) => {
    const log = getLastInspection(camp.camp_id);
    return (
      log?.grazing_quality === "Overgrazed" ||
      log?.water_status === "Empty" ||
      log?.water_status === "Broken" ||
      log?.fence_status === "Damaged"
    );
  }).length;
}

/** Whether a single camp has an active alert */
export function campHasAlert(campId: string): boolean {
  const log = getLastInspection(campId);
  return (
    log?.grazing_quality === "Overgrazed" ||
    log?.water_status === "Empty" ||
    log?.water_status === "Broken" ||
    log?.fence_status === "Damaged"
  ) ?? false;
}

/** Animals per hectare for a camp */
export function getStockingDensity(campId: string): number {
  const camp = getCampById(campId);
  const stats = getCampStats(campId);
  if (!camp?.size_hectares || camp.size_hectares === 0) return 0;
  return stats.total / camp.size_hectares;
}

/** Days since last inspection (from today = 2026-02-28) */
export function daysSinceInspection(campId: string): number {
  const log = getLastInspection(campId);
  if (!log) return 99;
  const today = new Date();
  const inspected = new Date(log.date);
  return Math.floor((today.getTime() - inspected.getTime()) / (1000 * 60 * 60 * 24));
}

// ============================================================
// CLASSNAME UTILITY
// ============================================================

export function cn(...classes: (string | undefined | false | null)[]): string {
  return classes.filter(Boolean).join(" ");
}
