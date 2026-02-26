// Google Sheets API client — not yet implemented.
// Will use the Google Sheets API (googleapis package) to read/write farm data.
// Credentials: GOOGLE_SHEETS_ID, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY (from .env.local)

import { Animal, Camp, Observation, CalvingRecord, Treatment, DailyCampLog } from "./types";

// Stub functions — replace with real implementations in Phase 1

export async function getAnimals(): Promise<Animal[]> {
  throw new Error("getAnimals: Google Sheets integration not yet implemented");
}

export async function getCamps(): Promise<Camp[]> {
  throw new Error("getCamps: Google Sheets integration not yet implemented");
}

export async function getObservations(_campId?: string): Promise<Observation[]> {
  throw new Error("getObservations: Google Sheets integration not yet implemented");
}

export async function appendObservation(_observation: Omit<Observation, "observation_id">): Promise<void> {
  throw new Error("appendObservation: Google Sheets integration not yet implemented");
}

export async function getCalvingRecords(_motherId?: string): Promise<CalvingRecord[]> {
  throw new Error("getCalvingRecords: Google Sheets integration not yet implemented");
}

export async function getTreatments(_animalId?: string): Promise<Treatment[]> {
  throw new Error("getTreatments: Google Sheets integration not yet implemented");
}

export async function getDailyCampLogs(_campId?: string): Promise<DailyCampLog[]> {
  throw new Error("getDailyCampLogs: Google Sheets integration not yet implemented");
}
