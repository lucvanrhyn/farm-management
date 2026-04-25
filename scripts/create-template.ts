import * as path from "path";
import { ExcelJS, writeWorkbookFile } from "../lib/xlsx-shim";

// ── Camps sheet ──────────────────────────────────────────────────────────────
const campsData = [
  ["camp_name", "size_hectares", "water_source", "notes"],
  ["Rivier", 150, "River", "Best grazing on the farm"],
  ["Koppie", 80, "Borehole", "Rocky terrain — use for dry cows"],
  ["Kraal", 15, "Trough", "Treatment camp near house"],
];
const campsWidths = [20, 14, 14, 35];

// ── Animals sheet ────────────────────────────────────────────────────────────
const animalsData = [
  ["animal_id", "name", "sex", "date_of_birth", "breed", "category", "current_camp", "status", "mother_id", "father_id", "notes", "date_added"],
  ["B-001", "Atlas",  "Male",   "2021-03-15", "Bonsmara", "Bull",   "Kraal",  "Active", "",      "",      "Stud bull",       "2024-01-10"],
  ["C-001", "Bella",  "Female", "2020-08-22", "Bonsmara", "Cow",    "Rivier", "Active", "C-050", "B-001", "Pregnant",        "2024-01-10"],
  ["H-001", "",       "Female", "2023-06-10", "Bonsmara", "Heifer", "Koppie", "Active", "C-001", "B-001", "",                "2024-06-10"],
  ["K-001", "",       "Male",   "2025-09-15", "Bonsmara", "Calf",   "Rivier", "Active", "C-001", "B-001", "Born on farm",    "2025-09-15"],
  ["O-001", "",       "Male",   "2021-11-03", "Bonsmara", "Ox",     "Koppie", "Active", "",      "",      "Castrated 2022",  "2024-03-01"],
];
const animalsWidths = [10, 10, 8, 14, 10, 10, 14, 10, 10, 10, 20, 12];

// ── Workbook ─────────────────────────────────────────────────────────────────
const wb = new ExcelJS.Workbook();

const campsSheet = wb.addWorksheet("Camps");
for (const row of campsData) campsSheet.addRow(row);
campsWidths.forEach((w, i) => {
  campsSheet.getColumn(i + 1).width = w;
});

const animalsSheet = wb.addWorksheet("Animals");
for (const row of animalsData) animalsSheet.addRow(row);
animalsWidths.forEach((w, i) => {
  animalsSheet.getColumn(i + 1).width = w;
});

const outPath = path.join("public", "templates", "farmtrack-import-template.xlsx");

(async () => {
  await writeWorkbookFile(wb, outPath);
  console.log(`Template created: ${outPath}`);
  console.log("  Sheet 1: Camps (4 columns, 3 example rows)");
  console.log("  Sheet 2: Animals (12 columns, 5 example rows)");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
