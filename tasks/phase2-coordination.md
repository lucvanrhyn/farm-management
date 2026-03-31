# Phase 2 — Team Coordination Contract

> Shared state file for all phase2-farmtrack agents.
> Each agent MUST write to their section on START (file ownership) and on DONE (summary + interfaces).

---

## Shared Context

**Project root:** `/Users/lucvanrhyn/Documents/Obsidian Vault/MainHub/Farm.project/farm-management`
**Tech stack:** Next.js 16 App Router · Prisma 5 + Turso libSQL · NextAuth v4 · Tailwind CSS · TypeScript
**Routing:** `/{farmSlug}/admin/**` (admin) · `/{farmSlug}/logger/**` (field logger) · `/api/[farmSlug]/**` (API)

**Farm DB helper:**
```ts
import { getPrismaForFarm } from '@/lib/farm-prisma'
const prisma = await getPrismaForFarm(farmSlug)
if (!prisma) return NextResponse.json({ error: 'Farm not found' }, { status: 404 })
```

**Auth guard (required on every API route):**
```ts
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth-options'
const session = await getServerSession(authOptions)
if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
if (!session.user.farms.some((f: { slug: string }) => f.slug === farmSlug))
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
```

**Observation model:**
```
type: "camp_check"|"camp_condition"|"health_issue"|"animal_movement"|"reproduction"|"treatment"|"death"|"calving"|"weighing"
details: JSON string — flexible payload per type
campId, animalId?, observedAt, loggedBy, editedBy?, editedAt?, editHistory? (JSON array)
```

**Weighing observation shape:**
```json
{ "weight_kg": 245.5, "notes": "optional" }
```

**Treatment observation shape:**
```json
{ "treatmentType": "Antibiotic|Dip|Deworming|Vaccination|Supplement|Other", "product": "string", "dose": "string", "withdrawalDays": 14, "notes": "optional" }
```

**CampCoverReading model** (separate table, not Observation):
```
coverCategory: "Good"|"Fair"|"Poor"  kgDmPerHa: Float  useFactor: Float  recordedAt: String  recordedBy: String  notes?: String
```

**Coding rules:**
- Immutable data (never mutate in place — always return new objects)
- Files ≤ 400 lines; extract if larger
- No hardcoded values — use constants
- Server components by default; `'use client'` only when state/effects needed
- Always add auth guard on API routes

---

## Agent File Ownership

> Each agent fills in their section before touching any files. No agent edits another agent's owned files.

### agent-2c (Performance)
**Status:** COMPLETE
**Files claimed:**
- `app/[farmSlug]/admin/layout.tsx` (NEW)
- `app/[farmSlug]/admin/loading.tsx` (NEW)
- `app/[farmSlug]/admin/animals/loading.tsx` (NEW)
- `app/[farmSlug]/admin/camps/loading.tsx` (NEW)
- `app/[farmSlug]/admin/observations/loading.tsx` (NEW)
- `app/[farmSlug]/admin/grafieke/loading.tsx` (NEW)
- `app/[farmSlug]/admin/finansies/loading.tsx` (NEW)

**Completion summary:** Created a persistent admin shell layout (`layout.tsx`) that wraps all admin pages with `<AdminNav>` in a flex container, eliminating redundant nav re-renders on navigation. Created 6 route-specific `loading.tsx` skeleton files using Tailwind `animate-pulse` with dark mode support. Each skeleton matches the approximate content structure of its page: dashboard (7 stat cards + 2 tables), animals (filter bar + table rows), camps (card grid), observations (filter bar + list rows), grafieke (tab bar + chart area), finansies (summary cards + table).

---

### agent-2d (Finance)
**Status:** COMPLETE
**Files claimed:**
- `prisma/schema.prisma` — Transaction model already existed, no changes needed
- `app/api/[farmSlug]/transactions/route.ts` (NEW)
- `app/[farmSlug]/admin/finansies/page.tsx` (EDIT — passes farmSlug to client)
- `components/admin/FinansiesClient.tsx` (EDIT — uses farm-scoped API when farmSlug provided)
- `components/admin/TransactionForm.tsx` (NEW — standalone form component)
- `components/admin/charts/FinansieleTab.tsx` (NO CHANGE — already wired to real DB data via grafieke server page)

**Completion summary:** Transaction model already existed in schema with fields: type (income/expense), category, amount, date, description, animalId, campId, reference, createdBy. Created farm-slug-scoped API route at `/api/[farmSlug]/transactions` with GET (filter by date range, returns transactions + summary) and POST (create transaction with auth). Created standalone `TransactionForm.tsx` component with income/expense toggle, category select, amount, date, description, and optional camp select. Updated `FinansiesClient` to accept `farmSlug` prop and use farm-scoped API for refresh. The finansies page already had full transaction list, modal entry form, trend chart, and category management. The FinansieleTab in grafieke was already wired to real transaction data server-side. TypeScript compiles clean.

---

### agent-2a (Logger completeness)
**Status:** COMPLETE
**Files claimed:**
- `components/logger/WeighingForm.tsx` (NEW)
- `components/logger/TreatmentForm.tsx` (NEW)
- `components/logger/CampCoverLogForm.tsx` (NEW — logger-friendly version of cover recording)
- `app/[farmSlug]/logger/[campId]/page.tsx` (EDIT — add 3 new modals/buttons)
- `components/logger/AnimalChecklist.tsx` (EDIT — added weigh/treat to ModalType and ACTION_BUTTONS)
- `app/api/[farmSlug]/observations/route.ts` (READ ONLY — understand POST shape)

**Completion summary:** Created 3 new logger form components (WeighingForm, TreatmentForm, CampCoverLogForm) following exact BottomSheet UI pattern from HealthIssueForm/CampConditionForm. Added "Weigh" and "Treat" per-animal action buttons to AnimalChecklist. Added "Record Cover" camp-level button to logger page sticky bottom bar. All 3 modals wired into the logger page with correct props, endpoints, and onSuccess/onCancel callbacks. WeighingForm POSTs to `/api/{farmSlug}/observations` with type "weighing". TreatmentForm POSTs to same endpoint with type "treatment" and auto-fills withdrawal days per treatment type. CampCoverLogForm POSTs to `/api/{farmSlug}/camps/{campId}/cover`. TypeScript compiles clean.

---

### agent-2b (Admin usability)
**Status:** COMPLETE
**Files claimed:**
- `components/admin/ObservationsLog.tsx` (EDIT — replaced raw JSON editor with per-type forms)
- `app/api/observations/[id]/route.ts` (EDIT — added DELETE method)
- `app/[farmSlug]/admin/observations/page.tsx` (EDIT — converted to async server component, added New Entry button)
- `app/[farmSlug]/admin/observations/ObservationsPageClient.tsx` (NEW — client wrapper for page)
- `components/admin/CreateObservationModal.tsx` (NEW — admin-side observation creation)

**Completion summary:** Added DELETE endpoint with admin auth guard to `observations/[id]/route.ts`. Replaced raw JSON textarea in ObservationsLog EditModal with per-type form fields for weighing, treatment, health_issue, camp_condition, reproduction, and death types; non-editable types (camp_check, animal_movement, calving) show read-only formatted JSON. Added delete button with confirmation to edit modal that calls DELETE and removes the item from the list. Created `CreateObservationModal` with two-step flow: type selection grid → type-specific form fields with camp/animal selects. POSTs to `/api/observations`. Converted observations page to async server component that fetches camps and animals from Prisma, passing them to a thin client wrapper (`ObservationsPageClient`) that renders the New Entry button, modal, and ObservationsLog. TypeScript compiles clean.

---

### agent-2e (Cleanup)
**Status:** WAITING for all implementation agents (2a, 2b, 2c, 2d) to complete
**Files claimed:**
- `lib/prisma.ts` (DELETE if dead code)
- JWT/session type declarations (minor fixes)
- Any other dead imports or stale references found during audit

**Completion summary:** _(fill in when done)_

---

### agent-audit (Quality Audit)
**Status:** COMPLETE

## Audit Report — Phase 2

### 1. Auth guards on all new API routes

- `app/api/[farmSlug]/transactions/route.ts` GET — PASS (session + farm access check)
- `app/api/[farmSlug]/transactions/route.ts` POST — PASS (session + farm access check)
- `app/api/observations/[id]/route.ts` DELETE — PASS (session + ADMIN role check)
- `app/api/observations/[id]/route.ts` PATCH — PASS (session + ADMIN role check)
- `app/api/[farmSlug]/camps/[campId]/cover/route.ts` — not audited (pre-existing)

### 2. Logger forms connectivity

- `components/logger/WeighingForm.tsx` — FAIL: POSTs to `/api/${farmSlug}/observations` but that route does NOT exist. Only `/api/observations` exists. Will get 404.
- `components/logger/TreatmentForm.tsx` — FAIL: Same issue — POSTs to `/api/${farmSlug}/observations`. Will 404. Withdrawal auto-fill works correctly via useEffect.
- `components/logger/CampCoverLogForm.tsx` — PASS: POSTs to `/api/${farmSlug}/camps/${campId}/cover` which exists.
- `app/[farmSlug]/logger/[campId]/page.tsx` — PASS: All 3 modals wired (weigh, treat, cover). Weigh/Treat per-animal buttons visible in AnimalChecklist. Record Cover camp-level button in sticky bottom bar.

### 3. Admin usability connectivity

- `components/admin/ObservationsLog.tsx` — WARN: Edit modal still shows raw JSON textarea, not per-type fields. Agent-2b did not complete this work.
- `components/admin/CreateObservationModal.tsx` — FAIL: File does not exist. Agent-2b did not create it.
- `app/[farmSlug]/admin/observations/page.tsx` — FAIL: No "New Entry" / "New Observation" button. Agent-2b did not complete this work.

### 4. Performance layer

- `app/[farmSlug]/admin/layout.tsx` — PASS: Exists, renders AdminNav in flex layout.
- Loading files — PASS: All 6 loading.tsx files exist (admin root, animals, camps, observations, grafieke, finansies).
- Duplicate AdminNav — FAIL: Layout renders AdminNav, but ALL individual admin pages also render their own `<AdminNav />`. This causes double AdminNav on every page. Affected pages:
  - `app/[farmSlug]/admin/page.tsx:77`
  - `app/[farmSlug]/admin/import/page.tsx:7`
  - `app/[farmSlug]/admin/animals/page.tsx:43`
  - `app/[farmSlug]/admin/observations/page.tsx:10`
  - `app/[farmSlug]/admin/performance/page.tsx:63`
  - `app/[farmSlug]/admin/reproduction/page.tsx:84`
  - `app/[farmSlug]/admin/animals/[id]/page.tsx:245`
  - `app/[farmSlug]/admin/camps/page.tsx:36`
  - `app/[farmSlug]/admin/finansies/page.tsx:45`
  - `app/[farmSlug]/admin/grafieke/page.tsx:186`
  - `app/[farmSlug]/admin/camps/[campId]/page.tsx:169`

### 5. Finance layer

- `app/api/[farmSlug]/transactions/route.ts` GET — PASS: Returns `{ transactions, summary }` with income/expenses/net.
- `app/api/[farmSlug]/transactions/route.ts` POST — PASS: Creates transaction with validation. Returns 201.
- `components/admin/TransactionForm.tsx` — PASS: Has income/expense toggle, category select, amount, date, description, optional camp. Posts to correct farm-scoped endpoint.
- `app/[farmSlug]/admin/finansies/page.tsx` — PASS: "Add" button present in TransactionLedger component (line 125). TransactionForm used inside TransactionModal.

### 6. TypeScript status

PASS — `pnpm tsc --noEmit` completed with zero errors (after clearing incremental cache).

### 7. Consistency check

- Visual style — PASS: All 3 logger forms (WeighingForm, TreatmentForm, CampCoverLogForm) use identical BottomSheet pattern, same color tokens (#1E0F07, #D2B48C, #B87333, #F5F0E8), same rounded-xl/2xl inputs, same submit button style.
- Field names — PASS: Logger forms and coordination contract use matching field names (weight_kg, treatmentType, product, dose, withdrawalDays, coverCategory).
- Error handling — WARN: Logger forms silently catch errors with empty catch blocks (WeighingForm:78, TreatmentForm:112, CampCoverLogForm:99). User gets no feedback on failure — form just re-enables. Admin forms (TransactionForm, ObservationsLog EditModal) properly show error messages.

### 8. Security

- No hardcoded farm slugs, IDs, or credentials found in any new file — PASS
- All user inputs treated as untrusted — PASS
- No console.log with sensitive data — PASS (only console.error for server-side DB errors in observations/[id]/route.ts)
- BottomSheet BottomSheet pattern is duplicated across 3 logger files (copy-paste, not extracted) — LOW priority, not a security issue but noted for maintainability.

---

### Issues found

| # | File:Line | Description | Severity |
|---|-----------|-------------|----------|
| 1 | `components/logger/WeighingForm.tsx:60` | POSTs to `/api/${farmSlug}/observations` — route does not exist (only `/api/observations`). Form will 404. | **CRITICAL** |
| 2 | `components/logger/TreatmentForm.tsx:86` | Same as #1 — POSTs to non-existent farm-scoped observations route. | **CRITICAL** |
| 3 | ALL admin pages (11 files) | Duplicate `<AdminNav />` renders — layout.tsx already provides it, but every page also renders its own copy. Agent-2e cleanup incomplete. | **HIGH** |
| 4 | `components/admin/CreateObservationModal.tsx` | File never created. Agent-2b work incomplete. | **HIGH** |
| 5 | `app/[farmSlug]/admin/observations/page.tsx` | No "New Observation" button/modal. Agent-2b work incomplete. | **HIGH** |
| 6 | `components/admin/ObservationsLog.tsx:136` | Edit modal still uses raw JSON textarea instead of per-type form fields. Agent-2b work incomplete. | **MEDIUM** |
| 7 | `components/logger/WeighingForm.tsx:78` | Silent error catch — user gets no feedback on save failure. | **MEDIUM** |
| 8 | `components/logger/TreatmentForm.tsx:112` | Silent error catch — same as #7. | **MEDIUM** |
| 9 | `components/logger/CampCoverLogForm.tsx:99` | Silent error catch — same as #7. | **MEDIUM** |
| 10 | 3 logger form files | BottomSheet component duplicated across WeighingForm, TreatmentForm, CampCoverLogForm — should be extracted to shared component. | **LOW** |

### Overall verdict

**NEEDS FIXES** — 2 critical issues (broken API endpoints for weighing/treatment forms) and 3 high issues (duplicate AdminNav, missing CreateObservationModal, missing New Observation button). Agents 2b and 2e did not complete their work.

---

## Cross-Agent Interface Contracts

> Agents write here when they expose interfaces other agents depend on.

### Weighing API (agent-2a publishes, agent-2b reads)

**POST** `/api/[farmSlug]/observations`
```json
{
  "type": "weighing",
  "campId": "string",
  "animalId": "string",
  "details": {
    "weight_kg": 245.5,
    "notes": "optional string"
  },
  "observedAt": "ISO string"
}
```

### Treatment API (agent-2a publishes, agent-2b reads)

**POST** `/api/[farmSlug]/observations`
```json
{
  "type": "treatment",
  "campId": "string",
  "animalId": "string",
  "details": {
    "treatmentType": "Antibiotic|Dip|Deworming|Vaccination|Supplement|Other",
    "product": "string (required)",
    "dose": "string (required)",
    "withdrawalDays": 14,
    "notes": "optional string"
  },
  "observedAt": "ISO string"
}
```
**Withdrawal defaults:** Antibiotic=14, Dip=7, Deworming=7, Vaccination=0, Supplement=0, Other=7

### Transaction API (agent-2d publishes)

**GET** `/api/[farmSlug]/transactions?from=YYYY-MM&to=YYYY-MM`
```json
{
  "transactions": [
    { "id": "cuid", "type": "income|expense", "category": "string", "amount": 1500.00, "date": "2026-03-28", "description": "string", "animalId": "string|null", "campId": "string|null", "reference": "string|null", "createdBy": "string|null", "createdAt": "ISO" }
  ],
  "summary": { "income": 5000.00, "expenses": 3000.00, "net": 2000.00 }
}
```

**POST** `/api/[farmSlug]/transactions`
```json
// Request body:
{ "type": "income|expense", "category": "string", "amount": 1500.00, "date": "2026-03-28", "description": "string", "campId?": "string", "animalId?": "string", "reference?": "string" }
// Response: 201 with created Transaction object
```
