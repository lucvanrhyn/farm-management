// ============================================================
// Enums
// ============================================================

export type AnimalSex = "Male" | "Female";

// Category is a string to support species-specific categories:
// Cattle: "Cow" | "Bull" | "Heifer" | "Calf" | "Ox"
// Sheep: "Ewe" | "Ram" | "Wether" | "Hogget" | "Lamb" | "Maiden Ewe" | "Ewe Lamb"
// Game: "Adult Male" | "Adult Female" | "Sub-adult" | "Juvenile"
export type AnimalCategory = string;

export type AnimalStatus = "Active" | "Sold" | "Deceased";

export type GrazingQuality = "Good" | "Fair" | "Poor" | "Overgrazed";

export type WaterStatus = "Full" | "Low" | "Empty" | "Broken";

export type FenceStatus = "Intact" | "Damaged";

export type ObservationType =
  // Shared
  | "camp_check"
  | "animal_movement"
  | "health_issue"
  | "reproduction"
  | "death"
  | "treatment"
  | "camp_condition"
  | "weighing"
  | "mob_movement"
  | "body_condition_score"
  | "temperament_score"
  // Cattle-specific
  | "calving"
  | "heat_detection"
  | "insemination"
  | "pregnancy_scan"
  | "scrotal_circumference"
  // Sheep-specific
  | "lambing"
  | "joining"
  | "shearing"
  | "predation_loss"
  | "dosing"
  | "fostering"
  | "famacha"
  // Game-specific
  | "census"
  | "hunt_record"
  | "game_mortality"
  | "game_predation"
  | "game_introduction"
  | "water_point_check"
  | "veld_assessment"
  | "fence_inspection";

export type TreatmentType =
  | "Vaccination"
  | "Deworming"
  | "Antibiotic"
  | "Dip"
  | "Supplement"
  | "Other";

export type EaseOfBirth = "Unassisted" | "Assisted" | "Difficult";

export type UserRole = "LOGGER" | "DASHBOARD" | "ADMIN";

// ============================================================
// Data Models (mirror Google Sheets tables)
// ============================================================

export interface Animal {
  animal_id: string;           // e.g. "BX-042"
  name?: string;
  sex: AnimalSex;
  date_of_birth?: string;      // ISO date string
  breed: string;               // "Brangus" | other
  category: AnimalCategory;
  current_camp: string;        // camp_id
  status: AnimalStatus;
  species?: string;            // "cattle" | "sheep" | "game" — defaults to "cattle"
  mother_id?: string;          // animal_id of mother
  father_id?: string;          // animal_id of sire
  mob_id?: string;             // mob this animal belongs to
  registration_number?: string; // SA Studbook or breed society number
  date_added: string;          // ISO date string
}

export interface Mob {
  id: string;
  name: string;
  current_camp: string;
  animal_count?: number;
}

export interface Camp {
  camp_id: string;
  camp_name: string;           // e.g. "Rivier", "Koppie"
  size_hectares?: number;
  water_source?: string;       // "borehole" | "dam" | "river" | "trough"
  geojson?: string;            // GeoJSON polygon coordinates (stringified)
  color?: string;              // Hex identity color for this camp (e.g. "#2563EB")
  species?: string;            // "cattle" | "sheep" | "game" — denormalised from prisma.camp.species (NOT NULL per migrations 0010/0011). Threaded through the cached Camp DTO so client surfaces (dashboard map) can filter by FarmMode without a second Prisma round-trip. Optional for back-compat with hand-built Camp instances missing the column.
  // Live condition fields — populated from IndexedDB after logger observations
  grazing_quality?: GrazingQuality;
  water_status?: WaterStatus;
  fence_status?: FenceStatus;
  last_inspected_at?: string;  // ISO datetime string
  last_inspected_by?: string;
  animal_count?: number;       // populated from /api/camps (Prisma count)
}

export interface Observation {
  observation_id: string;
  timestamp: string;           // ISO datetime string
  logged_by: string;           // e.g. "Dicky"
  camp_id: string;
  type: ObservationType;
  animal_id?: string;
  details?: string;            // JSON string with type-specific extra data
  grazing_quality?: GrazingQuality;
  water_status?: WaterStatus;
  fence_status?: FenceStatus;
}

export interface CalvingRecord {
  calving_id: string;
  timestamp: string;           // ISO datetime string
  mother_id: string;
  calf_id: string;
  calf_sex: AnimalSex;
  calf_alive: boolean;
  ease_of_birth: EaseOfBirth;
  bull_id?: string;
  camp_id: string;
}

export interface Treatment {
  treatment_id: string;
  timestamp: string;           // ISO datetime string
  animal_id: string;
  treatment_type: TreatmentType;
  product_name: string;
  dosage?: string;
  withdrawal_days?: number;
  withdrawal_clear_date?: string;  // ISO date string (timestamp + withdrawal_days)
  administered_by: string;
}

export interface DailyCampLog {
  log_id: string;
  date: string;                // ISO date string
  camp_id: string;
  inspected_by: string;
  animal_count?: number;
  grazing_quality?: GrazingQuality;
  water_status?: WaterStatus;
  fence_status?: FenceStatus;
  rainfall_mm?: number;
}

export interface CampStats {
  total: number;
  byCategory: Partial<Record<AnimalCategory, number>>;
}

// Mirrors the Prisma Observation model (camelCase) — returned by /api/observations
export interface PrismaObservation {
  id: string;
  type: ObservationType;
  campId: string;
  animalId: string | null;
  details: string;
  observedAt: string;
  createdAt: string;
  loggedBy: string | null;
  editedBy: string | null;
  editedAt: string | null;
  editHistory: string | null;
  attachmentUrl: string | null;
}

// Mirrors the Prisma Animal model (camelCase) — returned by /api/animals
export interface PrismaAnimal {
  id: string;
  animalId: string;
  name: string | null;
  sex: string;
  dateOfBirth: string | null;
  breed: string;
  category: AnimalCategory;
  currentCamp: string;
  status: AnimalStatus;
  species: string;
  motherId: string | null;
  fatherId: string | null;
  mobId: string | null;
  registrationNumber: string | null;
  dateAdded: string;
  deceasedAt: string | null;
  createdAt: string;
}
