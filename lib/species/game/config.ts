// lib/species/game/config.ts — Game species configuration

import type { SpeciesConfig } from "../types";

export const GAME_CONFIG: SpeciesConfig = {
  id: "game",
  label: "Game",
  pluralLabel: "Game",
  icon: "Target",
  trackingMode: "population",

  // Game doesn't use individual animal categories in the same way.
  // These represent the broad classification used for rare individually-tracked game.
  categories: [
    { value: "Adult Male", label: "Adult Male", sex: "Male", lsuEquivalent: 1.0, isYoung: false },
    { value: "Adult Female", label: "Adult Female", sex: "Female", lsuEquivalent: 1.0, isYoung: false },
    { value: "Sub-adult", label: "Sub-adult", sex: "Any", lsuEquivalent: 0.5, isYoung: true },
    { value: "Juvenile", label: "Juvenile", sex: "Any", lsuEquivalent: 0.3, isYoung: true },
  ],

  // Game doesn't track individual reproduction — these are informational only
  gestationDays: 0,
  voluntaryWaitingDays: 0,
  estrusCycleDays: 0,
  reproEvents: [],
  birthEventType: "",

  observationTypes: [
    { value: "census", label: "Census Count", icon: "ClipboardList", requiresAnimal: false, speciesExclusive: true },
    { value: "hunt_record", label: "Hunt Record", icon: "Target", requiresAnimal: false, speciesExclusive: true },
    { value: "game_mortality", label: "Mortality Event", icon: "Skull", requiresAnimal: false, speciesExclusive: true },
    { value: "game_predation", label: "Predation Event", icon: "AlertTriangle", requiresAnimal: false, speciesExclusive: true },
    { value: "game_introduction", label: "Introduction/Removal", icon: "Truck", requiresAnimal: false, speciesExclusive: true },
    { value: "water_point_check", label: "Water Point Check", icon: "Droplet", requiresAnimal: false, speciesExclusive: true },
    { value: "veld_assessment", label: "Veld Assessment", icon: "TreePine", requiresAnimal: false, speciesExclusive: true },
    { value: "fence_inspection", label: "Fence Inspection", icon: "Fence", requiresAnimal: false, speciesExclusive: true },
  ],

  // Game LSU values are per-species (impala=0.13, kudu=0.40, etc.)
  // These are not used via the category system — they live in GameSpecies table.
  // This map is a fallback for the rare individually-tracked game animals.
  defaultLsuValues: {
    "Adult Male": 1.0,
    "Adult Female": 1.0,
    "Sub-adult": 0.5,
    "Juvenile": 0.3,
  },

  alertTypes: [
    "carrying-capacity-exceeded",
    "carrying-capacity-warning",
    "quota-exceeded",
    "quota-warning",
    "census-overdue",
    "population-declining",
    "species-below-target",
    "water-point-offline",
    "water-point-low",
    "permit-expired",
    "permit-expiring",
    "predation-spike",
    "fence-critical",
    "infrastructure-poor",
    "maintenance-overdue",
    "veld-poor",
  ],
};
