/**
 * Minimal regex-based parser for `prisma/schema.prisma` — extracts the
 * **scalar columns** declared per model so the schema-parity audit can
 * compare expected columns against the live tenant DB.
 *
 * Why this exists. PR #129 shipped a `_migrations`-row-vs-files audit
 * (`checkSchemaParity`). It does not catch a different drift class:
 * a column declared in `prisma/schema.prisma` but never declared in any
 * migration file. The basson `Animal.species` incident (Wave 0) was
 * exactly that — pre-rule-tightening tenants got `species` via legacy
 * `prisma db push` and no migration file was ever written. The audit
 * said `ok=true` for migrations; the column was missing; every
 * `findMany()` projecting `species` crashed 500.
 *
 * This parser is deliberately small. It does NOT depend on
 * `@prisma/internals` / `getDMMF` so the audit script can run anywhere
 * without pulling Prisma's internal toolkit. The schema syntax we
 * actually use is small enough to handle with a few well-anchored
 * regexes.
 *
 * Scope:
 *   - extracts `model X { ... }` blocks
 *   - resolves `@@map("table_name")` table overrides (defaults to model name)
 *   - resolves `@map("col_name")` column overrides per field (rare in our schema)
 *   - excludes relation fields (type matches another model name OR has `@relation`
 *     OR is an array type `Foo[]`)
 *   - excludes block-level annotations (`@@index`, `@@unique`, `@@map`, etc.)
 *
 * Out of scope:
 *   - composite types
 *   - views (we don't use them)
 *   - generators / datasource blocks (irrelevant to column parity)
 */

export interface PrismaModel {
  /** Prisma model name as declared (`model Animal { ... }` → `"Animal"`). */
  name: string;
  /** Resolved table name: `@@map("foo")` override OR the model name. */
  table: string;
  /** Scalar column names as they appear in the live DB (post-`@map` rewrite). */
  columns: string[];
}

/** Prisma's built-in scalar type set. Anything else is treated as a relation. */
const SCALAR_TYPES = new Set([
  'String',
  'Int',
  'BigInt',
  'Float',
  'Decimal',
  'Boolean',
  'DateTime',
  'Json',
  'Bytes',
]);

/**
 * Parse a `prisma/schema.prisma` source string and return one entry per
 * model with its resolved table name and scalar column list.
 *
 * The function is pure: it does no I/O. Callers pass the source text
 * (typically `await readFile('prisma/schema.prisma', 'utf-8')`).
 */
export function parsePrismaSchema(source: string): PrismaModel[] {
  // Strip line comments — `// ...` to EOL — so we don't accidentally match
  // tokens inside comments. Keep newlines so line-anchored regex still works.
  const cleaned = source.replace(/\/\/[^\n]*/g, '');

  // First pass: collect every model name. We need this set to detect when a
  // field's type refers to another model (relation) vs a scalar.
  const modelNames = new Set<string>();
  for (const m of cleaned.matchAll(/^\s*model\s+(\w+)\s*\{/gm)) {
    modelNames.add(m[1]);
  }

  // Enum types are also "non-scalar" in the column sense — but Prisma maps
  // enum-typed scalar fields to a TEXT column. So we treat enums as scalar
  // for parity purposes. Detect them only to avoid mistaking them for models.
  // (For SQLite/Turso, enums are stored as TEXT.)
  for (const m of cleaned.matchAll(/^\s*enum\s+(\w+)\s*\{/gm)) {
    modelNames.delete(m[1]); // don't treat the enum as a model relation target
  }

  // Second pass: extract each model body and its fields.
  const result: PrismaModel[] = [];
  // Match `model X { ... }`. Greedy across lines but stop at the FIRST line
  // whose only non-whitespace content is `}` (Prisma convention; indentation
  // varies across schemas — test fixtures may indent the closing brace).
  const modelBlockRe = /^\s*model\s+(\w+)\s*\{([\s\S]*?)^\s*\}/gm;
  let block: RegExpExecArray | null;
  while ((block = modelBlockRe.exec(cleaned))) {
    const modelName = block[1];
    const body = block[2];

    // Detect `@@map("table")` override.
    let tableName = modelName;
    const mapMatch = /@@map\s*\(\s*"([^"]+)"\s*\)/.exec(body);
    if (mapMatch) tableName = mapMatch[1];

    // Iterate fields. A field line looks like:
    //   <indent><name> <Type>[?|[]] <annotations>
    // Block-level annotations start with `@@`, skip them.
    const columns: string[] = [];
    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('@@')) continue; // block-level: @@index/@@unique/@@map/etc.
      const fieldMatch = /^(\w+)\s+(\w+)(\?|\[\])?\s*(.*)$/.exec(trimmed);
      if (!fieldMatch) continue;
      const [, fieldName, typeName, modifier, annotations] = fieldMatch;

      // Array types are relations (Foo[] = "many Foo's"). Skip.
      if (modifier === '[]') continue;

      // `@relation` annotation = relation field. Skip.
      if (/@relation\b/.test(annotations)) continue;

      // Type names matching another model are relation fields. Skip.
      if (modelNames.has(typeName)) continue;

      // If the type isn't a known scalar AND isn't an enum-style identifier
      // we recognize, default to assuming it's a scalar column (we already
      // ruled out model relations). This lets us tolerate enum types without
      // an enum-set lookup.
      // (`Unsupported("...")` types become scalars too — Prisma maps them
      // straight to the underlying SQL type.)
      const isScalarShape =
        SCALAR_TYPES.has(typeName) ||
        // Enum types: any identifier that isn't a model
        (/^[A-Z]/.test(typeName) && !modelNames.has(typeName));
      if (!isScalarShape) continue;

      // Apply `@map("col")` override on the field.
      let columnName = fieldName;
      const fieldMap = /@map\s*\(\s*"([^"]+)"\s*\)/.exec(annotations);
      if (fieldMap) columnName = fieldMap[1];

      columns.push(columnName);
    }

    result.push({ name: modelName, table: tableName, columns });
  }

  return result;
}

/**
 * Convenience: build the `Map<table, columns>` shape that
 * `checkPrismaColumnParity` expects, from a parsed model list.
 */
export function expectedColumnsByTable(
  models: readonly PrismaModel[],
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of models) out.set(m.table, [...m.columns]);
  return out;
}
