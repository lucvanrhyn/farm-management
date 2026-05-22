/**
 * lib/tasks/observation-mapping.ts
 *
 * Pure function — maps a completed task + payload into an Observation create
 * payload, or null if the mapping is not applicable / required fields are absent.
 *
 * The "null" path is intentional and not an error — reminder-only tasks
 * (water_point_service, fence_repair, fire_break_maintenance, generic,
 * camp_inspection, camp_move, rainfall_reading) produce no observation.
 * Callers should treat null as "no observation to write".
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
 *  - taskType is reminder-only (no observation — see the case group below)
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

    // Reminder-only task types — no observation produced (issue #360).
    // Each has a dedicated capture surface elsewhere, so the task is a
    // recurring reminder rather than an observation source:
    //   - camp_inspection → the logger's CampConditionForm records the
    //     real grazing/water/fence camp_condition. A {condition} stub
    //     here would fail the #321 required-field guard, and emitting
    //     camp_check would persist a silent "all-good" default — the
    //     exact silent-write class #321 was designed to close.
    //   - camp_move → animal/mob camp reassignment is recorded by the
    //     move-mob flow as animal_movement / mob_movement observations
    //     through the door; a task completion must not double-record.
    //   - rainfall_reading → readings live in the dedicated
    //     RainfallRecord model (/api/[farmSlug]/rainfall); a `rainfall`
    //     Observation would be a split-brain second home for the data.
    // Folding them in with the pure-maintenance types keeps this mapper
    // structurally incapable of emitting a payload the ADR-0006
    // createObservation door would reject (off-registry type / #321
    // guard).
    case "camp_inspection":
    case "camp_move":
    case "rainfall_reading":
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
