// ============================================================
// Enums
// ============================================================

export type AnimalSex = "Male" | "Female";

export type AnimalCategory = "Cow" | "Bull" | "Heifer" | "Calf" | "Ox";

export type AnimalStatus = "Active" | "Sold" | "Deceased";

export type GrazingQuality = "Good" | "Fair" | "Poor" | "Overgrazed";

export type WaterStatus = "Full" | "Low" | "Empty" | "Broken";

export type FenceStatus = "Intact" | "Damaged";

export type ObservationType =
  | "camp_check"
  | "animal_movement"
  | "health_issue"
  | "reproduction"
  | "calving"
  | "death"
  | "treatment"
  | "camp_condition"
  | "weighing"
  | "heat_detection"
  | "insemination"
  | "pregnancy_scan";

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
  mother_id?: string;          // animal_id of mother
  father_id?: string;          // animal_id of sire
  registration_number?: string; // SA Studbook or breed society number
  date_added: string;          // ISO date string
}

export interface Camp {
  camp_id: string;
  camp_name: string;           // e.g. "Rivier", "Koppie"
  size_hectares?: number;
  water_source?: string;       // "borehole" | "dam" | "river" | "trough"
  geojson?: string;            // GeoJSON polygon coordinates (stringified)
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
  motherId: string | null;
  fatherId: string | null;
  registrationNumber: string | null;
  dateAdded: string;
  deceasedAt: string | null;
  createdAt: string;
}
