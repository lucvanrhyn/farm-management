/**
 * One-time script: exports dummy animal data to animals.xlsx (project root)
 * Run with: pnpm exec tsx --tsconfig tsconfig.scripts.json scripts/export-dummy-to-excel.ts
 */

import * as XLSX from "xlsx";
import path from "path";

// Inline animal generation (copied from dummy-data to avoid ESM import issues in scripts)
type AnimalCategory = "Cow" | "Bull" | "Heifer" | "Calf" | "Ox";

const CATEGORY_PREFIX: Record<AnimalCategory, string> = {
  Cow: "KO",
  Calf: "SK",
  Heifer: "VS",
  Bull: "BU",
  Ox: "OS",
};

const CAMP_SPECS: { campId: string; counts: Partial<Record<AnimalCategory, number>> }[] = [
  { campId: "I-1",             counts: { Cow: 70, Calf: 12 } },
  { campId: "I-3",             counts: { Cow: 62, Calf: 13 } },
  { campId: "A",               counts: { Cow: 55, Calf: 13 } },
  { campId: "B",               counts: { Cow: 60, Calf: 11 } },
  { campId: "C",               counts: { Calf: 54 } },
  { campId: "D",               counts: { Calf: 48 } },
  { campId: "Teerlings",       counts: { Heifer: 35 } },
  { campId: "Sirkel",          counts: { Heifer: 40 } },
  { campId: "Bulle",           counts: { Bull: 18 } },
  { campId: "H",               counts: { Cow: 50, Calf: 12 } },
  { campId: "Uithoek",         counts: { Cow: 45 } },
  { campId: "Wildskamp",       counts: { Calf: 30 } },
  { campId: "Bloukom",         counts: { Cow: 42, Calf: 10 } },
  { campId: "Ben se Huis",     counts: { Heifer: 28 } },
  { campId: "Everlyn",         counts: { Cow: 44, Calf: 11 } },
  { campId: "Praalhoek",       counts: { Cow: 44 } },
  { campId: "Praalhoek Verse", counts: { Heifer: 32 } },
  { campId: "B4",              counts: { Bull: 22 } },
  { campId: "B1",              counts: { Bull: 17 } },
];

function pad(n: number, width = 3): string {
  return String(n).padStart(width, "0");
}

function randomDob(minYear: number, maxYear: number): string {
  const year = minYear + Math.floor(Math.random() * (maxYear - minYear + 1));
  const month = 1 + Math.floor(Math.random() * 12);
  const day = 1 + Math.floor(Math.random() * 28);
  return `${year}-${pad(month, 2)}-${pad(day, 2)}`;
}

interface AnimalRow {
  animal_id: string;
  name: string;
  sex: string;
  date_of_birth: string;
  breed: string;
  category: string;
  current_camp: string;
  status: string;
  mother_id: string;
  father_id: string;
  notes: string;
  date_added: string;
}

function generateAnimals(): AnimalRow[] {
  const animals: AnimalRow[] = [];
  const counters: Record<string, number> = {};

  for (const spec of CAMP_SPECS) {
    for (const [rawCat, count] of Object.entries(spec.counts)) {
      const category = rawCat as AnimalCategory;
      const prefix = CATEGORY_PREFIX[category];
      counters[prefix] = counters[prefix] ?? 0;

      for (let i = 0; i < (count ?? 0); i++) {
        counters[prefix]++;
        const id = `${prefix}-${pad(counters[prefix])}`;

        let dobMin: number, dobMax: number;
        if (category === "Cow") { dobMin = 2018; dobMax = 2022; }
        else if (category === "Heifer") { dobMin = 2023; dobMax = 2024; }
        else if (category === "Calf") { dobMin = 2024; dobMax = 2025; }
        else if (category === "Bull") { dobMin = 2019; dobMax = 2021; }
        else { dobMin = 2020; dobMax = 2023; }

        animals.push({
          animal_id: id,
          name: "",
          sex: (category === "Bull" || category === "Ox") ? "Male" : "Female",
          date_of_birth: randomDob(dobMin, dobMax),
          breed: "Brangus",
          category,
          current_camp: spec.campId,
          status: "Active",
          mother_id: "",
          father_id: "",
          notes: "",
          date_added: "2024-01-15",
        });
      }
    }
  }

  return animals;
}

const animals = generateAnimals();

const worksheet = XLSX.utils.json_to_sheet(animals, {
  header: [
    "animal_id", "name", "sex", "date_of_birth", "breed",
    "category", "current_camp", "status", "mother_id", "father_id",
    "notes", "date_added",
  ],
});

// Set column widths for readability
worksheet["!cols"] = [
  { wch: 10 }, // animal_id
  { wch: 14 }, // name
  { wch: 8 },  // sex
  { wch: 14 }, // date_of_birth
  { wch: 10 }, // breed
  { wch: 10 }, // category
  { wch: 18 }, // current_camp
  { wch: 10 }, // status
  { wch: 10 }, // mother_id
  { wch: 10 }, // father_id
  { wch: 30 }, // notes
  { wch: 12 }, // date_added
];

const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, worksheet, "Animals");

const outPath = path.join(process.cwd(), "animals.xlsx");
XLSX.writeFile(workbook, outPath);

console.log(`✅ Exported ${animals.length} animals to ${outPath}`);
