# Design Spec: FarmTrack Language System (i18n)

**Date:** 2026-03-16
**Phase:** 2 — Language System
**Status:** Approved

---

## Overview

Add a bilingual (English / Afrikaans) language system to FarmTrack. All UI-facing text is currently hardcoded in Afrikaans. This spec covers the full replacement with a translation key system, a cookie-based language preference, and a Settings page toggle.

**Default language:** English (`en`)
**Alternate language:** Afrikaans (`af`)
**Scope:** UI display strings only. Database field names, API routes, and Prisma schema are untouched.

---

## Decisions

| Decision | Choice | Reason |
|---|---|---|
| Storage mechanism | Cookie (`farmtrack-lang`) | Works for both Server and Client Components in Next.js App Router. localStorage cannot be read server-side. |
| i18n approach | Custom lightweight (no library) | Zero dependencies. Two languages, no pluralisation needed. Tailored to this architecture. |
| Default language | English | Aligns with multi-tenant SaaS direction; non-Afrikaans farms should see English by default. |
| Toggle location | Dedicated `/settings` page | Accessible from both admin nav (sidebar) and logger header (icon link). |
| Server/client module split | Separate `server.ts` and `client.ts` | Prevents client bundle from importing server-only code (avoids Next.js build errors). |
| Date formatting | `Intl.DateTimeFormat` with locale | Replaces hardcoded `DAYS_AF`/`MONTHS_AF` arrays. `en` → `en-ZA` locale, `af` → `af-ZA`. |
| Settings back button | `router.back()` | Avoids platform detection; works correctly from both admin and logger entry points. |

---

## Architecture

### 1. Translation Files

#### `lib/i18n/en.ts`

```ts
export const en = {
  nav: {
    overview: "Overview",
    observations: "Observations",
    animals: "Animals",
    camps: "Camps",
    import: "Import",
    charts: "Charts",
    finances: "Finances",
    settings: "Settings",
    admin: "Admin",
  },
  admin: {
    title: "Operations Overview",
    totalAnimals: "Total Animals",
    totalCamps: "Total Camps",
    inspectionsToday: "Inspections Today",
    healthIssues: "Health Issues",
    activeRecords: "Active records",
    campsOnFarm: "camps on farm",
    campsChecked: "Camps checked",
    recordedThisWeek: "Recorded this week",
    recentHealthIncidents: "Recent Health Incidents",
    campStatusSummary: "Camp Status Summary",
    noHealthIncidents: "No health incidents recorded.",
    unknown: "Unknown",
    camps: "camps",
    grazingGood: "Good grazing (Good)",
    grazingFair: "Fair grazing (Fair)",
    grazingPoor: "Poor grazing (Poor)",
    grazingOvergrazed: "Overgrazed (Overgrazed)",
    farmManagement: "Farm Management",
  },
  logger: {
    selectCamp: "Select a camp",
    allNormal: "All Normal — Camp Good",
    allNormalDone: "✓ All normal recorded!",
    campConditionReport: "Report Camp Condition",
    animalsInCamp: "Animals in camp",
    tapIconToReport: "Tap icon to report",
    campNotFound: "Camp not found",
    recordDeath: "Record Death",
    confirmDeath: "Confirm that animal",
    isDeceased: "is deceased?",
    cancel: "Cancel",
    animals: "animals",
    water: "water",
  },
  animal: {
    health: "Health",
    move: "Move",
    calving: "Calving",
    death: "Death",
    noAnimals: "No animals in this camp.",
  },
  health: {
    title: "Health Report",
    symptoms: "Symptoms (select all that apply)",
    severity: "Severity",
    notes: "Additional notes (optional)",
    notesPlaceholder: "Describe the problem...",
    submit: "Submit Report",
    mild: "Mild case",
    moderate: "Moderate case",
    severe: "Severe — urgent attention",
    symptomLame: "Lame",
    symptomThin: "Thin",
    symptomEye: "Eye problem",
    symptomWound: "Wound",
    symptomDiarrhea: "Diarrhea",
    symptomNasal: "Nasal discharge",
    symptomBloat: "Bloated",
    symptomNotEating: "Not eating",
    symptomOther: "Other",
  },
  movement: {
    title: "Move Animal",
    currentCamp: "Current camp:",
    moveToCamp: "Move to camp",
    confirm: "Confirm Move",
  },
  calving: {
    title: "Calving",
    calfName: "Calf name (optional)",
    calfNamePlaceholder: "e.g. Star",
    calfSex: "Calf sex",
    calfAlive: "Calf alive?",
    alive: "Alive",
    stillborn: "Stillborn",
    easeOfBirth: "Ease of birth",
    unassisted: "Unassisted",
    assisted: "Assisted",
    difficult: "Difficult",
    notes: "Notes (optional)",
    notesPlaceholder: "Any additional information...",
    submit: "Record Birth",
    female: "Female",
    male: "Male",
  },
  condition: {
    title: "Camp Condition",
    grazing: "Grazing condition",
    water: "Water status",
    fence: "Fence",
    notes: "Notes (optional)",
    notesPlaceholder: "Any additional remarks...",
    submit: "Submit Camp Report",
    grazingGood: "Good",
    grazingFair: "Fair",
    grazingPoor: "Poor",
    grazingOvergrazed: "Overgrazed",
    waterFull: "Full",
    waterLow: "Low",
    waterEmpty: "Empty",
    waterBroken: "Broken",
    fenceIntact: "Intact",
    fenceDamaged: "Damaged",
  },
  death: {
    unknown: "Unknown",
    redwater: "Redwater",
    heartwater: "Heartwater",
    snake: "Snake",
    age: "Old age",
    birthComplications: "Birth complications",
    other: "Other",
  },
  finances: {
    incomeThisMonth: "Income (this month)",
    expensesThisMonth: "Expenses (this month)",
    netThisMonth: "Net (this month)",
  },
  settings: {
    title: "Settings",
    language: "Language / Taal",
    back: "Back",
  },
  offline: {
    offline: "Offline",
    online: "Online",
    pending: "pending",
  },
  common: {
    signOut: "Sign Out",
  },
}

export type Translations = typeof en
export type Language = "en" | "af"
```

#### `lib/i18n/af.ts`

Mirrors the exact shape of `en.ts` using current Afrikaans strings. The file header:
```ts
import type { Translations } from "./en"
export const af: Translations = {
  // ... all current Afrikaans strings
}
```

The `af: Translations` type annotation enforces parity — missing or extra keys are TypeScript compile errors.

---

### 2. `lib/i18n/server.ts`

**Server-only module.** Never imported by Client Components.

```ts
import { en } from "./en"
import { af } from "./af"
import type { Translations, Language } from "./en"

const translations: Record<Language, Translations> = { en, af }

export function getTranslations(lang: string | undefined): Translations {
  return translations[(lang as Language) ?? "en"] ?? translations.en
}
```

Usage in Server Components:
```tsx
import { cookies } from "next/headers"
import { getTranslations } from "@/lib/i18n/server"

const lang = (await cookies()).get("farmtrack-lang")?.value
const t = getTranslations(lang)
// t.admin.title, t.nav.overview, etc.
```

---

### 3. `lib/i18n/client.ts`

**Client-safe module.** Contains React context and hook only.

```ts
"use client"
import { createContext, useContext } from "react"
import type { Translations, Language } from "./en"

export interface LanguageContextValue {
  t: Translations
  lang: Language
  setLanguage: (lang: Language) => void
}

export const LanguageContext = createContext<LanguageContextValue | null>(null)

export function useTranslations(): LanguageContextValue {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error("useTranslations must be used within LanguageProvider")
  return ctx
}
```

---

### 4. `lib/i18n/actions.ts` (Server Action)

```ts
"use server"
import { cookies } from "next/headers"
import type { Language } from "./en"

export async function setLanguageCookie(lang: Language) {
  const cookieStore = await cookies()
  cookieStore.set("farmtrack-lang", lang, {
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  })
}
```

---

### 5. `components/LanguageProvider.tsx`

```tsx
"use client"
import { useRouter } from "next/navigation"
import { en } from "@/lib/i18n/en"
import { af } from "@/lib/i18n/af"
import { LanguageContext } from "@/lib/i18n/client"
import { setLanguageCookie } from "@/lib/i18n/actions"
import type { Language } from "@/lib/i18n/en"

const translationMap = { en, af }

export function LanguageProvider({
  initialLang,
  children,
}: {
  initialLang: Language
  children: React.ReactNode
}) {
  const [lang, setLang] = useState<Language>(initialLang)
  const router = useRouter()

  async function setLanguage(newLang: Language) {
    await setLanguageCookie(newLang)
    setLang(newLang)
    router.refresh() // re-renders Server Components with new cookie
  }

  return (
    <LanguageContext.Provider value={{ t: translationMap[lang], lang, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  )
}
```

**Note on `router.refresh()`:** This re-fetches Server Component data with the new cookie. The `LanguageProvider` receives the updated `initialLang` prop from the server after refresh, and `useState` re-initialises with the new value. Client components update instantly via context.

---

### 6. `app/providers.tsx` — updated

Add `initialLang: Language` prop. Wrap children with `LanguageProvider`:

```tsx
"use client"
import { SessionProvider } from "next-auth/react"
import { LanguageProvider } from "@/components/LanguageProvider"
import type { Language } from "@/lib/i18n/en"

export function Providers({ children, session, initialLang }) {
  return (
    <SessionProvider session={session} refetchOnWindowFocus={false}>
      <LanguageProvider initialLang={initialLang}>
        {children}
      </LanguageProvider>
    </SessionProvider>
  )
}
```

---

### 7. `app/layout.tsx` — updated

Read cookie server-side, set `lang` on `<html>`, pass `initialLang` to `Providers`:

```tsx
import { cookies } from "next/headers"

const cookieStore = await cookies()
const lang = (cookieStore.get("farmtrack-lang")?.value ?? "en") as Language

return (
  <html lang={lang}>   {/* ← dynamic, was hardcoded "en" */}
    <body ...>
      <Providers session={session} initialLang={lang}>{children}</Providers>
    </body>
  </html>
)
```

---

### 8. Date Formatting

`app/logger/page.tsx` currently uses hardcoded `DAYS_AF`/`MONTHS_AF` arrays. Replace with `Intl.DateTimeFormat`:

```ts
function getTodayLabel(lang: Language): string {
  const locale = lang === "af" ? "af-ZA" : "en-ZA"
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date())
}
```

This page is a Server Component, so it calls `getTranslations(lang)` for static strings and `getTodayLabel(lang)` for the date.

---

## Settings Page

**Route:** `/settings`

- Responsive, works on mobile (logger) and desktop (admin)
- "Back" button uses `router.back()` (no platform detection needed)
- Two pill buttons: `EN | English` and `AF | Afrikaans`
- Active button highlighted in copper `#B87333` (matches app brand)
- Selecting a language calls `setLanguage()` from `useTranslations()` context — which sets the cookie and calls `router.refresh()`
- No save button — instant effect

**Entry points:**
- Admin sidebar (`AdminNav.tsx`): Settings link added above Sign Out
- Logger header (`app/logger/page.tsx`): ⚙️ icon link added next to Sign Out button

---

## Files Changed

| Action | File | Notes |
|---|---|---|
| **Create** | `lib/i18n/en.ts` | English translations + `Translations` and `Language` types |
| **Create** | `lib/i18n/af.ts` | Afrikaans translations, typed as `Translations` |
| **Create** | `lib/i18n/server.ts` | `getTranslations()` for Server Components only |
| **Create** | `lib/i18n/client.ts` | `LanguageContext` + `useTranslations()` hook |
| **Create** | `lib/i18n/actions.ts` | Server Action: `setLanguageCookie()` |
| **Create** | `components/LanguageProvider.tsx` | Client context provider |
| **Create** | `app/settings/page.tsx` | Language toggle settings page |
| **Edit** | `app/providers.tsx` | Accept `initialLang`, wrap with `LanguageProvider` |
| **Edit** | `app/layout.tsx` | Read cookie, set `lang` on `<html>`, pass `initialLang` |
| **Edit** | `components/admin/AdminNav.tsx` | Add Settings link; replace Afrikaans nav labels with `t.nav.*` |
| **Edit** | `app/logger/page.tsx` | Add ⚙️ icon; replace date logic + hardcoded strings |
| **Edit** | `app/logger/[campId]/page.tsx` | Replace all hardcoded strings |
| **Edit** | `components/logger/AnimalChecklist.tsx` | Replace hardcoded strings |
| **Edit** | `components/logger/HealthIssueForm.tsx` | Replace SYMPTOMS, SEVERITIES arrays + all labels |
| **Edit** | `components/logger/MovementForm.tsx` | Replace "Huidige kamp:", "Skuif na kamp", "Bevestig Skuif" |
| **Edit** | `components/logger/CalvingForm.tsx` | Replace all SegmentGroup labels + button text |
| **Edit** | `components/logger/CampConditionForm.tsx` | Replace GRAZING_OPTIONS, WATER_OPTIONS, FENCE_OPTIONS labels + CardGroup labels |
| **Edit** | `components/logger/LoggerStatusBar.tsx` | Replace hardcoded strings |
| **Edit** | `components/logger/SignOutButton.tsx` | Replace "Teken Uit" or equivalent |
| **Edit** | `components/logger/CampSelector.tsx` | Replace hardcoded strings |
| **Edit** | `app/admin/page.tsx` | Read cookie → `getTranslations(lang)` → replace all strings |
| **Edit** | `app/admin/observations/page.tsx` | Read cookie → `getTranslations(lang)` → replace strings |
| **Edit** | `app/admin/animals/page.tsx` | Read cookie → `getTranslations(lang)` → replace strings |
| **Edit** | `app/admin/animals/[id]/page.tsx` | Read cookie → `getTranslations(lang)` → replace strings |
| **Edit** | `app/admin/camps/page.tsx` | Read cookie → `getTranslations(lang)` → replace strings |
| **Edit** | `app/admin/import/page.tsx` | Read cookie → `getTranslations(lang)` → replace strings |
| **Edit** | `app/admin/grafieke/page.tsx` | Read cookie → `getTranslations(lang)` → replace strings |
| **Edit** | `app/admin/finansies/page.tsx` | Read cookie → `getTranslations(lang)` → replace strings |
| **Edit** | `components/admin/AnimalsTable.tsx` | Replace hardcoded strings |
| **Edit** | `components/admin/CampsTable.tsx` | Replace hardcoded strings |
| **Edit** | `components/admin/ObservationsLog.tsx` | Replace hardcoded strings |
| **Edit** | `components/admin/AnimalImporter.tsx` | Replace hardcoded strings |
| **Edit** | `components/admin/FinansiesClient.tsx` | Replace StatsCard labels (income/expense/net) |
| **Edit** | `components/admin/finansies/TransactionLedger.tsx` | Replace hardcoded strings |
| **Edit** | `components/admin/finansies/CategoryManager.tsx` | Replace hardcoded strings |
| **Edit** | `components/admin/finansies/TrendChart.tsx` | Replace hardcoded strings if any |
| **Edit** | `components/admin/finansies/AnimalActions.tsx` | Replace hardcoded strings if any |
| **Edit** | `components/admin/GrafiekeClient.tsx` | Replace hardcoded strings |
| **Edit** | `components/admin/charts/DiereTab.tsx` | Replace hardcoded strings |
| **Edit** | `components/admin/charts/KampeTab.tsx` | Replace hardcoded strings |
| **Edit** | `components/admin/StatsCard.tsx` | Check for any hardcoded strings |
| **Edit** | `app/login/page.tsx` | Replace hardcoded strings |
| **Edit** | `app/offline/page.tsx` | Replace hardcoded strings |

---

## Server Component Pattern

Every Server Component page that renders translated strings must follow this pattern:

```tsx
import { cookies } from "next/headers"
import { getTranslations } from "@/lib/i18n/server"

export default async function SomePage() {
  const lang = (await cookies()).get("farmtrack-lang")?.value
  const t = getTranslations(lang)

  return <h1>{t.admin.title}</h1>
}
```

**Never use `useTranslations()` (a client hook) in a Server Component.** Server Components use `getTranslations()` from `lib/i18n/server.ts`.

---

## Constraints

- Do NOT touch database field names, API routes, or Prisma schema
- Do NOT change URL structure
- No new npm/pnpm dependencies
- pnpm build uses `--webpack` flag (Turbopack breaks Serwist)
- `lib/i18n/server.ts` must never be imported from a Client Component tree
- `lib/i18n/client.ts` is the only i18n module safe to import in Client Components
