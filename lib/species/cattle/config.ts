// lib/species/cattle/config.ts — Cattle species configuration
// Extracted from previously hardcoded values across the codebase

import type { SpeciesConfig } from "../types";

export const CATTLE_CONFIG: SpeciesConfig = {
  id: "cattle",
  label: "Cattle",
  pluralLabel: "Cattle",
  icon: "Beef",
  trackingMode: "individual",

  categories: [
    { value: "Cow", label: "Cow", sex: "Female", lsuEquivalent: 1.0, isYoung: false },
    { value: "Bull", label: "Bull", sex: "Male", lsuEquivalent: 1.5, isYoung: false },
    { value: "Heifer", label: "Heifer", sex: "Female", lsuEquivalent: 0.75, isYoung: true },
    { value: "Calf", label: "Calf", sex: "Any", lsuEquivalent: 0.25, isYoung: true },
    { value: "Ox", label: "Ox", sex: "Male", lsuEquivalent: 1.0, isYoung: false },
  ],

  gestationDays: 285,
  voluntaryWaitingDays: 45,
  estrusCycleDays: 21,

  reproEvents: [
    { value: "heat_detection", label: "Heat / Oestrus", icon: "Flame" },
    { value: "insemination", label: "Insemination", icon: "Syringe" },
    { value: "pregnancy_scan", label: "Pregnancy Scan", icon: "Search" },
    { value: "calving", label: "Calving", icon: "Baby" },
  ],
  birthEventType: "calving",

  observationTypes: [
    { value: "calving", label: "Calving", icon: "Baby", requiresAnimal: true, speciesExclusive: true },
    { value: "heat_detection", label: "Heat Detection", icon: "Flame", requiresAnimal: true, speciesExclusive: true },
    { value: "insemination", label: "Insemination", icon: "Syringe", requiresAnimal: true, speciesExclusive: true },
    { value: "pregnancy_scan", label: "Pregnancy Scan", icon: "Search", requiresAnimal: true, speciesExclusive: true },
    { value: "scrotal_circumference", label: "Scrotal Circumference", icon: "Ruler", requiresAnimal: true, speciesExclusive: true },
  ],

  defaultLsuValues: {
    Cow: 1.0,
    Bull: 1.5,
    Heifer: 0.75,
    Calf: 0.25,
    Ox: 1.0,
  },

  alertTypes: [
    "overdue-calvings",
    "calvings-due-7d",
    "calvings-due-14d",
    "open-cows",
    "poor-doers",
  ],
};
