# Delta Livestock — Vercel Deployment

## Environment Variables

Set these in your Vercel project settings under **Settings → Environment Variables**:

| Variable | Value |
|---|---|
| `NEXTAUTH_SECRET` | A random 32+ character string (generate with `openssl rand -base64 32`) |
| `NEXTAUTH_URL` | Your Vercel deployment URL, e.g. `https://trio-b.vercel.app` |
| `DATABASE_URL` | Connection string for your database (see SQLite note below) |
| `GOOGLE_SHEETS_ID` | Google Sheets ID for livestock data |
| `GOOGLE_CLIENT_EMAIL` | Google service account email |
| `GOOGLE_PRIVATE_KEY` | Google service account private key |

## SQLite on Vercel

> **Important:** SQLite (`file:./prisma/dev.db`) does **not** persist on Vercel — the filesystem is read-only and ephemeral. The database will reset on every deployment.

For production, migrate to **[Turso](https://turso.tech)** (SQLite-compatible, persistent, free tier available):

1. Create a Turso database: `turso db create trio-b`
2. Get the connection URL: `turso db show trio-b --url`
3. Get an auth token: `turso db tokens create trio-b`
4. Update `DATABASE_URL` to: `libsql://your-db.turso.io?authToken=your-token`
5. Install the Turso Prisma driver: `npm install @prisma/adapter-libsql @libsql/client`
6. Update `prisma/schema.prisma` to use `driver = "libsql"`

## Reseeding Users

After deploying with a fresh database, run the seed script to create users:

```bash
DATABASE_URL="your-production-db-url" npx tsx prisma/seed.ts
```

Default users seeded:
- `admin@example.com` / `SCRUBBED-PASSWORD` (admin)
- `field@example.com` / `SCRUBBED-PASSWORD` (field_logger)
- `viewer@example.com` / `SCRUBBED-PASSWORD` (viewer)

**Change passwords immediately after first login in production.**

## Deploy Steps

1. Push branch to GitHub
2. Import project in Vercel, set all env vars above
3. Deploy — Vercel auto-detects Next.js
4. Reseed users against the production database
5. Verify: visit `/login`, sign in with `viewer@example.com` / `SCRUBBED-PASSWORD`
