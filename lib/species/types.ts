// lib/species/types.ts — Shared interfaces for the multi-species module system

import type { PrismaClient } from "@prisma/client";

// ── Species Identity ────────────────────────────────────────────────────────

export type SpeciesId = "cattle" | "sheep" | "game";

export type TrackingMode = "individual" | "population";

// ── Category Definitions ────────────────────────────────────────────────────

export interface AnimalCategoryDef {
  value: string;
  label: string;
  sex: "Male" | "Female" | "Any";
  lsuEquivalent: number;
  isYoung: boolean;
}

// ── Observation Type Definitions ────────────────────────────────────────────

export interface ObservationTypeDef {
  value: string;
  label: string;
  icon: string;
  requiresAnimal: boolean;
  speciesExclusive: boolean;
}

// ── Reproduction Event Definitions ──────────────────────────────────────────

export interface ReproEventDef {
  value: string;
  label: string;
  icon: string;
}

// ── Species Configuration (Static) ──────────────────────────────────────────

export interface SpeciesConfig {
  id: SpeciesId;
  label: string;
  pluralLabel: string;
  icon: string;
  trackingMode: TrackingMode;

  categories: AnimalCategoryDef[];

  gestationDays: number;
  voluntaryWaitingDays: number;
  estrusCycleDays: number;
  reproEvents: ReproEventDef[];
  birthEventType: string;

  observationTypes: ObservationTypeDef[];

  defaultLsuValues: Record<string, number>;

  alertTypes: string[];
}

// ── Reproduction Stats (Runtime) ────────────────────────────────────────────

export interface UpcomingBirth {
  animalId: string;
  campId: string;
  campName: string;
  expectedDate: Date;
  daysAway: number;
  source: "scan" | "insemination" | "mating" | "joining";
}

export interface SpeciesReproStats {
  pregnancyRate: number | null;
  birthRate: number | null;
  avgBirthIntervalDays: number | null;
  upcomingBirths: UpcomingBirth[];
  [key: string]: unknown;
}

// ── Dashboard Data (Runtime) ────────────────────────────────────────────────

export interface SpeciesDashboardData {
  totalCount: number;
  activeCount: number;
  byCategory: Record<string, number>;
  byCamp: Record<string, number>;
  reproStats: SpeciesReproStats | null;
  speciesSpecific: Record<string, unknown>;
}

// ── Alerts (Runtime) ────────────────────────────────────────────────────────

export interface SpeciesAlert {
  id: string;
  severity: "red" | "amber";
  icon: string;
  message: string;
  count: number;
  href: string;
}

// ── Species Module Interface ────────────────────────────────────────────────

export interface SpeciesModule {
  readonly config: SpeciesConfig;

  getDashboardData(prisma: PrismaClient): Promise<SpeciesDashboardData>;
  getReproStats(prisma: PrismaClient): Promise<SpeciesReproStats>;
  getAlerts(
    prisma: PrismaClient,
    farmSlug: string,
    thresholds: Record<string, number>,
  ): Promise<SpeciesAlert[]>;

  getLsuValues(farmOverrides?: Record<string, number>): Record<string, number>;

  validateCategory(category: string): boolean;
  validateObservationType(type: string): boolean;
}

// ── Shared Observation Types (available to all species) ─────────────────────

export const SHARED_OBSERVATION_TYPES: ObservationTypeDef[] = [
  { value: "camp_check", label: "Camp Check", icon: "ClipboardCheck", requiresAnimal: false, speciesExclusive: false },
  { value: "camp_condition", label: "Camp Condition", icon: "Tent", requiresAnimal: false, speciesExclusive: false },
  { value: "health_issue", label: "Health Issue", icon: "HeartPulse", requiresAnimal: true, speciesExclusive: false },
  { value: "animal_movement", label: "Animal Movement", icon: "ArrowRightLeft", requiresAnimal: true, speciesExclusive: false },
  { value: "treatment", label: "Treatment", icon: "Pill", requiresAnimal: true, speciesExclusive: false },
  { value: "weighing", label: "Weighing", icon: "Scale", requiresAnimal: true, speciesExclusive: false },
  { value: "death", label: "Death", icon: "Skull", requiresAnimal: true, speciesExclusive: false },
  { value: "reproduction", label: "Reproduction", icon: "Baby", requiresAnimal: true, speciesExclusive: false },
  { value: "mob_movement", label: "Mob Movement", icon: "Users", requiresAnimal: false, speciesExclusive: false },
  { value: "body_condition_score", label: "Body Condition Score", icon: "Activity", requiresAnimal: true, speciesExclusive: false },
  { value: "temperament_score", label: "Temperament Score", icon: "Gauge", requiresAnimal: true, speciesExclusive: false },
];
