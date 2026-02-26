# PROJECT.md — Brangus Farm Management System

## Project Overview

This project is a digital farm management system for a Brangus cattle operation. The farm is currently managed using Excel spreadsheets and manual tracking, which is inefficient. The goal is to build a system that improves visibility, decision-making, and profitability by digitizing data collection, automating analysis, and presenting actionable insights to farm management.

The system has two primary users:
1. **Dicky** (field worker) — an unskilled worker who physically inspects camps daily and needs a dead-simple mobile interface to log exceptions and events
2. **Uncle & Grandpa** (management/decision-makers) — they need a visual, intuitive overview of the entire farm without being overwhelmed by raw data

There is also a system administrator:
3. **Luc** (developer/admin) — builds and maintains the system, manages data, configures automations

---

## System Architecture

The system consists of three layers:

```
LAYER 1: DATA COLLECTION
┌─────────────────────────┐
│     Dicky Logger        │  ← Simple mobile PWA
│     (Exception-based)   │     Dicky logs only what changed
└───────────┬─────────────┘
            │ writes to
            ▼
LAYER 2: DATA STORE
┌─────────────────────────┐
│     Google Sheets       │  ← Primary data store
│     (Multiple sheets)   │     Structured as relational tables
└───────────┬─────────────┘
            │ read by
            ▼
LAYER 3A: VISUALIZATION          LAYER 3B: AUTOMATION
┌─────────────────────────┐      ┌─────────────────────────┐
│     Farm Map Hub        │      │     n8n Workflows       │
│     (Interactive map)   │      │     (Background tasks)  │
│     Uncle & Grandpa     │      │     Analysis, alerts,   │
│     view this           │      │     reports, emails     │
└─────────────────────────┘      └─────────────────────────┘
```

---

## Tech Stack

| Component | Technology | Purpose |
|---|---|---|
| **Framework** | Next.js (React) | Both web apps (Logger + Map Hub) in one project |
| **Map** | Leaflet.js + react-leaflet | Interactive farm map with satellite imagery |
| **Data Store** | Google Sheets (via Google Sheets API) | All farm data — animals, camps, observations, events |
| **Authentication** | Simple role-based (PIN or password per user) | Dicky sees Logger, Uncle/Grandpa see Map Hub |
| **Automation** | n8n (separate, self-hosted or cloud) | Scheduled reports, alerts, LLM analysis |
| **LLM Analysis** | Claude API (via n8n) | Interprets data and generates recommendations |
| **Hosting** | Vercel (auto-deploys from GitHub) | Hosts the Next.js app |
| **Version Control** | GitHub | Code repository |
| **Development** | VS Code + Claude Code | Primary development environment |

### Why These Choices

- **Next.js**: Works seamlessly with Vercel deployment. Claude Code writes excellent Next.js code. Supports both the simple Logger UI and the complex Map Hub in one project.
- **Google Sheets**: Familiar spreadsheet interface for viewing/editing raw data. Well-documented API. Excellent n8n integration. Data can be exported to Excel (.xlsx) at any time for Uncle/Grandpa if they prefer.
- **Leaflet.js**: Free, open-source, no API key or billing required. Lightweight. Supports satellite tiles, GeoJSON polygons for camp boundaries, markers, popups, and interactive drill-down.
- **n8n**: Visual workflow builder for automations. Handles scheduled tasks, API calls, LLM integration, and email/WhatsApp delivery without writing custom cron jobs.

---

## User Interfaces

### 1. Dicky Logger (Mobile PWA)

**Path:** `/logger`

**Design Principles:**
- Must work on a phone browser with poor connectivity
- Large buttons, minimal typing, mostly tap-to-select
- Should take no more than 10-15 minutes per day for all camps on a normal day
- Exception-based: only log what has changed or needs attention

**How It Works:**

1. Dicky opens the app and selects the camp he is currently inspecting
2. The app shows the list of animals expected in that camp (pulled from Google Sheets)
3. Default action: "Camp inspected, all normal" — one tap to confirm
4. If something needs reporting, Dicky taps the specific animal or a "Report Issue" button
5. Exception types he can log:
   - **Animal moved** — select animal, select destination camp
   - **Health issue** — select animal, pick from common symptoms (limping, thin, eye problem, nasal discharge, diarrhea, wound, lump, other)
   - **Reproduction event** — calving (calf sex, alive/dead, assisted/unassisted), heat observed
   - **Death** — select animal, suspected cause
   - **Camp condition** — grazing quality (good/fair/poor/overgrazed), water status (full/low/empty/broken), fence status (intact/damaged)
   - **Treatment given** — select animal, treatment type, dosage
6. Each camp visit is timestamped so management can see inspection coverage

**One-Time Initialization:**
Before the system goes live, every animal must be assigned to a camp. This is a bulk data entry task done once (can be imported from existing Excel data). After that, only movements and changes are logged.

### 2. Farm Map Hub (Dashboard)

**Path:** `/dashboard`

**Design Principles:**
- Visual-first — the map is the primary interface
- Drill-down navigation: farm → camp → animal
- Color-coded status indicators at every level
- Should answer "how is the farm doing?" in 10 seconds

**Drill-Down Levels:**

**Level 1 — Full Farm View:**
- Satellite map of the entire farm
- All camps shown as colored polygons
- Color indicates primary metric (toggleable):
  - Grazing condition: green / yellow / orange / red
  - Days since last inspection: green (today) / yellow (1-2 days) / red (3+ days)
  - Stocking density: color gradient based on animals per hectare
- Click any camp to drill in

**Level 2 — Camp Detail View:**
- Zoomed view of the selected camp
- Side panel showing:
  - Camp name
  - Number of animals present
  - List of all animals (with codes)
  - Current grazing quality
  - Water status
  - Last inspection date and time
  - Last rainfall (if tracked)
  - Any active alerts or flagged issues
  - Grazing condition trend (mini chart, last 30 days)
- Click any animal in the list to drill in

**Level 3 — Animal Profile View:**
- Full profile for a single animal:
  - Code, sex, age/date of birth (if known)
  - Current camp and movement history (list of camp transfers with dates)
  - Calving history (dates, calf sex, survival, ease of birth)
  - Health event history (all logged issues with dates)
  - Treatment history (what was given, when, withdrawal period status)
  - Body condition trend (if BCS is tracked over time)
  - Any current alerts

### 3. Admin Panel (Luc)

**Path:** `/admin`

**Features:**
- Add/edit/remove animals from the master list
- Add/edit/remove camps (names, boundaries)
- Upload/edit camp boundary GeoJSON data
- View system logs (who logged what, when)
- Manage user access
- Manual data corrections
- Import data from existing Excel files

---

## Data Model (Google Sheets Structure)

Each sheet functions as a database table. Relationships are maintained via ID columns.

### Sheet: `animals`
| Column | Type | Description |
|---|---|---|
| animal_id | Text | Unique code identifier (e.g., "BX-042") |
| name | Text | Optional name |
| sex | Text | Male / Female |
| date_of_birth | Date | If known |
| breed | Text | Brangus / other |
| category | Text | Cow / Bull / Heifer / Calf / Ox |
| current_camp | Text | Camp ID where animal is currently located |
| status | Text | Active / Sold / Deceased |
| mother_id | Text | Animal ID of mother (if known) |
| father_id | Text | Animal ID of father/bull (if known) |
| notes | Text | Any additional info |
| date_added | Date | When added to system |

### Sheet: `camps`
| Column | Type | Description |
|---|---|---|
| camp_id | Text | Unique identifier |
| camp_name | Text | Human-readable name (e.g., "Rivier", "Koppie") |
| size_hectares | Number | Area of the camp |
| water_source | Text | Type of water source (borehole, dam, river, trough) |
| geojson | Text | GeoJSON polygon coordinates (for map rendering) |
| notes | Text | Any additional info |

### Sheet: `observations`
| Column | Type | Description |
|---|---|---|
| observation_id | Text | Auto-generated unique ID |
| timestamp | DateTime | When the observation was logged |
| logged_by | Text | Who logged it (e.g., "Dicky") |
| camp_id | Text | Which camp was inspected |
| type | Text | camp_check / animal_movement / health_issue / reproduction / death / treatment / camp_condition |
| animal_id | Text | Relevant animal (if applicable) |
| details | Text | JSON string with type-specific details |
| grazing_quality | Text | Good / Fair / Poor / Overgrazed (for camp_check type) |
| water_status | Text | Full / Low / Empty / Broken (for camp_check type) |
| fence_status | Text | Intact / Damaged (for camp_check type) |

### Sheet: `calving_records`
| Column | Type | Description |
|---|---|---|
| calving_id | Text | Auto-generated unique ID |
| timestamp | DateTime | When the calving was recorded |
| mother_id | Text | Animal ID of the cow |
| calf_id | Text | Animal ID assigned to the calf |
| calf_sex | Text | Male / Female |
| calf_alive | Text | Yes / No |
| ease_of_birth | Text | Unassisted / Assisted / Difficult |
| bull_id | Text | Sire if known (based on which bull was in the camp) |
| camp_id | Text | Where the calving occurred |
| notes | Text | Any additional info |

### Sheet: `treatments`
| Column | Type | Description |
|---|---|---|
| treatment_id | Text | Auto-generated unique ID |
| timestamp | DateTime | When treatment was given |
| animal_id | Text | Which animal was treated |
| treatment_type | Text | Vaccination / Deworming / Antibiotic / Dip / Supplement / Other |
| product_name | Text | Name of product used |
| dosage | Text | Amount given |
| withdrawal_days | Number | Days before animal can be sold/slaughtered |
| withdrawal_clear_date | Date | Auto-calculated: timestamp + withdrawal_days |
| administered_by | Text | Who gave the treatment |
| notes | Text | Any additional info |

### Sheet: `daily_camp_log`
| Column | Type | Description |
|---|---|---|
| log_id | Text | Auto-generated unique ID |
| date | Date | Date of inspection |
| camp_id | Text | Which camp |
| inspected_by | Text | Who checked it |
| animal_count | Number | How many animals counted |
| grazing_quality | Text | Good / Fair / Poor / Overgrazed |
| water_status | Text | Full / Low / Empty / Broken |
| fence_status | Text | Intact / Damaged |
| rainfall_mm | Number | If measured (optional) |
| notes | Text | General observations |

---

## n8n Workflows (Built Separately)

These workflows run independently and connect to the same Google Sheets data.

### Workflow 1: Daily Summary Pipeline
**Trigger:** Scheduled — every day at 6:00 PM
**Steps:**
1. Pull today's observations from Google Sheets
2. Compile summary: camps inspected, exceptions logged, animal movements, any health issues
3. Send to Claude API with prompt: "Summarize today's farm activity for management. Highlight anything that needs attention. Keep it concise and actionable."
4. Email formatted summary to Uncle & Grandpa

### Workflow 2: Intelligent Alerts
**Trigger:** Webhook (fired by the Next.js app when certain observations are logged) OR scheduled check every 2 hours
**Rules:**
- Animal health issue logged → Immediate WhatsApp/SMS to management
- Camp marked "overgrazed" → Alert with rotation recommendation
- Animal not seen in any camp for 3+ days → Missing animal alert
- Treatment withdrawal period ending → "Animal BX-042 clear for sale from tomorrow"
- Camp not inspected for 2+ days → Remind Dicky or alert management

### Workflow 3: Weekly Management Report
**Trigger:** Scheduled — every Sunday at 7:00 PM
**Steps:**
1. Pull full week's data from all sheets
2. Calculate: total herd count, movements, births, deaths, health events, camps inspected
3. Send to Claude API with prompt: "Analyze this week's Brangus cattle data. Provide: herd status overview, grazing rotation recommendations, reproduction updates, health trends, and recommended actions for next week."
4. Format as PDF report
5. Email to Uncle & Grandpa

### Workflow 4: Grazing Rotation Advisor
**Trigger:** Scheduled — weekly, or when a camp is marked "poor" or "overgrazed"
**Steps:**
1. Pull current camp conditions and stocking data
2. Pull historical grazing data for recovery pattern analysis
3. Send to Claude API: "Based on current grazing conditions and stocking densities, recommend an optimal rotation plan for the next 2 weeks."
4. Email recommendation to management

### Workflow 5: Monthly Breeding Performance Report
**Trigger:** Scheduled — 1st of each month
**Steps:**
1. Pull calving records, identify cows that should have calved but haven't
2. Calculate per-cow metrics: calving interval, calf survival rate
3. Identify top and bottom performers
4. Send to Claude API for analysis and culling/breeding recommendations
5. Email report to management

### Workflow 6: Data Backup & Excel Export
**Trigger:** Scheduled — weekly
**Steps:**
1. Export all Google Sheets to .xlsx files
2. Store in Google Drive or email as attachments
3. Ensures Uncle & Grandpa always have familiar Excel copies

### Workflow 7: Rainfall & Weather Integration (Future)
**Trigger:** Scheduled — daily
**Steps:**
1. Pull weather data from a weather API for the farm's location
2. Log rainfall to the daily_camp_log sheet
3. Correlate with grazing conditions over time

---

## Project Structure (Next.js)

```
farm-management/
├── app/
│   ├── page.tsx                 # Landing/login page
│   ├── layout.tsx               # Root layout
│   ├── logger/
│   │   ├── page.tsx             # Dicky's main screen (camp selection)
│   │   └── [campId]/
│   │       └── page.tsx         # Camp inspection view (animal list + exception logging)
│   ├── dashboard/
│   │   ├── page.tsx             # Farm Map Hub (full farm view)
│   │   ├── camp/
│   │   │   └── [campId]/
│   │   │       └── page.tsx     # Camp detail view
│   │   └── animal/
│   │       └── [animalId]/
│   │           └── page.tsx     # Animal profile view
│   ├── admin/
│   │   ├── page.tsx             # Admin dashboard
│   │   ├── animals/
│   │   │   └── page.tsx         # Manage animals
│   │   ├── camps/
│   │   │   └── page.tsx         # Manage camps
│   │   └── import/
│   │       └── page.tsx         # Import data from Excel
│   └── api/
│       ├── sheets/
│       │   └── route.ts         # Google Sheets API interactions
│       ├── observations/
│       │   └── route.ts         # Log new observations
│       └── webhook/
│           └── route.ts         # Webhook endpoint for n8n triggers
├── components/
│   ├── map/
│   │   ├── FarmMap.tsx          # Main Leaflet map component
│   │   ├── CampPolygon.tsx      # Individual camp polygon with color coding
│   │   └── CampPopup.tsx        # Popup when clicking a camp
│   ├── logger/
│   │   ├── CampSelector.tsx     # Camp selection grid
│   │   ├── AnimalChecklist.tsx   # Animal list with exception buttons
│   │   ├── HealthIssueForm.tsx  # Health issue logging form
│   │   ├── MovementForm.tsx     # Animal movement form
│   │   └── CalvingForm.tsx      # Calving event form
│   ├── dashboard/
│   │   ├── CampDetailPanel.tsx  # Side panel for camp info
│   │   ├── AnimalProfile.tsx    # Full animal profile view
│   │   └── StatusIndicator.tsx  # Color-coded status badges
│   └── ui/
│       ├── Button.tsx           # Shared button component
│       ├── Select.tsx           # Shared dropdown component
│       └── Card.tsx             # Shared card component
├── lib/
│   ├── google-sheets.ts         # Google Sheets API client and helpers
│   ├── auth.ts                  # Simple authentication logic
│   └── types.ts                 # TypeScript type definitions for all data models
├── public/
│   └── geojson/
│       └── camps.geojson        # Camp boundary data (to be created)
├── .env.local                   # Google API credentials, app secrets (NEVER commit)
├── .gitignore
├── package.json
├── tsconfig.json
├── next.config.js
├── CLAUDE.md                    # Agent operating instructions (WAT framework)
└── PROJECT.md                   # This file
```

---

## Implementation Phases

### Phase 1: Foundation (Build First)
1. Initialize Next.js project and deploy to Vercel via GitHub
2. Set up Google Sheets with the data model above (create all sheets with headers)
3. Build the Google Sheets API integration (`lib/google-sheets.ts`)
4. Create simple authentication (role-based: logger / dashboard / admin)
5. Import existing animal and camp data from current Excel files

### Phase 2: Dicky Logger
1. Build camp selection screen
2. Build animal checklist per camp
3. Build exception logging forms (health, movement, calving, death, treatment, camp condition)
4. Build "camp inspected, all normal" quick-confirm
5. Test with Dicky — iterate on usability

### Phase 3: Farm Map Hub
1. Obtain or create camp boundary GeoJSON data
2. Build the Leaflet map with camp polygons
3. Implement color-coding based on live data from Google Sheets
4. Build camp detail panel (Level 2 drill-down)
5. Build animal profile view (Level 3 drill-down)

### Phase 4: n8n Automations
1. Set up n8n instance (cloud or self-hosted)
2. Build Workflow 1: Daily Summary Pipeline
3. Build Workflow 2: Intelligent Alerts
4. Build Workflow 3: Weekly Management Report
5. Connect Claude API for LLM analysis

### Phase 5: Refinement & Expansion
1. Add remaining workflows (grazing advisor, breeding report, backup)
2. Add rainfall/weather integration
3. Refine LLM prompts based on what Uncle & Grandpa find useful
4. Add historical trend charts to the dashboard
5. Optimize based on real-world usage feedback

---

## Data Needed Before Building

The following information is needed to populate the system:

- [ ] **Camp list**: Names and IDs of all camps
- [ ] **Camp boundaries**: GPS coordinates or a traced map (Google Earth KML export would work)
- [ ] **Animal list**: All animal codes, sex, approximate age, current camp assignment
- [ ] **Existing Excel data**: Any current records (calving history, treatment records, etc.)
- [ ] **Farm GPS coordinates**: Center point for the map default view
- [ ] **Google account**: For Google Sheets API and Google Cloud project setup

---

## Key Design Principles

1. **Exception-based logging** — Dicky only reports what changed. No logging 500 animals individually every day.
2. **Insights over raw data** — Uncle & Grandpa receive analyzed, actionable information, not spreadsheets.
3. **Simple for field use** — Big buttons, minimal typing, works on a phone with poor signal.
4. **Visual for management** — The map is the primary decision-making interface.
5. **Progressive enhancement** — Start simple, add complexity only when the foundation is solid.
6. **Data portability** — Everything can be exported to Excel at any time. No vendor lock-in.
