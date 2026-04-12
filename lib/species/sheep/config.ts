// lib/species/sheep/config.ts — Sheep species configuration

import type { SpeciesConfig } from "../types";

export const SHEEP_CONFIG: SpeciesConfig = {
  id: "sheep",
  label: "Sheep",
  pluralLabel: "Sheep",
  icon: "Rabbit", // closest lucide icon; can use custom SVG later
  trackingMode: "individual",

  categories: [
    { value: "Ewe", label: "Ewe", sex: "Female", lsuEquivalent: 0.17, isYoung: false },
    { value: "Ram", label: "Ram", sex: "Male", lsuEquivalent: 0.20, isYoung: false },
    { value: "Wether", label: "Wether", sex: "Male", lsuEquivalent: 0.15, isYoung: false },
    { value: "Hogget", label: "Hogget", sex: "Any", lsuEquivalent: 0.13, isYoung: true },
    { value: "Lamb", label: "Lamb", sex: "Any", lsuEquivalent: 0.07, isYoung: true },
    { value: "Maiden Ewe", label: "Maiden Ewe", sex: "Female", lsuEquivalent: 0.15, isYoung: true },
    { value: "Ewe Lamb", label: "Ewe Lamb", sex: "Female", lsuEquivalent: 0.10, isYoung: true },
  ],

  gestationDays: 150,
  voluntaryWaitingDays: 30,
  estrusCycleDays: 17,

  reproEvents: [
    { value: "joining", label: "Joining (Mating)", icon: "Link" },
    { value: "pregnancy_scan", label: "Pregnancy Scan", icon: "Search" },
    { value: "lambing", label: "Lambing", icon: "Baby" },
    { value: "fostering", label: "Fostering", icon: "HandHeart" },
  ],
  birthEventType: "lambing",

  observationTypes: [
    { value: "lambing", label: "Lambing", icon: "Baby", requiresAnimal: true, speciesExclusive: true },
    { value: "joining", label: "Joining (Mating)", icon: "Link", requiresAnimal: true, speciesExclusive: true },
    { value: "shearing", label: "Shearing", icon: "Scissors", requiresAnimal: true, speciesExclusive: true },
    { value: "predation_loss", label: "Predation Loss", icon: "AlertTriangle", requiresAnimal: false, speciesExclusive: true },
    { value: "dosing", label: "Dosing", icon: "Droplets", requiresAnimal: true, speciesExclusive: true },
    { value: "fostering", label: "Fostering", icon: "HandHeart", requiresAnimal: true, speciesExclusive: true },
    { value: "famacha", label: "FAMACHA Score", icon: "Eye", requiresAnimal: true, speciesExclusive: true },
  ],

  defaultLsuValues: {
    Ewe: 0.17,
    Ram: 0.20,
    Wether: 0.15,
    Hogget: 0.13,
    Lamb: 0.07,
    "Maiden Ewe": 0.15,
    "Ewe Lamb": 0.10,
  },

  alertTypes: [
    "overdue-lambings",
    "lambings-due-7d",
    "lambings-due-14d",
    "predation-spike",
    "withdrawal-active",
    "famacha-critical",
    "shearing-due",
    "vaccination-due",
    "dosing-due",
    "category-transition",
    "poor-doers",
    "ram-ratio",
    "kraaling-lapse",
    "joining-ending",
  ],
};
