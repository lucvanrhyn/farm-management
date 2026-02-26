# Brangus Farm Management System

A digital farm management system for a Brangus cattle operation. Replaces manual Excel tracking with a web-based platform for data collection, visualization, and automated analysis.

## Three Interfaces

| Interface | Path | User | Purpose |
|---|---|---|---|
| **Logger** | `/logger` | Dicky (field worker) | Mobile-first daily exception logging |
| **Map Hub** | `/dashboard` | Uncle & Grandpa (management) | Interactive farm map with drill-down insights |
| **Admin** | `/admin` | Luc (developer) | Data management, imports, configuration |

## Tech Stack

- **Framework:** Next.js (TypeScript) — hosted on Vercel
- **Data Store:** Google Sheets API
- **Map:** Leaflet.js with satellite imagery and GeoJSON camp polygons
- **Automation:** n8n (daily reports, alerts, LLM analysis via Claude API)

## Local Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Copy `.env.local` and fill in your credentials before connecting to Google Sheets:

```bash
GOOGLE_SHEETS_ID=
GOOGLE_CLIENT_EMAIL=
GOOGLE_PRIVATE_KEY=
NEXTAUTH_SECRET=
```

## Project Documentation

- [PROJECT.md](./PROJECT.md) — full system architecture, data model, and implementation phases
- [CLAUDE.md](./CLAUDE.md) — agent operating instructions (WAT framework)
