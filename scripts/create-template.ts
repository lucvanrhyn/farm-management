import * as XLSX from "xlsx";
import * as path from "path";

// ── Camps sheet ──────────────────────────────────────────────────────────────
const campsData = [
  ["camp_name", "size_hectares", "water_source", "notes"],
  ["Rivier", 150, "River", "Best grazing on the farm"],
  ["Koppie", 80, "Borehole", "Rocky terrain — use for dry cows"],
  ["Kraal", 15, "Trough", "Treatment camp near house"],
];

const campsSheet = XLSX.utils.aoa_to_sheet(campsData);
campsSheet["!cols"] = [
  { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 35 },
];

// ── Animals sheet ────────────────────────────────────────────────────────────
const animalsData = [
  ["animal_id", "name", "sex", "date_of_birth", "breed", "category", "current_camp", "status", "mother_id", "father_id", "notes", "date_added"],
  ["B-001", "Atlas",  "Male",   "2021-03-15", "Bonsmara", "Bull",   "Kraal",  "Active", "",      "",      "Stud bull",       "2024-01-10"],
  ["C-001", "Bella",  "Female", "2020-08-22", "Bonsmara", "Cow",    "Rivier", "Active", "C-050", "B-001", "Pregnant",        "2024-01-10"],
  ["H-001", "",       "Female", "2023-06-10", "Bonsmara", "Heifer", "Koppie", "Active", "C-001", "B-001", "",                "2024-06-10"],
  ["K-001", "",       "Male",   "2025-09-15", "Bonsmara", "Calf",   "Rivier", "Active", "C-001", "B-001", "Born on farm",    "2025-09-15"],
  ["O-001", "",       "Male",   "2021-11-03", "Bonsmara", "Ox",     "Koppie", "Active", "",      "",      "Castrated 2022",  "2024-03-01"],
];

const animalsSheet = XLSX.utils.aoa_to_sheet(animalsData);
animalsSheet["!cols"] = [
  { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 14 }, { wch: 10 },
  { wch: 10 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
  { wch: 20 }, { wch: 12 },
];

// ── Workbook ─────────────────────────────────────────────────────────────────
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, campsSheet, "Camps");
XLSX.utils.book_append_sheet(wb, animalsSheet, "Animals");

const outPath = path.join("public", "templates", "farmtrack-import-template.xlsx");
XLSX.writeFile(wb, outPath);
console.log(`Template created: ${outPath}`);
console.log("  Sheet 1: Camps (4 columns, 3 example rows)");
console.log("  Sheet 2: Animals (12 columns, 5 example rows)");
