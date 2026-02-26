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
  | "death"
  | "treatment"
  | "camp_condition";

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
  notes?: string;
  date_added: string;          // ISO date string
}

export interface Camp {
  camp_id: string;
  camp_name: string;           // e.g. "Rivier", "Koppie"
  size_hectares?: number;
  water_source?: string;       // "borehole" | "dam" | "river" | "trough"
  geojson?: string;            // GeoJSON polygon coordinates (stringified)
  notes?: string;
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
  notes?: string;
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
  notes?: string;
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
  notes?: string;
}
