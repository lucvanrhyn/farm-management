// components/admin/observations-log/parseDetails.ts
// Pure functions for turning a raw `details` JSON string into a human-
// readable summary line. Tolerates camelCase / snake_case because the
// Logger and importers have historically used both.

/**
 * Pull the first non-empty value from a set of candidate keys on an
 * observation details object. Returns `undefined` if no candidate has a
 * meaningful (non-null/non-empty) value.
 */
function pick(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== "") return String(v);
  }
  return undefined;
}

export function safeParse(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw); } catch { return {}; }
}

export function parseDetails(raw: string, type?: string): string {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return raw.slice(0, 120);
  }

  switch (type) {
    case "animal_movement":
    case "camp_move":
    case "mob_movement": {
      const animalId = pick(obj, "animalId", "animal_id", "mobId", "mob_id") ?? "?";
      const src = pick(obj, "sourceCampId", "source_camp_id", "from_camp", "fromCamp");
      const dest = pick(obj, "destCampId", "dest_camp_id", "to_camp", "toCamp") ?? "?";
      return src
        ? `🔄 ${animalId} moved: ${src} → ${dest}`
        : `🔄 Moved to Camp ${dest}`;
    }

    case "camp_check": {
      const status = pick(obj, "status", "outcome") ?? "Normal";
      return `Status: ${status}`;
    }

    case "camp_condition": {
      const grazing = pick(obj, "grazingQuality", "grazing_quality", "grazing");
      const water = pick(obj, "waterStatus", "water_status", "water");
      const fence = pick(obj, "fenceStatus", "fence");
      const parts: string[] = [];
      if (grazing) parts.push(`Grazing: ${grazing}`);
      if (water) parts.push(`Water: ${water}`);
      if (fence) parts.push(`Fence: ${fence}`);
      return parts.join(" · ") || "Camp condition recorded";
    }

    case "calving":
    case "lambing": {
      const outcome = pick(obj, "outcome", "calf_status", "ease_of_birth");
      const sex = pick(obj, "calfSex", "sex", "calf_sex");
      const calfId = pick(obj, "calfAnimalId", "calf_animal_id", "calf_id", "calf_tag");
      const twinCount = pick(obj, "twin_count", "twinCount", "lambs_born", "lambsBorn");
      const prefix = type === "lambing" ? "👶 Lambing" : "👶 Calving";
      const parts: string[] = [];
      if (outcome) parts.push(outcome);
      if (twinCount) parts.push(`Twins: ${twinCount}`);
      if (sex) parts.push(`Sex: ${sex}`);
      if (calfId) parts.push(`${type === "lambing" ? "Lamb" : "Calf"}: ${calfId}`);
      return parts.length ? `${prefix} — ${parts.join(" · ")}` : `${prefix} recorded`;
    }

    case "fawning": {
      const species = pick(obj, "species", "game_species", "animal_species");
      const fawnCount = pick(obj, "fawn_count", "fawnCount");
      const parts: string[] = [];
      if (species) parts.push(`Species: ${species}`);
      if (fawnCount) parts.push(`Fawns: ${fawnCount}`);
      return parts.length ? `👶 Fawning — ${parts.join(" · ")}` : "👶 Fawning recorded";
    }

    case "pregnancy_scan": {
      const result = pick(obj, "result", "outcome") ?? "recorded";
      const scanner = pick(obj, "scanner_name", "scannerName", "scanner", "veterinarian");
      return scanner
        ? `🤰 Pregnancy scan — ${result} — Scanner: ${scanner}`
        : `🤰 Pregnancy scan — ${result}`;
    }

    case "heat_detection":
    case "heat": {
      const intensity = pick(obj, "intensity", "method", "strength") ?? "observed";
      return `❤️ Heat detected — ${intensity}`;
    }

    case "insemination":
    case "joining": {
      const method = pick(obj, "method") ?? "Service";
      const sire = pick(obj, "sire_id", "sireId", "bullId", "bull_id", "ramId", "ram_id");
      return sire
        ? `💉 ${method} — Sire: ${sire}`
        : `💉 ${method}`;
    }

    case "weighing": {
      const weight = pick(obj, "weight_kg", "weightKg", "weight");
      const method = pick(obj, "method", "scale");
      if (!weight) return "⚖️ Weighing recorded";
      return method ? `⚖️ ${weight} kg — Method: ${method}` : `⚖️ ${weight} kg`;
    }

    case "treatment":
    case "dosing": {
      const kind = pick(obj, "treatmentType", "treatment_type", "type");
      const product = pick(obj, "product", "drug", "medicine");
      const withdrawal = pick(obj, "withdrawalDays", "withdrawal_days");
      const parts: string[] = [];
      if (kind) parts.push(kind);
      if (product) parts.push(`Product: ${product}`);
      if (withdrawal) parts.push(`Withdrawal: ${withdrawal}d`);
      return parts.length ? `💊 ${parts.join(" — ")}` : "💊 Treatment recorded";
    }

    case "health_issue": {
      const issue =
        pick(obj, "issue_type", "issueType", "symptom") ??
        (Array.isArray(obj.symptoms) ? (obj.symptoms as string[]).join(", ") : undefined) ??
        "Issue";
      const severity = pick(obj, "severity");
      return severity
        ? `🩺 ${issue} — Severity: ${severity}`
        : `🩺 ${issue}`;
    }

    case "death": {
      const cause = pick(obj, "cause") ?? "unknown";
      return `Cause: ${cause}`;
    }

    case "rainfall": {
      const mm = pick(obj, "mm", "rainfall_mm", "rainfallMm", "amount_mm");
      return mm ? `🌧️ ${mm} mm` : "🌧️ Rainfall recorded";
    }

    case "shearing": {
      const wool = pick(obj, "wool_kg", "woolKg", "clip_kg", "clipKg");
      return wool ? `✂️ Shorn — Clip: ${wool} kg` : "✂️ Shorn";
    }

    case "predator_loss":
    case "predation_loss": {
      const predator = pick(obj, "predator_species", "predatorSpecies", "predator");
      const count = pick(obj, "count", "animals_lost", "animalsLost");
      const parts: string[] = [];
      if (predator) parts.push(`Species: ${predator}`);
      if (count) parts.push(`Lost: ${count}`);
      return parts.length ? `🦁 Predator loss — ${parts.join(" · ")}` : "🦁 Predator loss";
    }

    case "famacha": {
      const score = pick(obj, "score", "famacha_score");
      return score ? `FAMACHA score: ${score}` : "FAMACHA scored";
    }

    case "fostering": {
      const foster = pick(obj, "foster_mother", "fosterMother", "to_mother");
      return foster ? `Fostered to ${foster}` : "Fostering recorded";
    }

    case "camp_cover": {
      const kg = pick(obj, "cover_kg_ha", "coverKgHa", "kg_ha");
      return kg ? `Cover: ${kg} kg DM/ha` : "Cover reading";
    }

    case "reproduction": {
      const event = pick(obj, "eventType", "event_type", "event");
      return event ? `Event: ${event}` : "Reproduction event";
    }
  }

  // Generic fallback — label the type, summarise any recognised common fields.
  const parts: string[] = [];
  const weight = pick(obj, "weight_kg");
  if (weight) parts.push(`Weight: ${weight}kg`);
  if (Array.isArray(obj.symptoms)) parts.push(`Symptoms: ${(obj.symptoms as string[]).join(", ")}`);
  else if (typeof obj.symptoms === "string") parts.push(`Symptoms: ${obj.symptoms}`);
  const severity = pick(obj, "severity");
  if (severity) parts.push(`Severity: ${severity}`);
  const product = pick(obj, "product");
  if (product) parts.push(`Product: ${product}`);
  return parts.join(" · ") || "Details recorded";
}
