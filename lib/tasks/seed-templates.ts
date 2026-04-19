/**
 * lib/tasks/seed-templates.ts
 *
 * Static SA-native seed template bank for FarmTrack Phase K.
 * All 20 templates from the design doc §D.
 *
 * Usage: imported by app/api/task-templates/install/route.ts
 * to upsert templates for a tenant on demand.
 *
 * No DB imports, no env reads — pure static data.
 */

// ── Type ──────────────────────────────────────────────────────────────────────

export interface SeedTemplate {
  name: string;
  name_af: string;
  taskType: string;
  description?: string;
  description_af?: string;
  priorityDefault: "low" | "medium" | "high";
  recurrenceRule?: string;
  reminderOffset?: number; // minutes
  species?: string | null;
  isPublic: true;
}

// ── Seed data ─────────────────────────────────────────────────────────────────

export const SEED_TEMPLATES: SeedTemplate[] = [
  // 1. Dip day — cattle
  {
    name: "Dip day — cattle",
    name_af: "Dipdag — beeste",
    taskType: "dipping",
    description: "Tick and external parasite control dip for cattle herd.",
    description_af: "Bos- en ektoparasietbeheer-dip vir beeskudde.",
    priorityDefault: "medium",
    recurrenceRule: "season:spring_autumn_dip",
    reminderOffset: 1440, // 24h
    species: null,
    isPublic: true,
  },

  // 2. Brucellosis test — breeding heifers
  {
    name: "Brucellosis test — breeding heifers",
    name_af: "Brucellose-toets — verse",
    taskType: "brucellosis_test",
    description: "Annual brucellosis (S19/RB51) test for breeding heifers. Statutory requirement.",
    description_af: "Jaarlikse brucellose-toets vir teelverse. Statutêre vereiste.",
    priorityDefault: "high",
    recurrenceRule: "FREQ=YEARLY;BYMONTH=6;BYMONTHDAY=1",
    reminderOffset: 10080, // 7 days
    species: null,
    isPublic: true,
  },

  // 3. Tuberculosis test — dairy
  {
    name: "Tuberculosis test — dairy",
    name_af: "TB-toets — melkbeeste",
    taskType: "treatment",
    description: "Annual tuberculin skin test for dairy herd. OIE/DAFF requirement.",
    description_af: "Jaarlikse tuberkulienhuidtoets vir melkkudde. OIE/DAFF-vereiste.",
    priorityDefault: "high",
    recurrenceRule: "FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=1",
    reminderOffset: 10080, // 7 days
    species: null,
    isPublic: true,
  },

  // 4. Shearing — Dohne Merino
  {
    name: "Shearing — Dohne Merino",
    name_af: "Skeer — Dohne Merino",
    taskType: "shearing",
    description: "Full shearing cycle for Dohne Merino sheep — every 8 months.",
    description_af: "Volle skeeriklus vir Dohne Merino skape — elke 8 maande.",
    priorityDefault: "medium",
    recurrenceRule: "FREQ=MONTHLY;INTERVAL=8",
    reminderOffset: 20160, // 14 days
    species: "sheep",
    isPublic: true,
  },

  // 5. Crutching — pre-lambing
  {
    name: "Crutching — pre-lambing",
    name_af: "Kuiltjies skeer — voor lamseisoen",
    taskType: "shearing",
    description: "Crutch ewes 30 days before lambing to improve hygiene and lamb identification.",
    description_af: "Skeer ooie 30 dae voor lamseisoen vir higiëne en lamidentifikasie.",
    priorityDefault: "medium",
    recurrenceRule: "before:lambing-30d",
    reminderOffset: 4320, // 3 days
    species: "sheep",
    isPublic: true,
  },

  // 6. Anthrax vax — KZN/Limpopo
  {
    name: "Anthrax vax — KZN/Limpopo",
    name_af: "Miltsiekte-inenting",
    taskType: "vaccination",
    description: "Annual anthrax vaccination. Compulsory in KZN and Limpopo red-line areas.",
    description_af: "Jaarlikse miltsiektevasinasie. Verpligtend in KZN en Limpopo-rooilyngebiede.",
    priorityDefault: "high",
    recurrenceRule: "FREQ=YEARLY;BYMONTH=8",
    reminderOffset: 10080, // 7 days
    species: null,
    isPublic: true,
  },

  // 7. RVF vax
  {
    name: "RVF vax",
    name_af: "Rift-vallei-koors-inenting",
    taskType: "vaccination",
    description: "Annual Rift Valley Fever vaccination before rainy season.",
    description_af: "Jaarlikse Rift-vallei-koorsvasinasie voor reënseisoen.",
    priorityDefault: "high",
    recurrenceRule: "FREQ=YEARLY;BYMONTH=9",
    reminderOffset: 10080, // 7 days
    species: null,
    isPublic: true,
  },

  // 8. Lumpy Skin vax
  {
    name: "Lumpy Skin vax",
    name_af: "Knopvelsiekte-inenting",
    taskType: "vaccination",
    description: "Annual Lumpy Skin Disease vaccination for cattle.",
    description_af: "Jaarlikse knopvelsiektevasinasie vir beeste.",
    priorityDefault: "medium",
    recurrenceRule: "FREQ=YEARLY;BYMONTH=7;BYMONTHDAY=1",
    reminderOffset: 10080, // 7 days
    species: null,
    isPublic: true,
  },

  // 9. Bluetongue vax — sheep
  {
    name: "Bluetongue vax — sheep",
    name_af: "Bloutong-inenting",
    taskType: "vaccination",
    description: "Annual Bluetongue vaccination for sheep — multiple serotypes.",
    description_af: "Jaarlikse bloutongvasinasie vir skape — verskeie serotipes.",
    priorityDefault: "medium",
    recurrenceRule: "FREQ=YEARLY;BYMONTH=5;BYMONTHDAY=1",
    reminderOffset: 10080, // 7 days
    species: "sheep",
    isPublic: true,
  },

  // 10. Pregnancy scan — beef herd
  {
    name: "Pregnancy scan — beef herd",
    name_af: "Dragtigheidskandering",
    taskType: "pregnancy_scan",
    description: "Ultrasound pregnancy scan 45 days after mating start for beef cows.",
    description_af: "Ultraklank-dragtigheidskandering 45 dae na paarseisoen vir vleisbeeste.",
    priorityDefault: "medium",
    recurrenceRule: "after:mating_start+45d",
    reminderOffset: 4320, // 3 days
    species: null,
    isPublic: true,
  },

  // 11. Weaning — beef calves
  {
    name: "Weaning — beef calves",
    name_af: "Speentyd — kalwers",
    taskType: "weighing",
    description: "Weaning weigh-off for beef calves at 210 days after calving.",
    description_af: "Speenmassa vir vleiskalwers op 210 dae na kalf.",
    priorityDefault: "medium",
    recurrenceRule: "after:calving+210d",
    reminderOffset: 4320, // 3 days
    species: null,
    isPublic: true,
  },

  // 12. Rainfall log
  {
    name: "Rainfall log",
    name_af: "Reënmeter-opname",
    taskType: "rainfall_reading",
    description: "Weekly Monday morning rainfall gauge reading at 07:00.",
    description_af: "Weeklikse Maandagoggend reënmeteraflesing om 07:00.",
    priorityDefault: "low",
    recurrenceRule: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=7",
    reminderOffset: 0,
    species: null,
    isPublic: true,
  },

  // 13. Veld inspection
  {
    name: "Veld inspection",
    name_af: "Veldinspeksie",
    taskType: "camp_inspection",
    description: "Veld condition inspection every 21 days — grazing quality, cover, erosion.",
    description_af: "Veldtoestand inspeksie elke 21 dae — weidingsgehalte, bedekking, erosie.",
    priorityDefault: "medium",
    recurrenceRule: "FREQ=DAILY;INTERVAL=21",
    reminderOffset: 1440, // 1 day
    species: null,
    isPublic: true,
  },

  // 14. Water-point service
  {
    name: "Water-point service",
    name_af: "Drinkpunt-diens",
    taskType: "water_point_service",
    description: "Monthly water trough and pump inspection and cleaning.",
    description_af: "Maandelikse drinkbak- en pompinspeksie en skoonmaak.",
    priorityDefault: "medium",
    recurrenceRule: "FREQ=DAILY;INTERVAL=30",
    reminderOffset: 2880, // 2 days
    species: null,
    isPublic: true,
  },

  // 15. Fence inspection — game fence
  {
    name: "Fence inspection — game fence",
    name_af: "Wildheining-inspeksie",
    taskType: "fence_repair",
    description: "Bi-weekly game fence integrity check — electrification, droppers, gates.",
    description_af: "Tweewekelijkse wildheininginspeksie — elektrifisering, afsetters, hekke.",
    priorityDefault: "medium",
    recurrenceRule: "FREQ=DAILY;INTERVAL=14",
    reminderOffset: 1440, // 1 day
    species: "game",
    isPublic: true,
  },

  // 16. Fire break — pre-fire-season
  {
    name: "Fire break — pre-fire-season",
    name_af: "Brandpaad — voor-seisoen",
    taskType: "fire_break_maintenance",
    description: "Clear and maintain fire breaks before the dry fire season (April).",
    description_af: "Sny en onderhou brandpaaie voor die droë brandseisoen (April).",
    priorityDefault: "high",
    recurrenceRule: "FREQ=YEARLY;BYMONTH=4",
    reminderOffset: 20160, // 14 days
    species: null,
    isPublic: true,
  },

  // 17. Fire break — post-fire-season
  {
    name: "Fire break — post-fire-season",
    name_af: "Brandpaad — na-seisoen",
    taskType: "fire_break_maintenance",
    description: "Post-season fire break inspection and repair (October).",
    description_af: "Na-seisoen brandpaadins inspeksie en herstel (Oktober).",
    priorityDefault: "medium",
    recurrenceRule: "FREQ=YEARLY;BYMONTH=10",
    reminderOffset: 10080, // 7 days
    species: null,
    isPublic: true,
  },

  // 18. SARS IT3-C prep
  {
    name: "SARS IT3-C prep",
    name_af: "SARS IT3-C voorbereiding",
    taskType: "generic",
    description: "Annual IT3-C tax certificate preparation for livestock income (February).",
    description_af: "Jaarlikse IT3-C belastingsertifikaatvoorbereiding vir veeinkome (Februarie).",
    priorityDefault: "medium",
    recurrenceRule: "FREQ=YEARLY;BYMONTH=2",
    reminderOffset: 43200, // 30 days
    species: null,
    isPublic: true,
  },

  // 19. VAT201 submission
  {
    name: "VAT201 submission",
    name_af: "BTW201-indiening",
    taskType: "generic",
    description: "Monthly VAT201 return submission — due by 25th of each month.",
    description_af: "Maandelikse BTW201-opgawe-indiening — verskuldig voor die 25ste.",
    priorityDefault: "medium",
    recurrenceRule: "FREQ=MONTHLY;BYMONTHDAY=25",
    reminderOffset: 4320, // 3 days
    species: null,
    isPublic: true,
  },

  // 20. RMIS herd declaration refresh
  {
    name: "RMIS herd declaration refresh",
    name_af: "RMIS kudde-verklaring hernu",
    taskType: "generic",
    description:
      "Annual RMIS herd declaration renewal — required for movement certificates (April).",
    description_af:
      "Jaarlikse RMIS-kudde-verklaring hernuwing — vereiste vir bewegingssertifikate (April).",
    priorityDefault: "high",
    recurrenceRule: "FREQ=YEARLY;BYMONTH=4",
    reminderOffset: 20160, // 14 days
    species: null,
    isPublic: true,
  },
];
