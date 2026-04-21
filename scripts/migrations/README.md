# Tenant DB Migrations

FarmTrack runs one Turso libSQL database per tenant. Prisma's auto-migrate
(`prisma db push`, `prisma migrate dev`) is **banned** per CLAUDE.md — it would
attempt to recreate tables and break live tenant data.

## How to apply a migration

Each file in this directory is a hand-written, idempotent SQL script. Apply
per tenant:

```bash
turso db shell <tenant-slug> < scripts/migrations/<file>.sql
```

Repeat for every tenant DB listed in the meta DB.

## Authoring guidance

- Prefer `CREATE INDEX IF NOT EXISTS` and `ALTER TABLE ADD COLUMN` — both are
  idempotent and safe on SQLite/libSQL.
- **Do not** add new foreign-key constraints to existing tables. SQLite can
  only declare FKs at `CREATE TABLE` time; adding them post-hoc requires the
  12-step table-recreation pattern and is risky on live tenants. Track FK
  intent in `prisma/schema.prisma` via `@relation` (type-safety only) and
  schedule a proper recreation migration when the risk/reward justifies it.
- Each file's first line comment should cite the schema.prisma lines it
  corresponds to so future auditors can trace the intent.

## History

| Date       | File                                | Scope                                          |
|------------|-------------------------------------|------------------------------------------------|
| 2026-04-21 | `2026-04-21-add-fk-indexes.sql`     | Single-column indexes on FK-ish Observation/Transaction fields |
