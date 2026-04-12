import type { AnimalCategory, GrazingQuality } from "./types";

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
    default:       return category; // Sheep/game categories pass through as-is
  }
}

export function getCategoryPluralLabel(category: AnimalCategory): string {
  switch (category) {
    case "Cow":    return "Cows";
    case "Calf":   return "Calves";
    case "Heifer": return "Heifers";
    case "Bull":   return "Bulls";
    case "Ox":     return "Oxen";
    default:       return `${category}s`; // Reasonable pluralization fallback
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
    // Sheep categories
    case "Ewe":        return "bg-rose-100 text-rose-800";
    case "Ram":        return "bg-amber-100 text-amber-800";
    case "Lamb":       return "bg-sky-100 text-sky-800";
    case "Wether":     return "bg-stone-100 text-stone-700";
    case "Hogget":     return "bg-teal-100 text-teal-800";
    case "Maiden Ewe": return "bg-pink-100 text-pink-800";
    case "Ewe Lamb":   return "bg-fuchsia-100 text-fuchsia-800";
    // Game categories
    case "Adult Male":   return "bg-indigo-100 text-indigo-800";
    case "Adult Female": return "bg-purple-100 text-purple-800";
    case "Sub-adult":    return "bg-cyan-100 text-cyan-800";
    case "Juvenile":     return "bg-sky-100 text-sky-800";
    default:             return "bg-gray-100 text-gray-700";
  }
}

// ============================================================
// CLASSNAME UTILITY
// ============================================================

export function cn(...classes: (string | undefined | false | null)[]): string {
  return classes.filter(Boolean).join(" ");
}
