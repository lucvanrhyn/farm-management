/**
 * lib/einstein/chunker.ts
 *
 * Deterministic renderer that converts farm entity rows into embeddable text
 * chunks. One chunk per entity in most cases; two chunks (English + Afrikaans)
 * for task templates that carry a `name_af` field.
 *
 * Rules:
 * - No Date.now() or non-deterministic calls.
 * - sourceUpdatedAt falls back: updatedAt → editedAt → issuedAt → observedAt → createdAt.
 * - Missing optional fields are omitted gracefully from the sentence.
 *
 * Input shape: the chunker reads fields by name off the `row` object using the
 * ACTUAL Prisma schema names from `prisma/schema.prisma`. Callers pass the raw
 * Prisma row; for observations and animals they may additionally pre-resolve
 * denormalised fields (animalName, campName, currentCampName) that don't exist
 * on those tables directly.
 *
 * Historical note (2026-04-21 Wave 4 eval postmortem): the original chunker
 * read synthetic field names (`sizeHa`, `dob`, `currentCampId`, `date`,
 * `animalName`, `operator`, `frequencyDays`, `body`, `title`,
 * `grossIncome`/`deductions`/`net`) that did not exist on the Prisma models.
 * Every camp/animal/observation/notification/it3 chunk rendered with
 * "undefined" placeholders, poisoning semantic retrieval (G4 eval hit 50%).
 * This module now matches real Prisma field names.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EntityType =
  | "observation"
  | "camp"
  | "animal"
  | "task"
  | "task_template"
  | "notification"
  | "it3_snapshot";

export interface ChunkInput {
  entityType: EntityType;
  entityId: string;
  /** Row data — see SupportedRowShapes at the bottom for per-type expectations. */
  row: unknown;
}

export interface RenderedChunk {
  entityType: EntityType;
  entityId: string;
  langTag: "en" | "af";
  text: string;
  sourceUpdatedAt: Date;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Safely read a property from an unknown object. */
function get(row: unknown, key: string): unknown {
  if (row !== null && typeof row === "object") {
    return (row as Record<string, unknown>)[key];
  }
  return undefined;
}

/** Coerce to string, returning empty string for null/undefined. */
function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

/** Return true if the value is non-null and non-empty. Numbers must be finite. */
function present(v: unknown): v is string | number {
  if (typeof v === "number") return Number.isFinite(v);
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Format a date-like value to YYYY-MM-DD.
 * Accepts ISO string, Date objects, or any parseable string.
 */
function formatDate(v: unknown): string {
  if (v instanceof Date) {
    return v.toISOString().split("T")[0];
  }
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
    return v;
  }
  return "";
}

/**
 * Resolve sourceUpdatedAt with the priority chain:
 *   updatedAt → editedAt → issuedAt → observedAt → createdAt
 */
function resolveSourceDate(row: unknown): Date {
  const candidates = ["updatedAt", "editedAt", "issuedAt", "observedAt", "createdAt"];
  for (const key of candidates) {
    const v = get(row, key);
    if (v instanceof Date) return v;
    if (typeof v === "string" && v.length > 0) {
      const d = new Date(v);
      if (!isNaN(d.getTime())) return d;
    }
  }
  return new Date(0);
}

/** Best-effort JSON.parse; returns {} on failure or when input is already an object. */
function parseJsonObject(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object") return v as Record<string, unknown>;
  if (typeof v !== "string" || v.length === 0) return {};
  try {
    const parsed = JSON.parse(v);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Per-type renderers
// ---------------------------------------------------------------------------

/**
 * Observation — Prisma fields: type, observedAt, campId, animalId, details, loggedBy.
 * Optional denormalised fields (set by caller when available):
 *   animalName, species, breed, campName
 */
function renderObservation(
  entityId: string,
  row: unknown,
  sourceUpdatedAt: Date,
): RenderedChunk[] {
  const type = str(get(row, "type"));
  const observedAt = formatDate(get(row, "observedAt"));
  const campId = str(get(row, "campId"));
  const campName = str(get(row, "campName"));
  const animalId = str(get(row, "animalId"));
  const animalName = str(get(row, "animalName"));
  const species = str(get(row, "species"));
  const breed = get(row, "breed");
  const details = str(get(row, "details"));
  const loggedBy = get(row, "loggedBy");

  const animalLabel = present(animalName)
    ? `'${animalName}'`
    : animalId.length > 0
      ? animalId
      : "unknown";
  const campLabel = present(campName) ? `'${campName}'` : campId;

  const parts: string[] = [];
  if (present(species)) parts.push(species);
  if (present(breed)) parts.push(String(breed));
  parts.push(`camp ${campLabel}`);
  const parenthetical = `(${parts.join(", ")})`;

  let text = `observation:${type} @ ${observedAt} — animal ${animalLabel} ${parenthetical}: ${details}`;

  if (present(loggedBy)) {
    text += ` — by ${loggedBy}`;
  }

  return [
    {
      entityType: "observation",
      entityId,
      langTag: "en",
      text,
      sourceUpdatedAt,
    },
  ];
}

/**
 * Camp — Prisma fields: campId, campName, sizeHectares, veldType, waterSource,
 * rotationNotes, restDaysOverride, maxGrazingDaysOverride.
 */
function renderCamp(
  entityId: string,
  row: unknown,
  sourceUpdatedAt: Date,
): RenderedChunk[] {
  const campName = str(get(row, "campName"));
  const sizeHectares = get(row, "sizeHectares");
  const veldType = get(row, "veldType");
  const waterSource = get(row, "waterSource");
  const rotationNotes = get(row, "rotationNotes");

  const descParts: string[] = [];
  if (present(sizeHectares)) descParts.push(`${sizeHectares}ha`);
  if (present(veldType)) descParts.push(`${veldType} veld`);
  if (present(waterSource)) descParts.push(`${waterSource} water`);
  const descriptor = descParts.length > 0 ? ` (${descParts.join(", ")})` : "";

  let text = `camp — '${campName}'${descriptor}`;

  if (present(rotationNotes)) {
    text += `: rotation notes: "${rotationNotes}"`;
  }

  return [
    {
      entityType: "camp",
      entityId,
      langTag: "en",
      text,
      sourceUpdatedAt,
    },
  ];
}

/**
 * Animal — Prisma fields: animalId, name, registrationNumber, species, breed,
 * dateOfBirth, motherId, currentCamp, status, category.
 * Optional denormalised: currentCampName
 */
function renderAnimal(
  entityId: string,
  row: unknown,
  sourceUpdatedAt: Date,
): RenderedChunk[] {
  const name = str(get(row, "name")) || str(get(row, "animalId"));
  const registrationNumber = get(row, "registrationNumber");
  const species = str(get(row, "species"));
  const breed = str(get(row, "breed"));
  const dob = get(row, "dateOfBirth");
  const motherId = get(row, "motherId");
  const currentCamp = str(get(row, "currentCamp"));
  const currentCampName = str(get(row, "currentCampName"));
  const status = str(get(row, "status"));
  const category = get(row, "category");

  const idSuffix = present(registrationNumber) ? ` ${registrationNumber}` : "";
  const descParts: string[] = [];
  if (present(species)) descParts.push(species);
  if (present(breed)) descParts.push(breed);
  if (present(category)) descParts.push(String(category));
  if (present(dob)) descParts.push(`born ${formatDate(dob)}`);
  const descriptor = descParts.length > 0 ? ` (${descParts.join(", ")})` : "";

  let text = `animal — '${name}'${idSuffix}${descriptor}:`;

  if (present(motherId)) {
    text += ` mother ${motherId},`;
  }

  const campLabel = present(currentCampName) ? `'${currentCampName}'` : currentCamp;
  text += ` currently camp ${campLabel}, status '${status}'`;

  return [
    {
      entityType: "animal",
      entityId,
      langTag: "en",
      text,
      sourceUpdatedAt,
    },
  ];
}

/**
 * Task — Prisma fields: taskType, title, dueDate, campId, description, priority, status.
 */
function renderTask(
  entityId: string,
  row: unknown,
  sourceUpdatedAt: Date,
): RenderedChunk[] {
  const taskType = str(get(row, "taskType")) || "generic";
  const title = str(get(row, "title"));
  const dueDate = formatDate(get(row, "dueDate"));
  const campId = str(get(row, "campId"));
  const status = str(get(row, "status"));
  const priority = get(row, "priority");
  const description = get(row, "description");

  const parenthetical: string[] = [];
  if (dueDate.length > 0) parenthetical.push(`due ${dueDate}`);
  if (campId.length > 0) parenthetical.push(`camp ${campId}`);
  if (present(status)) parenthetical.push(`status ${status}`);
  if (present(priority)) parenthetical.push(`priority ${priority}`);
  const paren = parenthetical.length > 0 ? ` (${parenthetical.join(", ")})` : "";

  let text = `task:${taskType} — '${title}'${paren}`;

  if (present(description)) {
    text += `: ${description}`;
  }

  return [
    {
      entityType: "task",
      entityId,
      langTag: "en",
      text,
      sourceUpdatedAt,
    },
  ];
}

/**
 * TaskTemplate — Prisma fields: name, name_af, taskType, description,
 * description_af, recurrenceRule, species, priorityDefault.
 */
function renderTaskTemplate(
  entityId: string,
  row: unknown,
  sourceUpdatedAt: Date,
): RenderedChunk[] {
  const name = str(get(row, "name"));
  const nameAf = get(row, "name_af");
  const taskType = str(get(row, "taskType"));
  const recurrenceRule = get(row, "recurrenceRule");
  const species = str(get(row, "species"));
  const description = get(row, "description");
  const descriptionAf = get(row, "description_af");

  const baseParts: string[] = [];
  if (taskType.length > 0) baseParts.push(taskType);
  if (present(recurrenceRule)) baseParts.push(String(recurrenceRule));

  const enDescParts = [...baseParts];
  if (present(species)) enDescParts.push(`species ${species}`);
  const enDescriptor = enDescParts.length > 0 ? ` (${enDescParts.join(", ")})` : "";

  let enText = `task_template — '${name}'${enDescriptor}`;
  if (present(description)) enText += `: ${description}`;

  const chunks: RenderedChunk[] = [
    {
      entityType: "task_template",
      entityId,
      langTag: "en",
      text: enText,
      sourceUpdatedAt,
    },
  ];

  if (present(nameAf)) {
    const afDescParts = [...baseParts];
    if (present(species)) afDescParts.push(`spesie ${species}`);
    const afDescriptor = afDescParts.length > 0 ? ` (${afDescParts.join(", ")})` : "";
    let afText = `task_template — '${nameAf}'${afDescriptor}`;
    if (present(descriptionAf)) afText += `: ${descriptionAf}`;
    else if (present(description)) afText += `: ${description}`;
    chunks.push({
      entityType: "task_template",
      entityId,
      langTag: "af",
      text: afText,
      sourceUpdatedAt,
    });
  }

  return chunks;
}

/**
 * Notification — Prisma fields: type, message, severity, createdAt, collapseKey.
 */
function renderNotification(
  entityId: string,
  row: unknown,
  sourceUpdatedAt: Date,
): RenderedChunk[] {
  const type = str(get(row, "type"));
  const createdAt = formatDate(get(row, "createdAt"));
  const message = str(get(row, "message"));
  const severity = get(row, "severity");
  const collapseKey = get(row, "collapseKey");

  const sevPart = present(severity) ? ` [${severity}]` : "";
  const collapsePart = present(collapseKey) ? ` (scope: ${collapseKey})` : "";
  const text = `notification:${type}${sevPart} @ ${createdAt}${collapsePart}: "${message}"`;

  return [
    {
      entityType: "notification",
      entityId,
      langTag: "en",
      text,
      sourceUpdatedAt,
    },
  ];
}

/**
 * It3Snapshot — Prisma fields: taxYear, periodStart, periodEnd, payload (JSON).
 * payload carries { schedules, totals, farmSnapshot, categoryMap, meta } per
 * the schema comment. Totals keys vary; we handle common SA SARS IT3 naming.
 */
function renderIt3Snapshot(
  entityId: string,
  row: unknown,
  sourceUpdatedAt: Date,
): RenderedChunk[] {
  const taxYear = get(row, "taxYear");
  const periodStart = str(get(row, "periodStart"));
  const periodEnd = str(get(row, "periodEnd"));
  const payload = parseJsonObject(get(row, "payload"));
  const totals = parseJsonObject(payload.totals);

  const grossIncome = totals.grossIncome ?? totals.gross_income ?? totals.gross;
  const deductions = totals.deductions ?? totals.totalDeductions;
  const netIncome = totals.netIncome ?? totals.net_income ?? totals.net;

  const periodDesc =
    periodStart.length > 0 && periodEnd.length > 0 ? ` (${periodStart}..${periodEnd})` : "";

  const totalParts: string[] = [];
  if (present(grossIncome)) totalParts.push(`gross income ${grossIncome}`);
  if (present(deductions)) totalParts.push(`deductions ${deductions}`);
  if (present(netIncome)) totalParts.push(`net ${netIncome}`);
  const totalsDesc = totalParts.length > 0 ? ` — ${totalParts.join(", ")}` : "";

  const text = `it3_snapshot tax year ${taxYear}${periodDesc}${totalsDesc} (per SARS schedule)`;

  return [
    {
      entityType: "it3_snapshot",
      entityId,
      langTag: "en",
      text,
      sourceUpdatedAt,
    },
  ];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Deterministic renderer. Returns 1 chunk for English-only rows, 2 chunks
 * when Afrikaans source text is present (e.g. TaskTemplate.name_af).
 *
 * Pure — no side effects, no Date.now(), no randomness.
 */
export function toEmbeddingText(input: ChunkInput): RenderedChunk[] {
  const { entityType, entityId, row } = input;
  const sourceUpdatedAt = resolveSourceDate(row);

  switch (entityType) {
    case "observation":
      return renderObservation(entityId, row, sourceUpdatedAt);
    case "camp":
      return renderCamp(entityId, row, sourceUpdatedAt);
    case "animal":
      return renderAnimal(entityId, row, sourceUpdatedAt);
    case "task":
      return renderTask(entityId, row, sourceUpdatedAt);
    case "task_template":
      return renderTaskTemplate(entityId, row, sourceUpdatedAt);
    case "notification":
      return renderNotification(entityId, row, sourceUpdatedAt);
    case "it3_snapshot":
      return renderIt3Snapshot(entityId, row, sourceUpdatedAt);
    default: {
      const _exhaustive: never = entityType;
      throw new Error(`Unknown entity type: ${_exhaustive}`);
    }
  }
}

/**
 * SupportedRowShapes — what each entity type's `row` is expected to contain.
 * This is a documentation-only interface (not enforced because `row: unknown`
 * keeps the chunker decoupled from generated Prisma types).
 *
 *   observation:   { type, observedAt, campId, animalId, details, loggedBy?,
 *                    animalName?, species?, breed?, campName? }
 *   camp:          { campName, sizeHectares?, veldType?, waterSource?, rotationNotes? }
 *   animal:        { animalId, name?, registrationNumber?, species?, breed?,
 *                    dateOfBirth?, motherId?, currentCamp, status, category?,
 *                    currentCampName? }
 *   task:          { taskType?, title, dueDate, campId?, status?, priority?, description? }
 *   task_template: { name, name_af?, taskType, recurrenceRule?, species?,
 *                    description?, description_af? }
 *   notification:  { type, message, severity?, createdAt, collapseKey? }
 *   it3_snapshot:  { taxYear, periodStart?, periodEnd?, payload (JSON string with
 *                    { totals: { grossIncome?, deductions?, netIncome? } }) }
 */
