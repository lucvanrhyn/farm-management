/**
 * __tests__/einstein/chunker-fixtures.ts
 *
 * Canonical golden input/output tuples for the deterministic chunker.
 * Each fixture specifies exactly what toEmbeddingText(input) must produce.
 * The chunker must match these sentence shapes byte-for-byte.
 *
 * IMPORTANT: fixture input rows use REAL Prisma schema field names
 * (`sizeHectares` not `sizeHa`, `dateOfBirth` not `dob`, `observedAt` not
 * `date`, `loggedBy` not `operator`, `recurrenceRule` not `frequencyDays`,
 * `message` not `body`/`title`, `payload` JSON for it3_snapshot). See
 * prisma/schema.prisma as the source of truth. Keeping fixtures in sync
 * with Prisma prevents the Wave 2A drift that shipped empty-ish chunks.
 */

import type { ChunkInput, RenderedChunk } from "@/lib/einstein/chunker";

// ---------------------------------------------------------------------------
// Shared base dates for deterministic sourceUpdatedAt in fixtures
// ---------------------------------------------------------------------------

const DATE_A = new Date("2026-01-15T10:00:00.000Z");
const DATE_B = new Date("2026-02-20T08:30:00.000Z");
const DATE_C = new Date("2026-03-10T14:00:00.000Z");

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function fixture(
  input: ChunkInput,
  expected: RenderedChunk[],
): { input: ChunkInput; expected: RenderedChunk[] } {
  return { input, expected };
}

// ---------------------------------------------------------------------------
// 1. Observations (3 fixtures)
// ---------------------------------------------------------------------------

// 1a. Full observation — weighing with all fields, denormalised animalName/species/breed/campName
export const obs_weighing_full = fixture(
  {
    entityType: "observation",
    entityId: "obs-001",
    row: {
      type: "WEIGHING",
      observedAt: "2026-01-15",
      campId: "camp-north",
      campName: "North Pasture",
      animalId: "animal-101",
      animalName: "Bella",
      species: "Cattle",
      breed: "Angus",
      details: "weight: 320kg",
      loggedBy: "Jan Botha",
      updatedAt: DATE_A,
    },
  },
  [
    {
      entityType: "observation",
      entityId: "obs-001",
      langTag: "en",
      text: "observation:WEIGHING @ 2026-01-15 — animal 'Bella' (Cattle, Angus, camp 'North Pasture'): weight: 320kg — by Jan Botha",
      sourceUpdatedAt: DATE_A,
    },
  ],
);

// 1b. Treatment observation — no loggedBy, no campName (falls back to campId)
export const obs_treatment_no_operator = fixture(
  {
    entityType: "observation",
    entityId: "obs-002",
    row: {
      type: "TREATMENT",
      observedAt: "2026-02-20",
      campId: "camp-south",
      animalId: "animal-202",
      animalName: "Rooibos",
      species: "Sheep",
      breed: "Merino",
      details: "ivermectin 1ml/10kg",
      updatedAt: DATE_B,
    },
  },
  [
    {
      entityType: "observation",
      entityId: "obs-002",
      langTag: "en",
      text: "observation:TREATMENT @ 2026-02-20 — animal 'Rooibos' (Sheep, Merino, camp camp-south): ivermectin 1ml/10kg",
      sourceUpdatedAt: DATE_B,
    },
  ],
);

// 1c. Pregnancy scan observation
export const obs_pregnancy_scan = fixture(
  {
    entityType: "observation",
    entityId: "obs-003",
    row: {
      type: "PREGNANCY_SCAN",
      observedAt: "2026-03-10",
      campId: "camp-east",
      campName: "East Paddock",
      animalId: "animal-303",
      animalName: "Lena",
      species: "Cattle",
      breed: "Hereford",
      details: "in-calf confirmed, 90 days",
      loggedBy: "Dr Smith",
      updatedAt: DATE_C,
    },
  },
  [
    {
      entityType: "observation",
      entityId: "obs-003",
      langTag: "en",
      text: "observation:PREGNANCY_SCAN @ 2026-03-10 — animal 'Lena' (Cattle, Hereford, camp 'East Paddock'): in-calf confirmed, 90 days — by Dr Smith",
      sourceUpdatedAt: DATE_C,
    },
  ],
);

// ---------------------------------------------------------------------------
// 2. Camps (2 fixtures)
// ---------------------------------------------------------------------------

// 2a. Full camp — real Prisma fields (sizeHectares, rotationNotes)
export const camp_full = fixture(
  {
    entityType: "camp",
    entityId: "camp-north",
    row: {
      campName: "North Pasture",
      sizeHectares: 45.5,
      veldType: "sweetveld",
      waterSource: "borehole",
      rotationNotes: "Good grazing after rain",
      updatedAt: DATE_A,
    },
  },
  [
    {
      entityType: "camp",
      entityId: "camp-north",
      langTag: "en",
      text: "camp — 'North Pasture' (45.5ha, sweetveld veld, borehole water): rotation notes: \"Good grazing after rain\"",
      sourceUpdatedAt: DATE_A,
    },
  ],
);

// 2b. Minimal camp — no rotation notes
export const camp_minimal = fixture(
  {
    entityType: "camp",
    entityId: "camp-south",
    row: {
      campName: "South Paddock",
      sizeHectares: 12,
      veldType: "sourveld",
      waterSource: "dam",
      rotationNotes: "",
      updatedAt: DATE_B,
    },
  },
  [
    {
      entityType: "camp",
      entityId: "camp-south",
      langTag: "en",
      text: "camp — 'South Paddock' (12ha, sourveld veld, dam water)",
      sourceUpdatedAt: DATE_B,
    },
  ],
);

// ---------------------------------------------------------------------------
// 3. Animals (2 fixtures)
// ---------------------------------------------------------------------------

// 3a. Animal with known mother — real Prisma fields (dateOfBirth, currentCamp)
export const animal_with_mother = fixture(
  {
    entityType: "animal",
    entityId: "animal-001",
    row: {
      animalId: "animal-001",
      name: "Bella",
      registrationNumber: "REG-2023-001",
      species: "Cattle",
      breed: "Angus",
      dateOfBirth: "2023-05-10",
      motherId: "animal-099",
      currentCamp: "camp-north",
      currentCampName: "North Pasture",
      status: "active",
      updatedAt: DATE_A,
    },
  },
  [
    {
      entityType: "animal",
      entityId: "animal-001",
      langTag: "en",
      text: "animal — 'Bella' REG-2023-001 (Cattle, Angus, born 2023-05-10): mother animal-099, currently camp 'North Pasture', status 'active'",
      sourceUpdatedAt: DATE_A,
    },
  ],
);

// 3b. Orphan animal — no mother, no camp name (falls back to currentCamp id)
export const animal_orphan = fixture(
  {
    entityType: "animal",
    entityId: "animal-002",
    row: {
      animalId: "animal-002",
      name: "Storm",
      registrationNumber: "REG-2024-007",
      species: "Sheep",
      breed: "Dorper",
      dateOfBirth: "2024-01-20",
      motherId: null,
      currentCamp: "camp-south",
      status: "active",
      updatedAt: DATE_B,
    },
  },
  [
    {
      entityType: "animal",
      entityId: "animal-002",
      langTag: "en",
      text: "animal — 'Storm' REG-2024-007 (Sheep, Dorper, born 2024-01-20): currently camp camp-south, status 'active'",
      sourceUpdatedAt: DATE_B,
    },
  ],
);

// ---------------------------------------------------------------------------
// 4. Tasks (2 fixtures)
// ---------------------------------------------------------------------------

// 4a. Cattle treatment task with description
export const task_cattle_treatment = fixture(
  {
    entityType: "task",
    entityId: "task-001",
    row: {
      taskType: "treatment",
      title: "Dip all cattle",
      dueDate: "2026-04-01",
      campId: "camp-north",
      status: "pending",
      description: "Use Triatix at 2ml/L",
      updatedAt: DATE_A,
    },
  },
  [
    {
      entityType: "task",
      entityId: "task-001",
      langTag: "en",
      text: "task:treatment — 'Dip all cattle' (due 2026-04-01, camp camp-north, status pending): Use Triatix at 2ml/L",
      sourceUpdatedAt: DATE_A,
    },
  ],
);

// 4b. Camp inspection task — no description
export const task_camp_inspection = fixture(
  {
    entityType: "task",
    entityId: "task-002",
    row: {
      taskType: "camp_inspection",
      title: "Check north fence line",
      dueDate: "2026-03-25",
      campId: "camp-north",
      status: "pending",
      description: "",
      updatedAt: DATE_B,
    },
  },
  [
    {
      entityType: "task",
      entityId: "task-002",
      langTag: "en",
      text: "task:camp_inspection — 'Check north fence line' (due 2026-03-25, camp camp-north, status pending)",
      sourceUpdatedAt: DATE_B,
    },
  ],
);

// ---------------------------------------------------------------------------
// 5. Task Templates (3 fixtures) — real Prisma fields (recurrenceRule)
// ---------------------------------------------------------------------------

// 5a. English-only template — 1 chunk
export const task_template_en_only = fixture(
  {
    entityType: "task_template",
    entityId: "tmpl-001",
    row: {
      name: "Annual vaccination",
      taskType: "vaccination",
      recurrenceRule: "FREQ=YEARLY",
      species: "cattle",
      name_af: null,
      updatedAt: DATE_A,
    },
  },
  [
    {
      entityType: "task_template",
      entityId: "tmpl-001",
      langTag: "en",
      text: "task_template — 'Annual vaccination' (vaccination, FREQ=YEARLY, species cattle)",
      sourceUpdatedAt: DATE_A,
    },
  ],
);

// 5b. Afrikaans-dual template — 2 chunks
export const task_template_dual = fixture(
  {
    entityType: "task_template",
    entityId: "tmpl-002",
    row: {
      name: "Dipping day",
      taskType: "dipping",
      recurrenceRule: "FREQ=WEEKLY;INTERVAL=2",
      species: "sheep",
      name_af: "Dompeldag",
      updatedAt: DATE_B,
    },
  },
  [
    {
      entityType: "task_template",
      entityId: "tmpl-002",
      langTag: "en",
      text: "task_template — 'Dipping day' (dipping, FREQ=WEEKLY;INTERVAL=2, species sheep)",
      sourceUpdatedAt: DATE_B,
    },
    {
      entityType: "task_template",
      entityId: "tmpl-002",
      langTag: "af",
      text: "task_template — 'Dompeldag' (dipping, FREQ=WEEKLY;INTERVAL=2, spesie sheep)",
      sourceUpdatedAt: DATE_B,
    },
  ],
);

// 5c. Another Afrikaans-dual — confirms same entity, 2 chunks
export const task_template_dual_anthrax = fixture(
  {
    entityType: "task_template",
    entityId: "tmpl-003",
    row: {
      name: "Anthrax vaccination",
      taskType: "vaccination",
      recurrenceRule: "FREQ=YEARLY",
      species: "cattle",
      name_af: "Miltsiekte-entstof",
      updatedAt: DATE_C,
    },
  },
  [
    {
      entityType: "task_template",
      entityId: "tmpl-003",
      langTag: "en",
      text: "task_template — 'Anthrax vaccination' (vaccination, FREQ=YEARLY, species cattle)",
      sourceUpdatedAt: DATE_C,
    },
    {
      entityType: "task_template",
      entityId: "tmpl-003",
      langTag: "af",
      text: "task_template — 'Miltsiekte-entstof' (vaccination, FREQ=YEARLY, spesie cattle)",
      sourceUpdatedAt: DATE_C,
    },
  ],
);

// ---------------------------------------------------------------------------
// 6. Notifications (2 fixtures) — real Prisma field (message, not body/title)
// ---------------------------------------------------------------------------

// 6a. SPI drought alert — severity + collapseKey
export const notification_spi_drought = fixture(
  {
    entityType: "notification",
    entityId: "notif-001",
    row: {
      type: "SPI_DROUGHT",
      message: "SPI below -1.5 at farm location — severe drought conditions detected.",
      severity: "red",
      createdAt: "2026-02-20",
      collapseKey: "farm:trio-b",
      updatedAt: DATE_B,
    },
  },
  [
    {
      entityType: "notification",
      entityId: "notif-001",
      langTag: "en",
      text: 'notification:SPI_DROUGHT [red] @ 2026-02-20 (scope: farm:trio-b): "SPI below -1.5 at farm location — severe drought conditions detected."',
      sourceUpdatedAt: DATE_B,
    },
  ],
);

// 6b. SARS IT3 reminder — no severity/collapseKey
export const notification_sars_it3 = fixture(
  {
    entityType: "notification",
    entityId: "notif-002",
    row: {
      type: "SARS_IT3_DEADLINE",
      message: "IT3 submission due 31 March",
      createdAt: "2026-03-10",
      updatedAt: DATE_C,
    },
  },
  [
    {
      entityType: "notification",
      entityId: "notif-002",
      langTag: "en",
      text: 'notification:SARS_IT3_DEADLINE @ 2026-03-10: "IT3 submission due 31 March"',
      sourceUpdatedAt: DATE_C,
    },
  ],
);

// ---------------------------------------------------------------------------
// 7. IT3 Snapshot (1 fixture) — real Prisma schema: payload JSON wraps totals
// ---------------------------------------------------------------------------

export const it3_snapshot = fixture(
  {
    entityType: "it3_snapshot",
    entityId: "it3-2025",
    row: {
      taxYear: 2025,
      periodStart: "2024-03-01",
      periodEnd: "2025-02-28",
      payload: JSON.stringify({
        totals: {
          grossIncome: 850000,
          deductions: 320000,
          netIncome: 530000,
        },
      }),
      issuedAt: DATE_A,
    },
  },
  [
    {
      entityType: "it3_snapshot",
      entityId: "it3-2025",
      langTag: "en",
      text: "it3_snapshot tax year 2025 (2024-03-01..2025-02-28) — gross income 850000, deductions 320000, net 530000 (per SARS schedule)",
      sourceUpdatedAt: DATE_A,
    },
  ],
);

// ---------------------------------------------------------------------------
// 8. Edge cases (5 fixtures)
// ---------------------------------------------------------------------------

// 8a. Missing optional observation fields (no breed, no loggedBy)
export const edge_obs_missing_optional = fixture(
  {
    entityType: "observation",
    entityId: "obs-edge-001",
    row: {
      type: "GENERAL",
      observedAt: "2026-01-01",
      campId: "camp-a",
      animalId: "animal-unknown",
      animalName: "Unknown",
      species: "Cattle",
      breed: null,
      details: "general check",
      updatedAt: DATE_A,
    },
  },
  [
    {
      entityType: "observation",
      entityId: "obs-edge-001",
      langTag: "en",
      text: "observation:GENERAL @ 2026-01-01 — animal 'Unknown' (Cattle, camp camp-a): general check",
      sourceUpdatedAt: DATE_A,
    },
  ],
);

// 8b. Camp with null rotationNotes — should skip rotation-notes clause
export const edge_camp_null_notes = fixture(
  {
    entityType: "camp",
    entityId: "camp-edge-001",
    row: {
      campName: "Bare Paddock",
      sizeHectares: 5,
      veldType: "mixedveld",
      waterSource: "river",
      rotationNotes: null,
      updatedAt: DATE_B,
    },
  },
  [
    {
      entityType: "camp",
      entityId: "camp-edge-001",
      langTag: "en",
      text: "camp — 'Bare Paddock' (5ha, mixedveld veld, river water)",
      sourceUpdatedAt: DATE_B,
    },
  ],
);

// 8c. Task template with empty string name_af — treated as no Afrikaans, 1 chunk only
export const edge_template_empty_af = fixture(
  {
    entityType: "task_template",
    entityId: "tmpl-edge-001",
    row: {
      name: "Fire break inspection",
      taskType: "fire_break_maintenance",
      recurrenceRule: "FREQ=YEARLY;BYMONTH=4",
      species: null,
      name_af: "",
      updatedAt: DATE_C,
    },
  },
  [
    {
      entityType: "task_template",
      entityId: "tmpl-edge-001",
      langTag: "en",
      text: "task_template — 'Fire break inspection' (fire_break_maintenance, FREQ=YEARLY;BYMONTH=4)",
      sourceUpdatedAt: DATE_C,
    },
  ],
);

// 8d. Very long observation details (>400 tokens worth of text) — still 1 chunk
const LONG_DETAILS = "A".repeat(1800); // ~450 tokens equivalent
export const edge_obs_very_long_text = fixture(
  {
    entityType: "observation",
    entityId: "obs-edge-long",
    row: {
      type: "TREATMENT",
      observedAt: "2026-01-10",
      campId: "camp-x",
      animalId: "animal-big",
      animalName: "BigText",
      species: "Cattle",
      breed: "Angus",
      details: LONG_DETAILS,
      updatedAt: DATE_A,
    },
  },
  [
    {
      entityType: "observation",
      entityId: "obs-edge-long",
      langTag: "en",
      text: `observation:TREATMENT @ 2026-01-10 — animal 'BigText' (Cattle, Angus, camp camp-x): ${LONG_DETAILS}`,
      sourceUpdatedAt: DATE_A,
    },
  ],
);

// 8e. Animal with createdAt fallback (no updatedAt)
export const edge_animal_created_at_fallback = fixture(
  {
    entityType: "animal",
    entityId: "animal-edge-001",
    row: {
      animalId: "animal-edge-001",
      name: "Sprout",
      registrationNumber: "REG-EDGE-01",
      species: "Goat",
      breed: "Boer",
      dateOfBirth: "2025-06-01",
      motherId: null,
      currentCamp: "camp-z",
      status: "active",
      // no updatedAt — use createdAt as fallback
      createdAt: DATE_C,
    },
  },
  [
    {
      entityType: "animal",
      entityId: "animal-edge-001",
      langTag: "en",
      text: "animal — 'Sprout' REG-EDGE-01 (Goat, Boer, born 2025-06-01): currently camp camp-z, status 'active'",
      sourceUpdatedAt: DATE_C,
    },
  ],
);

// ---------------------------------------------------------------------------
// Exported collection for parameterised tests
// ---------------------------------------------------------------------------

export const ALL_FIXTURES = [
  obs_weighing_full,
  obs_treatment_no_operator,
  obs_pregnancy_scan,
  camp_full,
  camp_minimal,
  animal_with_mother,
  animal_orphan,
  task_cattle_treatment,
  task_camp_inspection,
  task_template_en_only,
  task_template_dual,
  task_template_dual_anthrax,
  notification_spi_drought,
  notification_sars_it3,
  it3_snapshot,
  edge_obs_missing_optional,
  edge_camp_null_notes,
  edge_template_empty_af,
  edge_obs_very_long_text,
  edge_animal_created_at_fallback,
];
