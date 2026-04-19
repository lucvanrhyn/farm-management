/**
 * lib/tasks/observation-mapping.ts
 *
 * Pure function — maps a completed task + payload into an Observation create
 * payload, or null if the mapping is not applicable / required fields are absent.
 *
 * The "null" path is intentional and not an error — pure maintenance tasks
 * (water_point_service, fence_repair, fire_break_maintenance, generic) produce
 * no observation. Callers should treat null as "no observation to write".
 *
 * Per MEMORY.md silent-failure-pattern cure: every error branch returns null
 * (not a generic error) so callers can surface `observationCreated: false`
 * with a clear intent.
 */

// ── Public types ──────────────────────────────────────────────────────────────

export type TaskCompletionPayload = Record<string, unknown>;

export interface TaskForMapping {
  id: string;
  taskType: string | null;
  animalId: string | null;
  campId: string | null;
  lat: number | null;
  lng: number | null;
  assignedTo: string;
}

export interface ObservationCreatePayload {
  type: string;
  details: string;
  animalId: string | null;
  campId: string | null;
  lat: number | null;
  lng: number | null;
  loggedBy: string;
}

// ── Type guards ───────────────────────────────────────────────────────────────

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isNumber(v: unknown): v is number {
  return typeof v === "number";
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Maps a completed task + completion payload to an Observation create payload.
 *
 * Returns null when:
 *  - taskType is null or unrecognised
 *  - taskType maps to a pure maintenance action (no observation)
 *  - required payload keys are missing or wrong type
 */
export function observationFromTaskCompletion(
  task: TaskForMapping,
  payload: TaskCompletionPayload,
): ObservationCreatePayload | null {
  const { taskType, animalId, campId, lat, lng, assignedTo } = task;

  const base = { animalId, campId, lat, lng, loggedBy: assignedTo };

  switch (taskType) {
    case "weighing": {
      if (!isNumber(payload.weightKg)) return null;
      return {
        ...base,
        type: "weighing",
        details: JSON.stringify({ weightKg: payload.weightKg }),
      };
    }

    case "treatment": {
      if (!isString(payload.product)) return null;
      return {
        ...base,
        type: "treatment",
        details: JSON.stringify({
          product: payload.product,
          subtype: isString(payload.subtype) ? payload.subtype : undefined,
          dose: isString(payload.dose) ? payload.dose : undefined,
        }),
      };
    }

    case "dipping": {
      if (!isString(payload.product)) return null;
      return {
        ...base,
        type: "treatment",
        details: JSON.stringify({
          product: payload.product,
          subtype: "dip",
          dose: isString(payload.dose) ? payload.dose : undefined,
        }),
      };
    }

    case "pregnancy_scan": {
      if (!isString(payload.result)) return null;
      return {
        ...base,
        type: "pregnancy_scan",
        details: JSON.stringify({ result: payload.result }),
      };
    }

    case "shearing": {
      // product is optional — shearing itself is the event
      return {
        ...base,
        type: "treatment",
        details: JSON.stringify({
          subtype: "shearing",
          product: isString(payload.product) ? payload.product : undefined,
        }),
      };
    }

    case "crutching": {
      return {
        ...base,
        type: "treatment",
        details: JSON.stringify({
          subtype: "crutching",
          product: isString(payload.product) ? payload.product : undefined,
        }),
      };
    }

    case "vaccination": {
      if (!isString(payload.product)) return null;
      return {
        ...base,
        type: "treatment",
        details: JSON.stringify({
          product: payload.product,
          subtype: "vaccine",
          dose: isString(payload.dose) ? payload.dose : undefined,
        }),
      };
    }

    case "brucellosis_test": {
      if (!isString(payload.result)) return null;
      return {
        ...base,
        type: "health_issue",
        details: JSON.stringify({ result: payload.result }),
      };
    }

    case "camp_inspection": {
      if (!isString(payload.condition)) return null;
      return {
        ...base,
        type: "camp_condition",
        details: JSON.stringify({ condition: payload.condition }),
      };
    }

    case "camp_move": {
      if (!isString(payload.toCampId)) return null;
      return {
        ...base,
        type: "camp_move",
        details: JSON.stringify({ toCampId: payload.toCampId }),
      };
    }

    case "rainfall_reading": {
      if (!isNumber(payload.rainfallMm)) return null;
      return {
        ...base,
        type: "rainfall",
        details: JSON.stringify({ rainfallMm: payload.rainfallMm }),
      };
    }

    // Pure maintenance — no observation produced
    case "water_point_service":
    case "fence_repair":
    case "fire_break_maintenance":
    case "generic":
      return null;

    // null or unknown taskType
    default:
      return null;
  }
}
