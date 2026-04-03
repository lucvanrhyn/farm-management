import type {
  Animal,
  Camp,
  Observation,
  CalvingRecord,
  Treatment,
  DailyCampLog,
  AnimalCategory,
  GrazingQuality,
  WaterStatus,
  FenceStatus,
} from "./types";

// ============================================================
// CAMP COORDINATE HELPERS
// Grid centered around (-25.50, 28.45), 0.025° spacing
// Each camp: 0.015° × 0.015° rectangle (~1.5km × 1.3km)
// ============================================================

function makePolygon(col: number, row: number): string {
  const lat = -25.50 + row * 0.025;
  const lng = 28.45 + col * 0.025;
  const half = 0.0075;
  const coords = [
    [lng - half, lat - half],
    [lng + half, lat - half],
    [lng + half, lat + half],
    [lng - half, lat + half],
    [lng - half, lat - half],
  ];
  return JSON.stringify({ type: "Polygon", coordinates: [coords] });
}

// ============================================================
// CAMPS (19)
// ============================================================

export const CAMPS: Camp[] = [
  // Row 0
  { camp_id: "I-1", camp_name: "I-1", size_hectares: 245, water_source: "borehole", geojson: makePolygon(0, 0) },
  { camp_id: "I-3", camp_name: "I-3", size_hectares: 210, water_source: "borehole", geojson: makePolygon(1, 0) },
  { camp_id: "A", camp_name: "A", size_hectares: 180, water_source: "dam", geojson: makePolygon(2, 0) },
  { camp_id: "B", camp_name: "B", size_hectares: 195, water_source: "trough", geojson: makePolygon(3, 0) },
  // Row 1
  { camp_id: "C", camp_name: "C", size_hectares: 155, water_source: "borehole", geojson: makePolygon(0, 1) },
  { camp_id: "D", camp_name: "D", size_hectares: 140, water_source: "borehole", geojson: makePolygon(1, 1) },
  { camp_id: "Teerlings", camp_name: "Teerlings", size_hectares: 120, water_source: "dam", geojson: makePolygon(2, 1) },
  { camp_id: "Sirkel", camp_name: "Sirkel", size_hectares: 130, water_source: "borehole", geojson: makePolygon(3, 1) },
  // Row 2
  { camp_id: "Bulle", camp_name: "Bulle", size_hectares: 80, water_source: "borehole", geojson: makePolygon(0, 2) },
  { camp_id: "H", camp_name: "H", size_hectares: 170, water_source: "trough", geojson: makePolygon(1, 2) },
  { camp_id: "Uithoek", camp_name: "Uithoek", size_hectares: 160, water_source: "river", geojson: makePolygon(2, 2) },
  { camp_id: "Wildskamp", camp_name: "Wildskamp", size_hectares: 115, water_source: "borehole", geojson: makePolygon(3, 2) },
  // Row 3
  { camp_id: "Bloukom", camp_name: "Bloukom", size_hectares: 190, water_source: "dam", geojson: makePolygon(0, 3) },
  { camp_id: "Ben se Huis", camp_name: "Ben se Huis", size_hectares: 100, water_source: "trough", geojson: makePolygon(1, 3) },
  { camp_id: "Everlyn", camp_name: "Everlyn", size_hectares: 175, water_source: "borehole", geojson: makePolygon(2, 3) },
  { camp_id: "Praalhoek", camp_name: "Praalhoek", size_hectares: 145, water_source: "river", geojson: makePolygon(3, 3) },
  // Row 4
  { camp_id: "Praalhoek Verse", camp_name: "Praalhoek Verse", size_hectares: 110, water_source: "borehole", geojson: makePolygon(0, 4) },
  { camp_id: "B4", camp_name: "B4", size_hectares: 75, water_source: "borehole", geojson: makePolygon(1, 4) },
  { camp_id: "B1", camp_name: "B1", size_hectares: 60, water_source: "borehole", geojson: makePolygon(2, 4) },
];

// ============================================================
// ANIMAL GENERATOR
// ============================================================

type CampSpec = {
  campId: string;
  counts: Partial<Record<AnimalCategory, number>>;
  grazing: GrazingQuality;
};

const CAMP_SPECS: CampSpec[] = [
  { campId: "I-1",             counts: { Cow: 70, Calf: 12 },               grazing: "Good" },
  { campId: "I-3",             counts: { Cow: 62, Calf: 13 },               grazing: "Good" },
  { campId: "A",               counts: { Cow: 55, Calf: 13 },               grazing: "Fair" },
  { campId: "B",               counts: { Cow: 60, Calf: 11 },               grazing: "Good" },
  { campId: "C",               counts: { Calf: 54 },                        grazing: "Good" },
  { campId: "D",               counts: { Calf: 48 },                        grazing: "Fair" },
  { campId: "Teerlings",       counts: { Heifer: 35 },                      grazing: "Good" },
  { campId: "Sirkel",          counts: { Heifer: 40 },                      grazing: "Fair" },
  { campId: "Bulle",           counts: { Bull: 18 },                        grazing: "Good" },
  { campId: "H",               counts: { Cow: 50, Calf: 12 },               grazing: "Fair" },
  { campId: "Uithoek",         counts: { Cow: 45 },                         grazing: "Poor" },
  { campId: "Wildskamp",       counts: { Calf: 30 },                        grazing: "Good" },
  { campId: "Bloukom",         counts: { Cow: 42, Calf: 10 },               grazing: "Good" },
  { campId: "Ben se Huis",     counts: { Heifer: 28 },                      grazing: "Fair" },
  { campId: "Everlyn",         counts: { Cow: 44, Calf: 11 },               grazing: "Good" },
  { campId: "Praalhoek",       counts: { Cow: 44 },                         grazing: "Poor" },
  { campId: "Praalhoek Verse", counts: { Heifer: 32 },                      grazing: "Fair" },
  { campId: "B4",              counts: { Bull: 22 },                        grazing: "Good" },
  { campId: "B1",              counts: { Bull: 17 },                        grazing: "Overgrazed" },
];

const CATEGORY_PREFIX: Record<AnimalCategory, string> = {
  Cow: "KO",
  Calf: "SK",
  Heifer: "VS",
  Bull: "BU",
  Ox: "OS",
};

function pad(n: number, width = 3): string {
  return String(n).padStart(width, "0");
}

function randomDob(minYear: number, maxYear: number): string {
  const year = minYear + Math.floor(Math.random() * (maxYear - minYear + 1));
  const month = 1 + Math.floor(Math.random() * 12);
  const day = 1 + Math.floor(Math.random() * 28);
  return `${year}-${pad(month, 2)}-${pad(day, 2)}`;
}

function makeAnimals(): Animal[] {
  const animals: Animal[] = [];
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
          sex: (category === "Bull" || category === "Ox") ? "Male" : "Female",
          breed: "Brangus",
          category,
          current_camp: spec.campId,
          status: "Active",
          date_of_birth: randomDob(dobMin, dobMax),
          date_added: "2024-01-15",
        });
      }
    }
  }

  return animals;
}

export const ANIMALS: Animal[] = makeAnimals();

// ============================================================
// DAILY CAMP LOGS — 7 days × 19 camps (133 records)
// ============================================================

const GRAZING_BY_CAMP: Record<string, GrazingQuality> = {
  "I-1": "Good", "I-3": "Good", "A": "Fair", "B": "Good",
  "C": "Good", "D": "Fair", "Teerlings": "Good", "Sirkel": "Fair",
  "Bulle": "Good", "H": "Fair", "Uithoek": "Poor", "Wildskamp": "Good",
  "Bloukom": "Good", "Ben se Huis": "Fair", "Everlyn": "Good",
  "Praalhoek": "Poor", "Praalhoek Verse": "Fair", "B4": "Good", "B1": "Overgrazed",
};

const WATER_BY_CAMP: Record<string, WaterStatus> = {
  "I-1": "Full", "I-3": "Full", "A": "Full", "B": "Low",
  "C": "Full", "D": "Full", "Teerlings": "Full", "Sirkel": "Full",
  "Bulle": "Full", "H": "Low", "Uithoek": "Full", "Wildskamp": "Full",
  "Bloukom": "Full", "Ben se Huis": "Low", "Everlyn": "Full",
  "Praalhoek": "Broken", "Praalhoek Verse": "Full", "B4": "Full", "B1": "Full",
};

function isoDate(daysAgo: number): string {
  const d = new Date("2026-02-27");
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split("T")[0];
}

export const DAILY_LOGS: DailyCampLog[] = CAMPS.flatMap((camp, ci) =>
  Array.from({ length: 7 }, (_, dayIndex) => {
    const daysAgo = 6 - dayIndex; // 0 = today, 6 = oldest
    const grazing = GRAZING_BY_CAMP[camp.camp_id] ?? "Fair";
    const water = WATER_BY_CAMP[camp.camp_id] ?? "Full";
    const baseCount = CAMP_SPECS.find(s => s.campId === camp.camp_id)
      ? Object.values(CAMP_SPECS.find(s => s.campId === camp.camp_id)!.counts).reduce((a, b) => a + b, 0)
      : 30;
    const jitter = Math.floor(Math.random() * 3) - 1;

    return {
      log_id: `LOG-${ci + 1}-${dayIndex + 1}`,
      date: isoDate(daysAgo),
      camp_id: camp.camp_id,
      inspected_by: "Dicky",
      animal_count: baseCount + jitter,
      grazing_quality: grazing,
      water_status: water,
      fence_status: "Intact" as FenceStatus,
      rainfall_mm: daysAgo === 3 ? 12 : daysAgo === 5 ? 8 : undefined,
    };
  })
);

// ============================================================
// OBSERVATIONS (~60 records, last 30 days)
// ============================================================

export const OBSERVATIONS: Observation[] = [
  { observation_id: "OBS-001", timestamp: "2026-02-27T08:15:00", logged_by: "Dicky", camp_id: "Uithoek", type: "health_issue", animal_id: "KO-180", details: JSON.stringify({ symptoms: ["Limping"], severity: "mild" }) },
  { observation_id: "OBS-002", timestamp: "2026-02-27T09:30:00", logged_by: "Dicky", camp_id: "B1", type: "camp_condition", grazing_quality: "Overgrazed", water_status: "Full", fence_status: "Intact" },
  { observation_id: "OBS-003", timestamp: "2026-02-26T08:00:00", logged_by: "Dicky", camp_id: "Praalhoek", type: "camp_condition", grazing_quality: "Poor", water_status: "Broken", fence_status: "Intact" },
  { observation_id: "OBS-004", timestamp: "2026-02-26T10:20:00", logged_by: "Dicky", camp_id: "H", type: "health_issue", animal_id: "KO-225", details: JSON.stringify({ symptoms: ["Thin", "Dull eyes"], severity: "moderate" }) },
  { observation_id: "OBS-005", timestamp: "2026-02-25T08:45:00", logged_by: "Dicky", camp_id: "I-1", type: "reproduction", animal_id: "KO-015", details: JSON.stringify({ event: "heat_observed" }) },
  { observation_id: "OBS-006", timestamp: "2026-02-25T11:00:00", logged_by: "Dicky", camp_id: "Teerlings", type: "animal_movement", animal_id: "VS-012", details: JSON.stringify({ from_camp: "Teerlings", to_camp: "Sirkel" }) },
  { observation_id: "OBS-007", timestamp: "2026-02-24T08:10:00", logged_by: "Dicky", camp_id: "B", type: "camp_condition", grazing_quality: "Good", water_status: "Low", fence_status: "Intact" },
  { observation_id: "OBS-008", timestamp: "2026-02-24T09:00:00", logged_by: "Dicky", camp_id: "A", type: "health_issue", animal_id: "KO-088", details: JSON.stringify({ symptoms: ["Eye problem"], severity: "mild" }) },
  { observation_id: "OBS-009", timestamp: "2026-02-23T08:30:00", logged_by: "Dicky", camp_id: "Everlyn", type: "health_issue", animal_id: "KO-310", details: JSON.stringify({ symptoms: ["Wound on leg"], severity: "moderate" }) },
  { observation_id: "OBS-010", timestamp: "2026-02-23T10:15:00", logged_by: "Dicky", camp_id: "Bloukom", type: "camp_condition", grazing_quality: "Good", water_status: "Full", fence_status: "Damaged" },
  { observation_id: "OBS-011", timestamp: "2026-02-22T09:00:00", logged_by: "Dicky", camp_id: "C", type: "camp_check", grazing_quality: "Good", water_status: "Full", fence_status: "Intact" },
  { observation_id: "OBS-012", timestamp: "2026-02-22T08:30:00", logged_by: "Dicky", camp_id: "Bulle", type: "health_issue", animal_id: "BU-004", details: JSON.stringify({ symptoms: ["Limping"], severity: "mild" }) },
  { observation_id: "OBS-013", timestamp: "2026-02-21T08:00:00", logged_by: "Dicky", camp_id: "I-3", type: "reproduction", animal_id: "KO-042", details: JSON.stringify({ event: "heat_observed" }) },
  { observation_id: "OBS-014", timestamp: "2026-02-20T09:45:00", logged_by: "Dicky", camp_id: "Wildskamp", type: "camp_check", grazing_quality: "Good", water_status: "Full", fence_status: "Intact" },
  { observation_id: "OBS-015", timestamp: "2026-02-19T10:30:00", logged_by: "Dicky", camp_id: "Ben se Huis", type: "camp_condition", grazing_quality: "Fair", water_status: "Low", fence_status: "Intact" },
  { observation_id: "OBS-016", timestamp: "2026-02-18T08:15:00", logged_by: "Dicky", camp_id: "D", type: "health_issue", animal_id: "SK-089", details: JSON.stringify({ symptoms: ["Diarrhea"], severity: "moderate" }) },
  { observation_id: "OBS-017", timestamp: "2026-02-17T09:00:00", logged_by: "Dicky", camp_id: "Praalhoek Verse", type: "camp_check", grazing_quality: "Fair", water_status: "Full", fence_status: "Intact" },
  { observation_id: "OBS-018", timestamp: "2026-02-16T11:00:00", logged_by: "Dicky", camp_id: "I-1", type: "health_issue", animal_id: "KO-007", details: JSON.stringify({ symptoms: ["Nasal discharge"], severity: "mild" }) },
  { observation_id: "OBS-019", timestamp: "2026-02-15T08:30:00", logged_by: "Dicky", camp_id: "Sirkel", type: "animal_movement", animal_id: "VS-028", details: JSON.stringify({ from_camp: "Sirkel", to_camp: "Teerlings" }) },
  { observation_id: "OBS-020", timestamp: "2026-02-14T09:15:00", logged_by: "Dicky", camp_id: "B4", type: "camp_check", grazing_quality: "Good", water_status: "Full", fence_status: "Intact" },
  { observation_id: "OBS-021", timestamp: "2026-02-13T08:00:00", logged_by: "Dicky", camp_id: "H", type: "health_issue", animal_id: "KO-241", details: JSON.stringify({ symptoms: ["Thin"], severity: "mild" }) },
  { observation_id: "OBS-022", timestamp: "2026-02-12T10:00:00", logged_by: "Dicky", camp_id: "A", type: "camp_condition", grazing_quality: "Fair", water_status: "Full", fence_status: "Intact" },
  { observation_id: "OBS-023", timestamp: "2026-02-11T08:45:00", logged_by: "Dicky", camp_id: "Everlyn", type: "reproduction", animal_id: "KO-308", details: JSON.stringify({ event: "calving_expected" }) },
  { observation_id: "OBS-024", timestamp: "2026-02-10T09:30:00", logged_by: "Dicky", camp_id: "B1", type: "camp_condition", grazing_quality: "Overgrazed", water_status: "Full", fence_status: "Intact" },
  { observation_id: "OBS-025", timestamp: "2026-02-09T08:00:00", logged_by: "Dicky", camp_id: "I-3", type: "health_issue", animal_id: "KO-095", details: JSON.stringify({ symptoms: ["Wound"], severity: "moderate" }) },
];

// ============================================================
// CALVING RECORDS (~40 records)
// ============================================================

export const CALVING_RECORDS: CalvingRecord[] = [
  { calving_id: "CALV-001", timestamp: "2026-02-20T06:30:00", mother_id: "KO-015", calf_id: "SK-159", calf_sex: "Female", calf_alive: true, ease_of_birth: "Unassisted", bull_id: "BU-003", camp_id: "I-1" },
  { calving_id: "CALV-002", timestamp: "2026-02-18T07:00:00", mother_id: "KO-042", calf_id: "SK-160", calf_sex: "Male", calf_alive: true, ease_of_birth: "Assisted", bull_id: "BU-007", camp_id: "I-3" },
  { calving_id: "CALV-003", timestamp: "2026-02-15T05:45:00", mother_id: "KO-088", calf_id: "SK-161", calf_sex: "Female", calf_alive: true, ease_of_birth: "Unassisted", camp_id: "A" },
  { calving_id: "CALV-004", timestamp: "2026-02-12T08:15:00", mother_id: "KO-110", calf_id: "SK-162", calf_sex: "Male", calf_alive: false, ease_of_birth: "Difficult", camp_id: "B" },
  { calving_id: "CALV-005", timestamp: "2026-02-10T06:00:00", mother_id: "KO-225", calf_id: "SK-163", calf_sex: "Female", calf_alive: true, ease_of_birth: "Unassisted", bull_id: "BU-001", camp_id: "H" },
  { calving_id: "CALV-006", timestamp: "2026-02-08T07:30:00", mother_id: "KO-310", calf_id: "SK-164", calf_sex: "Male", calf_alive: true, ease_of_birth: "Unassisted", camp_id: "Everlyn" },
  { calving_id: "CALV-007", timestamp: "2026-02-05T05:30:00", mother_id: "KO-007", calf_id: "SK-165", calf_sex: "Female", calf_alive: true, ease_of_birth: "Assisted", camp_id: "I-1" },
  { calving_id: "CALV-008", timestamp: "2026-01-30T06:45:00", mother_id: "KO-062", calf_id: "SK-166", calf_sex: "Male", calf_alive: true, ease_of_birth: "Unassisted", camp_id: "I-3" },
  { calving_id: "CALV-009", timestamp: "2026-01-25T07:00:00", mother_id: "KO-180", calf_id: "SK-167", calf_sex: "Female", calf_alive: true, ease_of_birth: "Unassisted", camp_id: "Uithoek" },
  { calving_id: "CALV-010", timestamp: "2026-01-20T05:15:00", mother_id: "KO-241", calf_id: "SK-168", calf_sex: "Male", calf_alive: true, ease_of_birth: "Unassisted", camp_id: "H" },
  { calving_id: "CALV-011", timestamp: "2026-01-15T08:00:00", mother_id: "KO-308", calf_id: "SK-169", calf_sex: "Female", calf_alive: true, ease_of_birth: "Unassisted", camp_id: "Everlyn" },
  { calving_id: "CALV-012", timestamp: "2026-01-10T06:30:00", mother_id: "KO-032", calf_id: "SK-170", calf_sex: "Male", calf_alive: true, ease_of_birth: "Unassisted", camp_id: "Bloukom" },
  { calving_id: "CALV-013", timestamp: "2025-12-28T07:15:00", mother_id: "KO-075", calf_id: "SK-171", calf_sex: "Female", calf_alive: true, ease_of_birth: "Assisted", camp_id: "I-1" },
  { calving_id: "CALV-014", timestamp: "2025-12-20T05:00:00", mother_id: "KO-055", calf_id: "SK-172", calf_sex: "Male", calf_alive: true, ease_of_birth: "Unassisted", camp_id: "A" },
  { calving_id: "CALV-015", timestamp: "2025-12-10T06:00:00", mother_id: "KO-195", calf_id: "SK-173", calf_sex: "Female", calf_alive: true, ease_of_birth: "Unassisted", camp_id: "Praalhoek" },
];

// ============================================================
// TREATMENTS (~30 records)
// ============================================================

export const TREATMENTS: Treatment[] = [
  { treatment_id: "TRT-001", timestamp: "2026-02-25T10:00:00", animal_id: "KO-088", treatment_type: "Antibiotic", product_name: "Terramycin", dosage: "5ml IM", withdrawal_days: 28, withdrawal_clear_date: "2026-03-25", administered_by: "Dicky" },
  { treatment_id: "TRT-002", timestamp: "2026-02-24T09:30:00", animal_id: "SK-089", treatment_type: "Antibiotic", product_name: "Liquamycin LA-200", dosage: "10ml SC", withdrawal_days: 28, withdrawal_clear_date: "2026-03-23", administered_by: "Dicky" },
  { treatment_id: "TRT-003", timestamp: "2026-02-20T08:00:00", animal_id: "BU-004", treatment_type: "Supplement", product_name: "Rumevite", dosage: "Free choice", administered_by: "Dicky" },
  { treatment_id: "TRT-004", timestamp: "2026-02-15T10:00:00", animal_id: "KO-225", treatment_type: "Supplement", product_name: "Multimin", dosage: "5ml IM", administered_by: "Dicky" },
  { treatment_id: "TRT-005", timestamp: "2026-02-10T09:00:00", animal_id: "KO-310", treatment_type: "Antibiotic", product_name: "Penicillin", dosage: "6ml IM", withdrawal_days: 14, withdrawal_clear_date: "2026-02-24", administered_by: "Dicky" },
  { treatment_id: "TRT-006", timestamp: "2026-02-01T08:00:00", animal_id: "KO-007", treatment_type: "Vaccination", product_name: "Covexin 8", dosage: "2ml SC", administered_by: "Luc" },
  { treatment_id: "TRT-007", timestamp: "2026-02-01T08:00:00", animal_id: "KO-042", treatment_type: "Vaccination", product_name: "Covexin 8", dosage: "2ml SC", administered_by: "Luc" },
  { treatment_id: "TRT-008", timestamp: "2026-01-28T09:00:00", animal_id: "KO-180", treatment_type: "Deworming", product_name: "Ivomec", dosage: "8ml SC", withdrawal_days: 35, withdrawal_clear_date: "2026-03-04", administered_by: "Dicky" },
  { treatment_id: "TRT-009", timestamp: "2026-01-20T10:00:00", animal_id: "KO-095", treatment_type: "Antibiotic", product_name: "Terramycin", dosage: "5ml IM", withdrawal_days: 28, withdrawal_clear_date: "2026-02-17", administered_by: "Dicky" },
  { treatment_id: "TRT-010", timestamp: "2026-01-15T08:30:00", animal_id: "SK-045", treatment_type: "Dip", product_name: "Triatix", dosage: "200L dip bath", administered_by: "Dicky" },
  { treatment_id: "TRT-011", timestamp: "2026-01-10T09:00:00", animal_id: "KO-241", treatment_type: "Supplement", product_name: "Multimin", dosage: "5ml IM", administered_by: "Dicky" },
  { treatment_id: "TRT-012", timestamp: "2025-12-20T08:00:00", animal_id: "BU-001", treatment_type: "Vaccination", product_name: "Vibrin", dosage: "2ml SC", administered_by: "Luc" },
  { treatment_id: "TRT-013", timestamp: "2025-12-20T08:00:00", animal_id: "BU-007", treatment_type: "Vaccination", product_name: "Vibrin", dosage: "2ml SC", administered_by: "Luc" },
  { treatment_id: "TRT-014", timestamp: "2025-12-15T10:00:00", animal_id: "KO-055", treatment_type: "Deworming", product_name: "Ivomec Plus", dosage: "10ml SC", withdrawal_days: 35, withdrawal_clear_date: "2026-01-19", administered_by: "Dicky" },
  { treatment_id: "TRT-015", timestamp: "2025-12-10T08:30:00", animal_id: "VS-015", treatment_type: "Vaccination", product_name: "Brucella RB51", dosage: "2ml SC", administered_by: "Luc" },
];
