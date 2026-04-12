/**
 * seed-basson-boerdery.ts — Provision and populate Basson Boerdery farm
 *
 * First FarmTrack client onboarding. Creates the farm DB, users, and imports
 * all data from Kobus Basson's onboarding files.
 *
 * Prerequisites:
 *   1. Run migrate-meta-nullable-email.ts first (makes email nullable)
 *   2. Ensure META_TURSO env vars are set
 *   3. Ensure TURSO_ORG_NAME and TURSO_API_TOKEN are set (for DB creation)
 *
 * Run:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/seed-basson-boerdery.ts
 */

import { createClient, type Client } from '@libsql/client';
import { hashSync } from 'bcryptjs';
import { randomUUID } from 'crypto';
import { FARM_SCHEMA_SQL } from '../lib/farm-schema';
import {
  createUser,
  createFarm,
  createFarmUser,
  getFarmBySlug,
} from '../lib/meta-db';
import { createTursoDatabase } from '../lib/turso-api';

// ── Config ───────────────────────────────────────────────────────────────────

const FARM_SLUG = 'basson-boerdery';
const FARM_NAME = 'Basson Boerdery';
const FARM_TIER = 'advanced';

const TODAY = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

// ── Helpers ──────────────────────────────────────────────────────────────────

function cuid(): string {
  return randomUUID().replace(/-/g, '').slice(0, 25);
}

function isoDate(dateStr: string): string {
  // Convert DD/MM/YYYY → YYYY-MM-DD
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
  }
  return dateStr;
}

function approxDate(monthYear: string): string {
  // Convert "Jan 2018", "Mrt 2018", "Feb 2019" etc. → YYYY-MM-15
  const monthMap: Record<string, string> = {
    'jan': '01', 'feb': '02', 'mrt': '03', 'mar': '03', 'apr': '04',
    'mei': '05', 'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
    'sep': '09', 'okt': '10', 'oct': '10', 'nov': '11', 'des': '12', 'dec': '12',
  };
  const parts = monthYear.trim().split(/\s+/);
  if (parts.length === 2) {
    const month = monthMap[parts[0].toLowerCase()] ?? '01';
    return `${parts[1]}-${month}-15`;
  }
  return monthYear;
}

// ── Camp Data ────────────────────────────────────────────────────────────────

interface CampRecord {
  campId: string;
  campName: string;
  sizeHectares: number;
  waterSource: string;
}

const CAMPS: CampRecord[] = [
  { campId: 'weiveld-1', campName: 'Weiveld 1', sizeHectares: 320, waterSource: 'borehole' },
  { campId: 'weiveld-2', campName: 'Weiveld 2', sizeHectares: 280, waterSource: 'borehole' },
  { campId: 'weiveld-3', campName: 'Weiveld 3', sizeHectares: 350, waterSource: 'borehole' },
  { campId: 'bergkamp', campName: 'Bergkamp', sizeHectares: 480, waterSource: 'river' },
  { campId: 'rivierkamp', campName: 'Rivierkamp', sizeHectares: 190, waterSource: 'river' },
  { campId: 'speenkamp', campName: 'Speenkamp', sizeHectares: 80, waterSource: 'trough' },
  { campId: 'bullekamp', campName: 'Bullekamp', sizeHectares: 120, waterSource: 'borehole' },
  { campId: 'siekboeg', campName: 'Siekboeg', sizeHectares: 15, waterSource: 'trough' },
  { campId: 'kwarantyn', campName: 'Kwarantyn', sizeHectares: 25, waterSource: 'trough' },
];

// Map Afrikaans camp names to campIds
const CAMP_MAP: Record<string, string> = {
  'Weiveld 1': 'weiveld-1',
  'Weiveld 2': 'weiveld-2',
  'Weiveld 3': 'weiveld-3',
  'Bergkamp': 'bergkamp',
  ' Bergkamp': 'bergkamp', // leading space in CSV
  'Rivierkamp': 'rivierkamp',
  'Speenkamp': 'speenkamp',
  'Bullekamp': 'bullekamp',
  'Siekboeg': 'siekboeg',
  'Kwarantyn': 'kwarantyn',
};

function mapCamp(csvCamp: string): string {
  return CAMP_MAP[csvCamp.trim()] ?? csvCamp.trim().toLowerCase().replace(/\s+/g, '-');
}

// ── Animal Data ──────────────────────────────────────────────────────────────

interface AnimalRecord {
  animalId: string;
  registrationNumber: string | null;
  breed: string;
  sex: 'Male' | 'Female';
  category: 'Cow' | 'Bull' | 'Heifer' | 'Calf' | 'Ox';
  dateOfBirth: string | null;
  motherId: string | null;
  fatherId: string | null;
  currentCamp: string;
  status: 'Active' | 'Sold' | 'Deceased';
  deceasedAt: string | null;
}

function opt(val: string | undefined): string | null {
  if (!val || val === '?' || val === '') return null;
  return val.trim();
}

// Stud cows (BB-C001 to BB-C030)
const STUD_COWS: AnimalRecord[] = [
  { animalId: 'BB-C001', registrationNumber: 'BSB-2019-04412', breed: 'Bonsmara', sex: 'Female', category: 'Cow', dateOfBirth: '2019-03-12', motherId: 'BB-C088', fatherId: 'BB-B001', currentCamp: 'weiveld-1', status: 'Active', deceasedAt: null },
  { animalId: 'BB-C002', registrationNumber: 'BSB-2019-04413', breed: 'Bonsmara', sex: 'Female', category: 'Cow', dateOfBirth: '2019-04-03', motherId: 'BB-C091', fatherId: 'BB-B001', currentCamp: 'weiveld-1', status: 'Active', deceasedAt: null },
  { animalId: 'BB-C003', registrationNumber: 'BSB-2020-05201', breed: 'Bonsmara', sex: 'Female', category: 'Cow', dateOfBirth: '2020-02-18', motherId: 'BB-C072', fatherId: 'BB-B002', currentCamp: 'weiveld-1', status: 'Active', deceasedAt: null },
  { animalId: 'BB-C004', registrationNumber: 'BSB-2020-05202', breed: 'Bonsmara', sex: 'Female', category: 'Cow', dateOfBirth: '2020-03-05', motherId: 'BB-C084', fatherId: 'BB-B002', currentCamp: 'weiveld-1', status: 'Active', deceasedAt: null },
  { animalId: 'BB-C005', registrationNumber: 'BSB-2021-06114', breed: 'Bonsmara', sex: 'Female', category: 'Cow', dateOfBirth: '2021-01-22', motherId: 'BB-C090', fatherId: 'BB-B003', currentCamp: 'weiveld-1', status: 'Active', deceasedAt: null },
  { animalId: 'BB-C006', registrationNumber: 'BSB-2021-06115', breed: 'Bonsmara', sex: 'Female', category: 'Cow', dateOfBirth: '2021-02-14', motherId: 'BB-C073', fatherId: 'BB-B001', currentCamp: 'weiveld-1', status: 'Active', deceasedAt: null },
  { animalId: 'BB-C007', registrationNumber: 'BSB-2021-06116', breed: 'Bonsmara', sex: 'Female', category: 'Cow', dateOfBirth: '2021-03-09', motherId: 'BB-C081', fatherId: 'BB-B003', currentCamp: 'weiveld-2', status: 'Active', deceasedAt: null },
  { animalId: 'BB-C008', registrationNumber: 'BSB-2022-07034', breed: 'Bonsmara', sex: 'Female', category: 'Cow', dateOfBirth: '2022-01-30', motherId: 'BB-C077', fatherId: 'BB-B002', currentCamp: 'weiveld-2', status: 'Active', deceasedAt: null },
  { animalId: 'BB-C009', registrationNumber: 'BSB-2022-07035', breed: 'Bonsmara', sex: 'Female', category: 'Cow', dateOfBirth: '2022-02-11', motherId: 'BB-C082', fatherId: 'BB-B004', currentCamp: 'weiveld-2', status: 'Active', deceasedAt: null },
  { animalId: 'BB-C010', registrationNumber: 'BSB-2022-07036', breed: 'Bonsmara', sex: 'Female', category: 'Cow', dateOfBirth: '2022-03-28', motherId: 'BB-C079', fatherId: 'BB-B004', currentCamp: 'weiveld-2', status: 'Active', deceasedAt: null },
  { animalId: 'BB-C011', registrationNumber: 'BSB-2023-08201', breed: 'Bonsmara', sex: 'Female', category: 'Cow', dateOfBirth: '2023-01-17', motherId: 'BB-C085', fatherId: 'BB-B003', currentCamp: 'weiveld-2', status: 'Active', deceasedAt: null },
  { animalId: 'BB-C012', registrationNumber: 'BSB-2023-08202', breed: 'Bonsmara', sex: 'Female', category: 'Cow', dateOfBirth: '2023-02-04', motherId: 'BB-C088', fatherId: 'BB-B001', currentCamp: 'weiveld-2', status: 'Active', deceasedAt: null },
  { animalId: 'BB-C013', registrationNumber: 'BSB-2018-03301', breed: 'Bonsmara', sex: 'Female', category: 'Cow', dateOfBirth: '2018-04-14', motherId: null, fatherId: null, currentCamp: 'bergkamp', status: 'Active', deceasedAt: null },
  { animalId: 'BB-C014', registrationNumber: 'BSB-2018-03302', breed: 'Bonsmara', sex: 'Female', category: 'Cow', dateOfBirth: '2018-05-02', motherId: null, fatherId: null, currentCamp: 'bergkamp', status: 'Active', deceasedAt: null },
  { animalId: 'BB-C015', registrationNumber: 'BSB-2019-04414', breed: 'Bonsmara', sex: 'Female', category: 'Cow', dateOfBirth: '2019-01-28', motherId: 'BB-C071', fatherId: 'BB-B001', currentCamp: 'bergkamp', status: 'Active', deceasedAt: null },
  { animalId: 'BB-C016', registrationNumber: 'BSB-2019-04415', breed: 'Bonsmara', sex: 'Female', category: 'Cow', dateOfBirth: '2019-02-15', motherId: 'BB-C069', fatherId: 'BB-B002', currentCamp: 'bergkamp', status: 'Active', deceasedAt: null },
  { animalId: 'BB-C017', registrationNumber: 'BSB-2020-05203', breed: 'Bonsmara', sex: 'Female', category: 'Cow', dateOfBirth: '2020-04-07', motherId: 'BB-C080', fatherId: 'BB-B003', currentCamp: 'bergkamp', status: 'Active', deceasedAt: null },
  { animalId: 'BB-C018', registrationNumber: 'BSB-2020-05204', breed: 'Bonsmara', sex: 'Female', category: 'Cow', dateOfBirth: '2020-05-19', motherId: 'BB-C083', fatherId: 'BB-B001', currentCamp: 'weiveld-3', status: 'Active', deceasedAt: null },
  { animalId: 'BB-C019', registrationNumber: 'BSB-2021-06117', breed: 'Bonsmara', sex: 'Female', category: 'Cow', dateOfBirth: '2021-01-11', motherId: 'BB-C087', fatherId: 'BB-B004', currentCamp: 'weiveld-3', status: 'Active', deceasedAt: null },
  { animalId: 'BB-C020', registrationNumber: 'BSB-2021-06118', breed: 'Bonsmara', sex: 'Female', category: 'Cow', dateOfBirth: '2021-04-23', motherId: 'BB-C074', fatherId: 'BB-B002', currentCamp: 'weiveld-3', status: 'Active', deceasedAt: null },
  { animalId: 'BB-C021', registrationNumber: 'BSB-2021-06119', breed: 'Bonsmara', sex: 'Female', category: 'Cow', dateOfBirth: '2021-06-02', motherId: 'BB-C076', fatherId: 'BB-B001', currentCamp: 'weiveld-3', status: 'Active', deceasedAt: null },
  { animalId: 'BB-C022', registrationNumber: 'BSB-2022-07037', breed: 'Bonsmara', sex: 'Female', category: 'Cow', dateOfBirth: '2022-01-14', motherId: 'BB-C089', fatherId: 'BB-B003', currentCamp: 'weiveld-1', status: 'Active', deceasedAt: null },
  { animalId: 'BB-C023', registrationNumber: 'BSB-2022-07038', breed: 'Bonsmara', sex: 'Female', category: 'Cow', dateOfBirth: '2022-02-28', motherId: 'BB-C075', fatherId: 'BB-B004', currentCamp: 'weiveld-1', status: 'Active', deceasedAt: null },
  { animalId: 'BB-C024', registrationNumber: 'BSB-2022-07039', breed: 'Bonsmara', sex: 'Female', category: 'Cow', dateOfBirth: '2022-04-11', motherId: 'BB-C071', fatherId: 'BB-B002', currentCamp: 'weiveld-2', status: 'Active', deceasedAt: null },
  { animalId: 'BB-C025', registrationNumber: 'BSB-2023-08203', breed: 'Bonsmara', sex: 'Female', category: 'Cow', dateOfBirth: '2023-01-22', motherId: 'BB-C080', fatherId: 'BB-B003', currentCamp: 'weiveld-2', status: 'Active', deceasedAt: null },
  { animalId: 'BB-C026', registrationNumber: 'BSB-2023-08204', breed: 'Bonsmara', sex: 'Female', category: 'Cow', dateOfBirth: '2023-03-08', motherId: 'BB-C082', fatherId: 'BB-B001', currentCamp: 'weiveld-3', status: 'Active', deceasedAt: null },
  { animalId: 'BB-C027', registrationNumber: 'BSB-2019-04416', breed: 'Bonsmara', sex: 'Female', category: 'Cow', dateOfBirth: '2019-03-19', motherId: 'BB-C077', fatherId: 'BB-B002', currentCamp: 'weiveld-3', status: 'Active', deceasedAt: null },
  { animalId: 'BB-C028', registrationNumber: 'BSB-2020-05205', breed: 'Bonsmara', sex: 'Female', category: 'Cow', dateOfBirth: '2020-01-31', motherId: 'BB-C084', fatherId: 'BB-B003', currentCamp: 'weiveld-1', status: 'Active', deceasedAt: null },
  { animalId: 'BB-C029', registrationNumber: 'BSB-2021-06120', breed: 'Bonsmara', sex: 'Female', category: 'Cow', dateOfBirth: '2021-05-16', motherId: 'BB-C090', fatherId: 'BB-B001', currentCamp: 'weiveld-2', status: 'Active', deceasedAt: null },
  { animalId: 'BB-C030', registrationNumber: 'BSB-2022-07040', breed: 'Bonsmara', sex: 'Female', category: 'Cow', dateOfBirth: '2022-02-03', motherId: 'BB-C073', fatherId: 'BB-B004', currentCamp: 'bergkamp', status: 'Active', deceasedAt: null },
];

// Commercial cows (BB-X001 to BB-X030) — approximate DOBs, partial pedigree
const COMMERCIAL_COWS: AnimalRecord[] = [
  { animalId: 'BB-X001', registrationNumber: null, breed: 'Bonsmara Cross', sex: 'Female', category: 'Cow', dateOfBirth: '2018-01-15', motherId: null, fatherId: null, currentCamp: 'weiveld-1', status: 'Active', deceasedAt: null },
  { animalId: 'BB-X002', registrationNumber: null, breed: 'Bonsmara Cross', sex: 'Female', category: 'Cow', dateOfBirth: '2018-03-15', motherId: null, fatherId: null, currentCamp: 'weiveld-1', status: 'Active', deceasedAt: null },
  { animalId: 'BB-X003', registrationNumber: null, breed: 'Bonsmara Cross', sex: 'Female', category: 'Cow', dateOfBirth: '2019-02-15', motherId: null, fatherId: 'BB-B003', currentCamp: 'weiveld-1', status: 'Active', deceasedAt: null },
  { animalId: 'BB-X004', registrationNumber: null, breed: 'Bonsmara Cross', sex: 'Female', category: 'Cow', dateOfBirth: '2017-11-15', motherId: null, fatherId: null, currentCamp: 'weiveld-2', status: 'Active', deceasedAt: null },
  { animalId: 'BB-X005', registrationNumber: null, breed: 'Bonsmara Cross', sex: 'Female', category: 'Cow', dateOfBirth: '2018-06-15', motherId: null, fatherId: null, currentCamp: 'weiveld-2', status: 'Active', deceasedAt: null },
  { animalId: 'BB-X006', registrationNumber: null, breed: 'Bonsmara', sex: 'Female', category: 'Cow', dateOfBirth: '2019-04-15', motherId: null, fatherId: 'BB-B001', currentCamp: 'weiveld-2', status: 'Active', deceasedAt: null },
  { animalId: 'BB-X007', registrationNumber: null, breed: 'Bonsmara Cross', sex: 'Female', category: 'Cow', dateOfBirth: '2020-01-15', motherId: null, fatherId: 'BB-B002', currentCamp: 'weiveld-3', status: 'Active', deceasedAt: null },
  { animalId: 'BB-X008', registrationNumber: null, breed: 'Bonsmara Cross', sex: 'Female', category: 'Cow', dateOfBirth: '2016-08-15', motherId: null, fatherId: null, currentCamp: 'bergkamp', status: 'Active', deceasedAt: null },
  { animalId: 'BB-X009', registrationNumber: null, breed: 'Bonsmara', sex: 'Female', category: 'Cow', dateOfBirth: '2020-03-15', motherId: null, fatherId: 'BB-B004', currentCamp: 'weiveld-3', status: 'Active', deceasedAt: null },
  { animalId: 'BB-X010', registrationNumber: null, breed: 'Bonsmara Cross', sex: 'Female', category: 'Cow', dateOfBirth: '2019-07-15', motherId: null, fatherId: null, currentCamp: 'weiveld-1', status: 'Active', deceasedAt: null },
  { animalId: 'BB-X011', registrationNumber: null, breed: 'Bonsmara Cross', sex: 'Female', category: 'Cow', dateOfBirth: '2018-02-15', motherId: null, fatherId: null, currentCamp: 'weiveld-1', status: 'Active', deceasedAt: null },
  { animalId: 'BB-X012', registrationNumber: null, breed: 'Bonsmara Cross', sex: 'Female', category: 'Cow', dateOfBirth: '2019-09-15', motherId: null, fatherId: 'BB-B003', currentCamp: 'weiveld-2', status: 'Active', deceasedAt: null },
  { animalId: 'BB-X013', registrationNumber: null, breed: 'Bonsmara Cross', sex: 'Female', category: 'Cow', dateOfBirth: '2018-04-15', motherId: null, fatherId: null, currentCamp: 'weiveld-2', status: 'Active', deceasedAt: null },
  { animalId: 'BB-X014', registrationNumber: null, breed: 'Bonsmara Cross', sex: 'Female', category: 'Cow', dateOfBirth: '2019-01-15', motherId: null, fatherId: null, currentCamp: 'weiveld-3', status: 'Active', deceasedAt: null },
  { animalId: 'BB-X015', registrationNumber: null, breed: 'Bonsmara', sex: 'Female', category: 'Cow', dateOfBirth: '2020-03-15', motherId: null, fatherId: 'BB-B001', currentCamp: 'weiveld-3', status: 'Active', deceasedAt: null },
  { animalId: 'BB-X016', registrationNumber: null, breed: 'Bonsmara Cross', sex: 'Female', category: 'Cow', dateOfBirth: '2017-06-15', motherId: null, fatherId: null, currentCamp: 'bergkamp', status: 'Active', deceasedAt: null },
  { animalId: 'BB-X017', registrationNumber: null, breed: 'Bonsmara Cross', sex: 'Female', category: 'Cow', dateOfBirth: '2018-11-15', motherId: null, fatherId: null, currentCamp: 'weiveld-1', status: 'Active', deceasedAt: null },
  { animalId: 'BB-X018', registrationNumber: null, breed: 'Bonsmara Cross', sex: 'Female', category: 'Cow', dateOfBirth: '2019-02-15', motherId: null, fatherId: null, currentCamp: 'weiveld-2', status: 'Active', deceasedAt: null },
  { animalId: 'BB-X019', registrationNumber: null, breed: 'Bonsmara Cross', sex: 'Female', category: 'Cow', dateOfBirth: '2020-10-15', motherId: null, fatherId: 'BB-B002', currentCamp: 'weiveld-3', status: 'Active', deceasedAt: null },
  { animalId: 'BB-X020', registrationNumber: null, breed: 'Bonsmara Cross', sex: 'Female', category: 'Cow', dateOfBirth: '2019-03-15', motherId: null, fatherId: null, currentCamp: 'weiveld-1', status: 'Active', deceasedAt: null },
  { animalId: 'BB-X021', registrationNumber: null, breed: 'Bonsmara Cross', sex: 'Female', category: 'Cow', dateOfBirth: '2018-01-15', motherId: null, fatherId: null, currentCamp: 'weiveld-2', status: 'Active', deceasedAt: null },
  { animalId: 'BB-X022', registrationNumber: null, breed: 'Bonsmara Cross', sex: 'Female', category: 'Cow', dateOfBirth: '2019-04-15', motherId: null, fatherId: 'BB-B003', currentCamp: 'weiveld-3', status: 'Active', deceasedAt: null },
  { animalId: 'BB-X023', registrationNumber: null, breed: 'Bonsmara Cross', sex: 'Female', category: 'Cow', dateOfBirth: '2018-07-15', motherId: null, fatherId: null, currentCamp: 'weiveld-1', status: 'Active', deceasedAt: null },
  { animalId: 'BB-X024', registrationNumber: null, breed: 'Bonsmara Cross', sex: 'Female', category: 'Cow', dateOfBirth: '2020-02-15', motherId: null, fatherId: null, currentCamp: 'weiveld-2', status: 'Active', deceasedAt: null },
  { animalId: 'BB-X025', registrationNumber: null, breed: 'Bonsmara', sex: 'Female', category: 'Cow', dateOfBirth: '2019-09-15', motherId: null, fatherId: 'BB-B004', currentCamp: 'weiveld-3', status: 'Active', deceasedAt: null },
  { animalId: 'BB-X026', registrationNumber: null, breed: 'Bonsmara Cross', sex: 'Female', category: 'Cow', dateOfBirth: '2018-03-15', motherId: null, fatherId: null, currentCamp: 'bergkamp', status: 'Active', deceasedAt: null },
  { animalId: 'BB-X027', registrationNumber: null, breed: 'Bonsmara Cross', sex: 'Female', category: 'Cow', dateOfBirth: '2019-01-15', motherId: null, fatherId: null, currentCamp: 'weiveld-1', status: 'Active', deceasedAt: null },
  { animalId: 'BB-X028', registrationNumber: null, breed: 'Bonsmara Cross', sex: 'Female', category: 'Cow', dateOfBirth: '2020-06-15', motherId: null, fatherId: 'BB-B001', currentCamp: 'weiveld-2', status: 'Active', deceasedAt: null },
  { animalId: 'BB-X029', registrationNumber: null, breed: 'Bonsmara Cross', sex: 'Female', category: 'Cow', dateOfBirth: '2018-02-15', motherId: null, fatherId: null, currentCamp: 'weiveld-3', status: 'Active', deceasedAt: null },
  { animalId: 'BB-X030', registrationNumber: null, breed: 'Bonsmara Cross', sex: 'Female', category: 'Cow', dateOfBirth: '2019-10-15', motherId: null, fatherId: null, currentCamp: 'weiveld-1', status: 'Active', deceasedAt: null },
];

// Bulls (BB-B001 to BB-B004)
const BULLS: AnimalRecord[] = [
  { animalId: 'BB-B001', registrationNumber: 'BSB-2017-01884', breed: 'Bonsmara', sex: 'Male', category: 'Bull', dateOfBirth: '2017-08-14', motherId: null, fatherId: null, currentCamp: 'bullekamp', status: 'Active', deceasedAt: null },
  { animalId: 'BB-B002', registrationNumber: 'BSB-2018-02341', breed: 'Bonsmara', sex: 'Male', category: 'Bull', dateOfBirth: '2018-05-22', motherId: null, fatherId: null, currentCamp: 'bullekamp', status: 'Active', deceasedAt: null },
  { animalId: 'BB-B003', registrationNumber: 'BSB-2019-03512', breed: 'Bonsmara', sex: 'Male', category: 'Bull', dateOfBirth: '2019-03-11', motherId: null, fatherId: 'BB-B001', currentCamp: 'bullekamp', status: 'Active', deceasedAt: null },
  { animalId: 'BB-B004', registrationNumber: 'BSB-2020-04701', breed: 'Bonsmara', sex: 'Male', category: 'Bull', dateOfBirth: '2020-09-04', motherId: null, fatherId: null, currentCamp: 'bullekamp', status: 'Active', deceasedAt: null },
];

// Sold animals (historical)
const SOLD_ANIMALS: AnimalRecord[] = [
  { animalId: 'BB-B005', registrationNumber: null, breed: 'Bonsmara', sex: 'Male', category: 'Bull', dateOfBirth: null, motherId: null, fatherId: 'BB-B001', currentCamp: 'bullekamp', status: 'Sold', deceasedAt: null },
  { animalId: 'BB-X094', registrationNumber: null, breed: 'Bonsmara Cross', sex: 'Female', category: 'Cow', dateOfBirth: null, motherId: null, fatherId: null, currentCamp: 'bergkamp', status: 'Sold', deceasedAt: null },
];

// Deceased animals (historical)
const DECEASED_ANIMALS: AnimalRecord[] = [
  { animalId: 'BB-C089', registrationNumber: null, breed: 'Bonsmara', sex: 'Female', category: 'Cow', dateOfBirth: null, motherId: null, fatherId: null, currentCamp: 'bergkamp', status: 'Deceased', deceasedAt: '2025-09-11' },
];

// Replacement heifers (BB-H001 to BB-H010)
const HEIFERS: AnimalRecord[] = [
  { animalId: 'BB-H001', registrationNumber: 'BSB-2024-10112', breed: 'Bonsmara', sex: 'Female', category: 'Heifer', dateOfBirth: '2024-02-08', motherId: 'BB-C001', fatherId: 'BB-B001', currentCamp: 'rivierkamp', status: 'Active', deceasedAt: null },
  { animalId: 'BB-H002', registrationNumber: 'BSB-2024-10113', breed: 'Bonsmara', sex: 'Female', category: 'Heifer', dateOfBirth: '2024-03-14', motherId: 'BB-C005', fatherId: 'BB-B003', currentCamp: 'rivierkamp', status: 'Active', deceasedAt: null },
  { animalId: 'BB-H003', registrationNumber: null, breed: 'Bonsmara Cross', sex: 'Female', category: 'Heifer', dateOfBirth: '2024-02-22', motherId: 'BB-X012', fatherId: 'BB-B002', currentCamp: 'rivierkamp', status: 'Active', deceasedAt: null },
  { animalId: 'BB-H004', registrationNumber: 'BSB-2024-10114', breed: 'Bonsmara', sex: 'Female', category: 'Heifer', dateOfBirth: '2024-04-01', motherId: 'BB-C008', fatherId: 'BB-B002', currentCamp: 'rivierkamp', status: 'Active', deceasedAt: null },
  { animalId: 'BB-H005', registrationNumber: null, breed: 'Bonsmara Cross', sex: 'Female', category: 'Heifer', dateOfBirth: '2024-03-30', motherId: 'BB-X019', fatherId: 'BB-B003', currentCamp: 'rivierkamp', status: 'Active', deceasedAt: null },
  { animalId: 'BB-H006', registrationNumber: null, breed: 'Bonsmara Cross', sex: 'Female', category: 'Heifer', dateOfBirth: '2024-05-11', motherId: 'BB-X027', fatherId: 'BB-B004', currentCamp: 'rivierkamp', status: 'Active', deceasedAt: null },
  { animalId: 'BB-H007', registrationNumber: 'BSB-2024-10115', breed: 'Bonsmara', sex: 'Female', category: 'Heifer', dateOfBirth: '2024-01-18', motherId: 'BB-C010', fatherId: 'BB-B001', currentCamp: 'rivierkamp', status: 'Active', deceasedAt: null },
  { animalId: 'BB-H008', registrationNumber: null, breed: 'Bonsmara Cross', sex: 'Female', category: 'Heifer', dateOfBirth: '2024-03-03', motherId: 'BB-X003', fatherId: 'BB-B002', currentCamp: 'rivierkamp', status: 'Active', deceasedAt: null },
  { animalId: 'BB-H009', registrationNumber: 'BSB-2024-10116', breed: 'Bonsmara', sex: 'Female', category: 'Heifer', dateOfBirth: '2024-02-25', motherId: 'BB-C007', fatherId: 'BB-B003', currentCamp: 'rivierkamp', status: 'Active', deceasedAt: null },
  { animalId: 'BB-H010', registrationNumber: null, breed: 'Bonsmara Cross', sex: 'Female', category: 'Heifer', dateOfBirth: '2024-04-12', motherId: 'BB-X015', fatherId: 'BB-B004', currentCamp: 'rivierkamp', status: 'Active', deceasedAt: null },
];

// Weaners (BB-W001 to BB-W014) — includes BB-W013 and BB-W014 from calving record
const WEANERS: AnimalRecord[] = [
  { animalId: 'BB-W001', registrationNumber: null, breed: 'Bonsmara', sex: 'Male', category: 'Calf', dateOfBirth: '2025-08-14', motherId: 'BB-C003', fatherId: 'BB-B001', currentCamp: 'speenkamp', status: 'Active', deceasedAt: null },
  { animalId: 'BB-W002', registrationNumber: null, breed: 'Bonsmara', sex: 'Female', category: 'Calf', dateOfBirth: '2025-08-22', motherId: 'BB-C007', fatherId: 'BB-B003', currentCamp: 'speenkamp', status: 'Active', deceasedAt: null },
  { animalId: 'BB-W003', registrationNumber: null, breed: 'Bonsmara Cross', sex: 'Male', category: 'Calf', dateOfBirth: '2025-09-04', motherId: 'BB-X034', fatherId: 'BB-B002', currentCamp: 'speenkamp', status: 'Active', deceasedAt: null },
  { animalId: 'BB-W004', registrationNumber: null, breed: 'Bonsmara Cross', sex: 'Male', category: 'Calf', dateOfBirth: '2025-09-18', motherId: 'BB-X041', fatherId: 'BB-B001', currentCamp: 'speenkamp', status: 'Active', deceasedAt: null },
  { animalId: 'BB-W005', registrationNumber: null, breed: 'Bonsmara', sex: 'Female', category: 'Calf', dateOfBirth: '2025-08-31', motherId: 'BB-C011', fatherId: 'BB-B002', currentCamp: 'speenkamp', status: 'Active', deceasedAt: null },
  { animalId: 'BB-W006', registrationNumber: null, breed: 'Bonsmara', sex: 'Male', category: 'Calf', dateOfBirth: '2025-10-03', motherId: 'BB-C002', fatherId: 'BB-B001', currentCamp: 'speenkamp', status: 'Active', deceasedAt: null },
  { animalId: 'BB-W007', registrationNumber: null, breed: 'Bonsmara Cross', sex: 'Male', category: 'Calf', dateOfBirth: '2025-09-12', motherId: 'BB-X052', fatherId: 'BB-B004', currentCamp: 'speenkamp', status: 'Active', deceasedAt: null },
  { animalId: 'BB-W008', registrationNumber: null, breed: 'Bonsmara', sex: 'Male', category: 'Calf', dateOfBirth: '2025-08-28', motherId: 'BB-C006', fatherId: 'BB-B003', currentCamp: 'speenkamp', status: 'Active', deceasedAt: null },
  { animalId: 'BB-W009', registrationNumber: null, breed: 'Bonsmara Cross', sex: 'Female', category: 'Calf', dateOfBirth: '2025-09-07', motherId: 'BB-X021', fatherId: 'BB-B002', currentCamp: 'speenkamp', status: 'Active', deceasedAt: null },
  { animalId: 'BB-W010', registrationNumber: null, breed: 'Bonsmara', sex: 'Male', category: 'Calf', dateOfBirth: '2025-09-15', motherId: 'BB-C012', fatherId: 'BB-B001', currentCamp: 'speenkamp', status: 'Active', deceasedAt: null },
  { animalId: 'BB-W011', registrationNumber: null, breed: 'Bonsmara Cross', sex: 'Male', category: 'Calf', dateOfBirth: '2025-09-24', motherId: 'BB-X029', fatherId: 'BB-B004', currentCamp: 'speenkamp', status: 'Active', deceasedAt: null },
  { animalId: 'BB-W012', registrationNumber: null, breed: 'Bonsmara', sex: 'Female', category: 'Calf', dateOfBirth: '2025-10-01', motherId: 'BB-C019', fatherId: 'BB-B003', currentCamp: 'speenkamp', status: 'Active', deceasedAt: null },
  { animalId: 'BB-W013', registrationNumber: null, breed: 'Bonsmara Cross', sex: 'Male', category: 'Calf', dateOfBirth: '2025-10-08', motherId: 'BB-X003', fatherId: 'BB-B002', currentCamp: 'speenkamp', status: 'Active', deceasedAt: null },
  { animalId: 'BB-W014', registrationNumber: null, breed: 'Bonsmara', sex: 'Female', category: 'Calf', dateOfBirth: '2025-10-12', motherId: 'BB-C005', fatherId: 'BB-B003', currentCamp: 'speenkamp', status: 'Active', deceasedAt: null },
];

// Quarantine heifers (BB-Q001 to BB-Q012) — purchased from Van Aswegen
const QUARANTINE: AnimalRecord[] = [
  { animalId: 'BB-Q001', registrationNumber: null, breed: 'Bonsmara', sex: 'Female', category: 'Heifer', dateOfBirth: '2023-09-15', motherId: null, fatherId: null, currentCamp: 'kwarantyn', status: 'Active', deceasedAt: null },
  { animalId: 'BB-Q002', registrationNumber: null, breed: 'Bonsmara', sex: 'Female', category: 'Heifer', dateOfBirth: '2023-10-15', motherId: null, fatherId: null, currentCamp: 'kwarantyn', status: 'Active', deceasedAt: null },
  { animalId: 'BB-Q003', registrationNumber: null, breed: 'Bonsmara', sex: 'Female', category: 'Heifer', dateOfBirth: '2023-09-15', motherId: null, fatherId: null, currentCamp: 'kwarantyn', status: 'Active', deceasedAt: null },
  { animalId: 'BB-Q004', registrationNumber: null, breed: 'Bonsmara', sex: 'Female', category: 'Heifer', dateOfBirth: '2023-11-15', motherId: null, fatherId: null, currentCamp: 'kwarantyn', status: 'Active', deceasedAt: null },
  { animalId: 'BB-Q005', registrationNumber: null, breed: 'Bonsmara', sex: 'Female', category: 'Heifer', dateOfBirth: '2023-10-15', motherId: null, fatherId: null, currentCamp: 'kwarantyn', status: 'Active', deceasedAt: null },
  { animalId: 'BB-Q006', registrationNumber: null, breed: 'Bonsmara', sex: 'Female', category: 'Heifer', dateOfBirth: '2024-01-15', motherId: null, fatherId: null, currentCamp: 'kwarantyn', status: 'Active', deceasedAt: null },
  { animalId: 'BB-Q007', registrationNumber: null, breed: 'Bonsmara', sex: 'Female', category: 'Heifer', dateOfBirth: '2023-09-15', motherId: null, fatherId: null, currentCamp: 'kwarantyn', status: 'Active', deceasedAt: null },
  { animalId: 'BB-Q008', registrationNumber: null, breed: 'Bonsmara', sex: 'Female', category: 'Heifer', dateOfBirth: '2023-10-15', motherId: null, fatherId: null, currentCamp: 'kwarantyn', status: 'Active', deceasedAt: null },
  { animalId: 'BB-Q009', registrationNumber: null, breed: 'Bonsmara', sex: 'Female', category: 'Heifer', dateOfBirth: '2023-10-15', motherId: null, fatherId: null, currentCamp: 'kwarantyn', status: 'Active', deceasedAt: null },
  { animalId: 'BB-Q010', registrationNumber: null, breed: 'Bonsmara', sex: 'Female', category: 'Heifer', dateOfBirth: '2023-11-15', motherId: null, fatherId: null, currentCamp: 'kwarantyn', status: 'Active', deceasedAt: null },
  { animalId: 'BB-Q011', registrationNumber: null, breed: 'Bonsmara', sex: 'Female', category: 'Heifer', dateOfBirth: '2023-09-15', motherId: null, fatherId: null, currentCamp: 'kwarantyn', status: 'Active', deceasedAt: null },
  { animalId: 'BB-Q012', registrationNumber: null, breed: 'Bonsmara', sex: 'Female', category: 'Heifer', dateOfBirth: '2023-12-15', motherId: null, fatherId: null, currentCamp: 'kwarantyn', status: 'Active', deceasedAt: null },
];

const ALL_ANIMALS: AnimalRecord[] = [
  ...STUD_COWS,
  ...COMMERCIAL_COWS,
  ...BULLS,
  ...SOLD_ANIMALS,
  ...DECEASED_ANIMALS,
  ...HEIFERS,
  ...WEANERS,
  ...QUARANTINE,
];

// ── Observation Data ─────────────────────────────────────────────────────────

interface ObsRecord {
  type: string;
  campId: string;
  animalId: string | null;
  details: Record<string, unknown>;
  observedAt: string;   // ISO datetime
  loggedBy: string;
}

// KI Program observations
function buildKIObservations(): ObsRecord[] {
  const obs: ObsRecord[] = [];

  // Stud cow inseminations
  const kiData: Array<{ tag: string; kiDate: string; scanDate: string; result: string }> = [
    { tag: 'BB-C001', kiDate: '2025-04-22', scanDate: '2025-06-28', result: 'pregnant' },
    { tag: 'BB-C002', kiDate: '2025-04-22', scanDate: '2025-06-28', result: 'pregnant' },
    { tag: 'BB-C003', kiDate: '2025-04-22', scanDate: '2025-06-28', result: 'pregnant' },
    { tag: 'BB-C004', kiDate: '2025-04-22', scanDate: '2025-06-28', result: 'empty' },
    { tag: 'BB-C005', kiDate: '2025-04-23', scanDate: '2025-06-28', result: 'pregnant' },
    { tag: 'BB-C006', kiDate: '2025-04-23', scanDate: '2025-06-28', result: 'pregnant' },
    { tag: 'BB-C007', kiDate: '2025-04-23', scanDate: '2025-06-28', result: 'pregnant' },
    { tag: 'BB-C008', kiDate: '2025-04-24', scanDate: '2025-06-29', result: 'pregnant' },
    { tag: 'BB-C009', kiDate: '2025-04-24', scanDate: '2025-06-29', result: 'empty' },
    { tag: 'BB-C010', kiDate: '2025-04-24', scanDate: '2025-06-29', result: 'pregnant' },
    { tag: 'BB-C011', kiDate: '2025-05-01', scanDate: '2025-07-01', result: 'pregnant' },
    { tag: 'BB-C012', kiDate: '2025-05-01', scanDate: '2025-07-01', result: 'pregnant' },
    { tag: 'BB-C013', kiDate: '2025-05-02', scanDate: '2025-07-01', result: 'empty' },
    { tag: 'BB-C015', kiDate: '2025-04-23', scanDate: '2025-06-28', result: 'pregnant' },
    { tag: 'BB-C016', kiDate: '2025-04-23', scanDate: '2025-06-28', result: 'pregnant' },
    { tag: 'BB-C017', kiDate: '2025-04-24', scanDate: '2025-06-29', result: 'pregnant' }, // natural
    { tag: 'BB-C018', kiDate: '2025-05-01', scanDate: '2025-07-01', result: 'pregnant' },
    { tag: 'BB-C019', kiDate: '2025-05-01', scanDate: '2025-07-01', result: 'pregnant' },
    { tag: 'BB-C020', kiDate: '2025-05-02', scanDate: '2025-07-02', result: 'pregnant' },
    { tag: 'BB-C021', kiDate: '2025-05-02', scanDate: '2025-07-02', result: 'pregnant' },
    { tag: 'BB-C022', kiDate: '2025-04-23', scanDate: '2025-06-28', result: 'pregnant' },
    { tag: 'BB-C023', kiDate: '2025-04-23', scanDate: '2025-06-28', result: 'pregnant' },
    { tag: 'BB-C024', kiDate: '2025-04-24', scanDate: '2025-06-29', result: 'empty' },
    { tag: 'BB-C025', kiDate: '2025-05-01', scanDate: '2025-07-01', result: 'pregnant' },
    { tag: 'BB-C026', kiDate: '2025-05-01', scanDate: '2025-07-01', result: 'pregnant' },
    { tag: 'BB-C027', kiDate: '2025-04-22', scanDate: '2025-06-28', result: 'pregnant' },
    { tag: 'BB-C028', kiDate: '2025-04-23', scanDate: '2025-06-28', result: 'pregnant' },
    { tag: 'BB-C029', kiDate: '2025-04-24', scanDate: '2025-06-29', result: 'pregnant' },
  ];

  // Commercial cow KI (only positives recorded)
  const commercialKI: Array<{ tag: string; kiDate: string; scanDate: string; result: string }> = [
    { tag: 'BB-X001', kiDate: '2025-04-22', scanDate: '2025-06-28', result: 'pregnant' },
    { tag: 'BB-X003', kiDate: '2025-04-22', scanDate: '2025-06-28', result: 'pregnant' },
    { tag: 'BB-X005', kiDate: '2025-04-23', scanDate: '2025-06-28', result: 'pregnant' },
    { tag: 'BB-X006', kiDate: '2025-04-23', scanDate: '2025-06-28', result: 'pregnant' },
    { tag: 'BB-X007', kiDate: '2025-04-24', scanDate: '2025-06-29', result: 'pregnant' },
    { tag: 'BB-X009', kiDate: '2025-04-24', scanDate: '2025-06-29', result: 'pregnant' },
    { tag: 'BB-X010', kiDate: '2025-04-22', scanDate: '2025-06-28', result: 'pregnant' },
    { tag: 'BB-X015', kiDate: '2025-05-01', scanDate: '2025-07-01', result: 'pregnant' },
    { tag: 'BB-X019', kiDate: '2025-05-01', scanDate: '2025-07-01', result: 'empty' },
    { tag: 'BB-X020', kiDate: '2025-04-22', scanDate: '2025-06-28', result: 'pregnant' },
  ];

  const allKI = [...kiData, ...commercialKI];

  for (const ki of allKI) {
    // Find animal's camp
    const animal = ALL_ANIMALS.find((a) => a.animalId === ki.tag);
    const camp = animal?.currentCamp ?? 'weiveld-1';

    // Insemination observation
    obs.push({
      type: 'insemination',
      campId: camp,
      animalId: ki.tag,
      details: { method: 'AI', semenLot: 'Bonsmara SA - Lot 4412' },
      observedAt: `${ki.kiDate}T08:00:00.000Z`,
      loggedBy: 'danie.basson@outlook.com',
    });

    // Pregnancy scan observation
    obs.push({
      type: 'pregnancy_scan',
      campId: camp,
      animalId: ki.tag,
      details: { result: ki.result },
      observedAt: `${ki.scanDate}T08:00:00.000Z`,
      loggedBy: 'kobus.basson@gmail.com',
    });
  }

  return obs;
}

// Calving observations
function buildCalvingObservations(): ObsRecord[] {
  const calvings: Array<{
    date: string; dam: string; calfTag: string | null;
    calfSex: string; calfAlive: boolean; ease: string;
    fatherId: string | null;
  }> = [
    { date: '2025-08-14', dam: 'BB-C003', calfTag: 'BB-W001', calfSex: 'Male', calfAlive: true, ease: 'Unassisted', fatherId: 'BB-B001' },
    { date: '2025-08-22', dam: 'BB-C007', calfTag: 'BB-W002', calfSex: 'Female', calfAlive: true, ease: 'Unassisted', fatherId: 'BB-B003' },
    { date: '2025-08-28', dam: 'BB-C006', calfTag: 'BB-W008', calfSex: 'Male', calfAlive: true, ease: 'Unassisted', fatherId: 'BB-B003' },
    { date: '2025-08-31', dam: 'BB-C011', calfTag: 'BB-W005', calfSex: 'Female', calfAlive: true, ease: 'Unassisted', fatherId: 'BB-B002' },
    { date: '2025-09-04', dam: 'BB-X034', calfTag: 'BB-W003', calfSex: 'Male', calfAlive: true, ease: 'Unassisted', fatherId: 'BB-B002' },
    { date: '2025-09-07', dam: 'BB-X021', calfTag: 'BB-W009', calfSex: 'Female', calfAlive: true, ease: 'Unassisted', fatherId: 'BB-B002' },
    { date: '2025-09-11', dam: 'BB-C089', calfTag: null, calfSex: 'Male', calfAlive: false, ease: 'Difficult', fatherId: null },
    { date: '2025-09-12', dam: 'BB-X052', calfTag: 'BB-W007', calfSex: 'Male', calfAlive: true, ease: 'Unassisted', fatherId: 'BB-B004' },
    { date: '2025-09-15', dam: 'BB-C012', calfTag: 'BB-W010', calfSex: 'Male', calfAlive: true, ease: 'Unassisted', fatherId: 'BB-B001' },
    { date: '2025-09-18', dam: 'BB-X041', calfTag: 'BB-W004', calfSex: 'Male', calfAlive: true, ease: 'Unassisted', fatherId: 'BB-B001' },
    { date: '2025-09-24', dam: 'BB-X029', calfTag: 'BB-W011', calfSex: 'Male', calfAlive: true, ease: 'Unassisted', fatherId: 'BB-B004' },
    { date: '2025-10-01', dam: 'BB-C019', calfTag: 'BB-W012', calfSex: 'Female', calfAlive: true, ease: 'Unassisted', fatherId: 'BB-B003' },
    { date: '2025-10-03', dam: 'BB-C002', calfTag: 'BB-W006', calfSex: 'Male', calfAlive: true, ease: 'Unassisted', fatherId: 'BB-B001' },
    { date: '2025-10-08', dam: 'BB-X003', calfTag: 'BB-W013', calfSex: 'Male', calfAlive: true, ease: 'Unassisted', fatherId: 'BB-B002' },
    { date: '2025-10-12', dam: 'BB-C005', calfTag: 'BB-W014', calfSex: 'Female', calfAlive: true, ease: 'Unassisted', fatherId: 'BB-B003' },
  ];

  return calvings.map((c) => {
    const animal = ALL_ANIMALS.find((a) => a.animalId === c.dam);
    const camp = animal?.currentCamp ?? 'weiveld-1';
    return {
      type: 'calving',
      campId: camp,
      animalId: c.dam,
      details: {
        calf_id: c.calfTag,
        calf_sex: c.calfSex,
        calf_alive: c.calfAlive,
        ease_of_birth: c.ease,
        father_id: c.fatherId,
        date_of_birth: c.date,
        breed: c.calfTag?.startsWith('BB-W') ? 'Bonsmara' : 'Bonsmara Cross',
        category: 'Calf',
      },
      observedAt: `${c.date}T08:00:00.000Z`,
      loggedBy: 'kobus.basson@gmail.com',
    };
  });
}

// Treatment observations
function buildTreatmentObservations(): ObsRecord[] {
  const obs: ObsRecord[] = [];

  // Individual treatments
  const individualTreatments: Array<{
    date: string; tag: string; camp: string;
    treatmentType: string; product: string; dose: string;
    withdrawalDays: number; loggedBy: string;
  }> = [
    { date: '2025-10-02', tag: 'BB-C004', camp: 'siekboeg', treatmentType: 'Antibiotic', product: 'Penstrep 400', dose: '20ml IM', withdrawalDays: 28, loggedBy: 'kobus.basson@gmail.com' },
    { date: '2025-10-02', tag: 'BB-C004', camp: 'siekboeg', treatmentType: 'Other', product: 'Finadyne', dose: '10ml IV', withdrawalDays: 5, loggedBy: 'kobus.basson@gmail.com' },
    { date: '2025-10-08', tag: 'BB-X008', camp: 'siekboeg', treatmentType: 'Antibiotic', product: 'Penstrep 400', dose: '20ml IM', withdrawalDays: 28, loggedBy: 'kobus.basson@gmail.com' },
    { date: '2025-10-08', tag: 'BB-X008', camp: 'siekboeg', treatmentType: 'Other', product: 'Finadyne', dose: '10ml IV', withdrawalDays: 5, loggedBy: 'kobus.basson@gmail.com' },
    { date: '2025-10-28', tag: 'BB-X041', camp: 'siekboeg', treatmentType: 'Antibiotic', product: 'Terramycin LA', dose: '15ml IM', withdrawalDays: 21, loggedBy: 'kobus.basson@gmail.com' },
    { date: '2025-11-05', tag: 'BB-H006', camp: 'rivierkamp', treatmentType: 'Other', product: 'Terramycin Eye Ointment', dose: 'Topical', withdrawalDays: 0, loggedBy: 'louis.petrus' },
    { date: '2025-11-19', tag: 'BB-C009', camp: 'siekboeg', treatmentType: 'Other', product: 'Estrumate', dose: '2ml IM', withdrawalDays: 3, loggedBy: 'kobus.basson@gmail.com' },
    { date: '2025-12-15', tag: 'BB-B004', camp: 'bullekamp', treatmentType: 'Antibiotic', product: 'Penstrep 400', dose: '25ml IM', withdrawalDays: 28, loggedBy: 'kobus.basson@gmail.com' },
    { date: '2026-01-22', tag: 'BB-H003', camp: 'rivierkamp', treatmentType: 'Deworming', product: 'Levamisole', dose: '10ml oral', withdrawalDays: 7, loggedBy: 'kobus.basson@gmail.com' },
    { date: '2026-02-04', tag: 'BB-X019', camp: 'siekboeg', treatmentType: 'Antibiotic', product: 'Draxxin', dose: '12ml SC', withdrawalDays: 63, loggedBy: 'kobus.basson@gmail.com' },
    { date: '2026-02-04', tag: 'BB-X019', camp: 'siekboeg', treatmentType: 'Other', product: 'Metacam', dose: '8ml IV', withdrawalDays: 10, loggedBy: 'kobus.basson@gmail.com' },
  ];

  for (const t of individualTreatments) {
    obs.push({
      type: 'treatment',
      campId: t.camp,
      animalId: t.tag,
      details: {
        treatment_type: t.treatmentType,
        product: t.product,
        dose: t.dose,
        withdrawal_days: t.withdrawalDays,
      },
      observedAt: `${t.date}T08:00:00.000Z`,
      loggedBy: t.loggedBy,
    });
  }

  // Batch vaccination: March 2026 — all known animals
  const vaccinationDate = '2026-03-03';
  const vaccines = [
    { product: 'Skaaplamsiekte (LSD)', dose: '2ml SC', treatmentType: 'Vaccination' as const },
    { product: 'Covexin 8', dose: '2ml SC', treatmentType: 'Vaccination' as const },
    { product: 'Riftdaliewe koors', dose: '1ml SC', treatmentType: 'Vaccination' as const },
  ];

  // Apply to all active animals
  const activeAnimals = ALL_ANIMALS.filter((a) => a.status === 'Active');
  for (const animal of activeAnimals) {
    for (const vax of vaccines) {
      obs.push({
        type: 'treatment',
        campId: animal.currentCamp,
        animalId: animal.animalId,
        details: {
          treatment_type: vax.treatmentType,
          product: vax.product,
          dose: vax.dose,
          withdrawal_days: 0,
        },
        observedAt: `${vaccinationDate}T08:00:00.000Z`,
        loggedBy: 'kobus.basson@gmail.com',
      });
    }
  }

  // Brucella S19 for heifers BB-H001, BB-H002, BB-H004
  for (const tag of ['BB-H001', 'BB-H002', 'BB-H004']) {
    obs.push({
      type: 'treatment',
      campId: 'rivierkamp',
      animalId: tag,
      details: {
        treatment_type: 'Vaccination',
        product: 'Brucella S19',
        dose: '2ml SC',
        withdrawal_days: 0,
      },
      observedAt: `${vaccinationDate}T08:00:00.000Z`,
      loggedBy: 'kobus.basson@gmail.com',
    });
  }

  // Quarantine treatments (BB-Q001 to BB-Q012)
  for (let i = 1; i <= 12; i++) {
    const tag = `BB-Q${String(i).padStart(3, '0')}`;
    // Dectomax deworming
    obs.push({
      type: 'treatment',
      campId: 'kwarantyn',
      animalId: tag,
      details: { treatment_type: 'Deworming', product: 'Dectomax Pour-On', dose: 'Per weight', withdrawal_days: 35 },
      observedAt: '2026-03-18T08:00:00.000Z',
      loggedBy: 'kobus.basson@gmail.com',
    });
    // Covexin 8
    obs.push({
      type: 'treatment',
      campId: 'kwarantyn',
      animalId: tag,
      details: { treatment_type: 'Vaccination', product: 'Covexin 8', dose: '2ml SC', withdrawal_days: 0 },
      observedAt: '2026-03-18T08:00:00.000Z',
      loggedBy: 'kobus.basson@gmail.com',
    });
    // Triatix dip
    obs.push({
      type: 'treatment',
      campId: 'kwarantyn',
      animalId: tag,
      details: { treatment_type: 'Dip', product: 'Triatix', dose: 'Per label', withdrawal_days: 14 },
      observedAt: '2026-03-18T08:00:00.000Z',
      loggedBy: 'kobus.basson@gmail.com',
    });
  }

  // Vibrio + Tricho for all bulls
  for (const tag of ['BB-B001', 'BB-B002', 'BB-B003', 'BB-B004']) {
    obs.push({
      type: 'treatment',
      campId: 'bullekamp',
      animalId: tag,
      details: { treatment_type: 'Vaccination', product: 'Vibrio + Trichomonose', dose: '2ml SC', withdrawal_days: 0 },
      observedAt: '2026-03-25T08:00:00.000Z',
      loggedBy: 'kobus.basson@gmail.com',
    });
  }

  // Weaner speendag treatments (14 Oct 2025)
  const weanerTags = WEANERS.map((w) => w.animalId);
  for (const tag of weanerTags) {
    obs.push({
      type: 'treatment',
      campId: 'speenkamp',
      animalId: tag,
      details: { treatment_type: 'Deworming', product: 'Dectomax Pour-On', dose: 'Per weight', withdrawal_days: 35 },
      observedAt: '2025-10-14T08:00:00.000Z',
      loggedBy: 'louis.petrus',
    });
    obs.push({
      type: 'treatment',
      campId: 'speenkamp',
      animalId: tag,
      details: { treatment_type: 'Vaccination', product: 'Covexin 8', dose: '2ml SC', withdrawal_days: 0 },
      observedAt: '2025-10-14T08:00:00.000Z',
      loggedBy: 'kobus.basson@gmail.com',
    });
  }

  // Animal movement: BB-X019 return from siekboeg to weiveld-3
  obs.push({
    type: 'animal_movement',
    campId: 'weiveld-3',
    animalId: 'BB-X019',
    details: { from_camp: 'siekboeg', to_camp: 'weiveld-3' },
    observedAt: '2026-02-18T08:00:00.000Z',
    loggedBy: 'kobus.basson@gmail.com',
  });

  return obs;
}

// Weighing observations from register data
function buildWeighingObservations(): ObsRecord[] {
  const obs: ObsRecord[] = [];

  // All animals with weight data
  const weightData: Array<{ tag: string; weight: number; date: string; camp: string }> = [
    // Stud cows (15/01/2026)
    ...STUD_COWS.filter((a) => a.status === 'Active').map((a, i) => {
      const weights = [512,498,487,503,462,478,491,445,461,439,421,418,538,521,509,517,494,476,468,452,441,433,448,429,415,408,501,488,459,511];
      return { tag: a.animalId, weight: weights[i] ?? 450, date: i < 12 || i >= 17 ? '2026-01-15' : '2025-10-20', camp: a.currentCamp };
    }),
    // Bulls
    { tag: 'BB-B001', weight: 812, date: '2026-01-15', camp: 'bullekamp' },
    { tag: 'BB-B002', weight: 774, date: '2026-01-15', camp: 'bullekamp' },
    { tag: 'BB-B003', weight: 741, date: '2026-01-15', camp: 'bullekamp' },
    { tag: 'BB-B004', weight: 698, date: '2026-01-15', camp: 'bullekamp' },
    // Heifers
    { tag: 'BB-H001', weight: 334, date: '2026-01-15', camp: 'rivierkamp' },
    { tag: 'BB-H002', weight: 318, date: '2026-01-15', camp: 'rivierkamp' },
    { tag: 'BB-H003', weight: 311, date: '2026-01-15', camp: 'rivierkamp' },
    { tag: 'BB-H004', weight: 305, date: '2026-01-15', camp: 'rivierkamp' },
    { tag: 'BB-H005', weight: 298, date: '2026-01-15', camp: 'rivierkamp' },
    { tag: 'BB-H006', weight: 287, date: '2026-01-15', camp: 'rivierkamp' },
    { tag: 'BB-H007', weight: 341, date: '2026-01-15', camp: 'rivierkamp' },
    { tag: 'BB-H008', weight: 309, date: '2026-01-15', camp: 'rivierkamp' },
    { tag: 'BB-H009', weight: 322, date: '2026-01-15', camp: 'rivierkamp' },
    { tag: 'BB-H010', weight: 294, date: '2026-01-15', camp: 'rivierkamp' },
    // Weaners
    { tag: 'BB-W001', weight: 198, date: '2026-01-15', camp: 'speenkamp' },
    { tag: 'BB-W002', weight: 187, date: '2026-01-15', camp: 'speenkamp' },
    { tag: 'BB-W003', weight: 181, date: '2026-01-15', camp: 'speenkamp' },
    { tag: 'BB-W004', weight: 175, date: '2026-01-15', camp: 'speenkamp' },
    { tag: 'BB-W005', weight: 191, date: '2026-01-15', camp: 'speenkamp' },
    { tag: 'BB-W006', weight: 168, date: '2026-01-15', camp: 'speenkamp' },
    { tag: 'BB-W007', weight: 179, date: '2026-01-15', camp: 'speenkamp' },
    { tag: 'BB-W008', weight: 193, date: '2026-01-15', camp: 'speenkamp' },
    { tag: 'BB-W009', weight: 183, date: '2026-01-15', camp: 'speenkamp' },
    { tag: 'BB-W010', weight: 177, date: '2026-01-15', camp: 'speenkamp' },
    { tag: 'BB-W011', weight: 172, date: '2026-01-15', camp: 'speenkamp' },
    { tag: 'BB-W012', weight: 165, date: '2026-01-15', camp: 'speenkamp' },
    { tag: 'BB-W013', weight: 160, date: '2026-01-15', camp: 'speenkamp' },
    { tag: 'BB-W014', weight: 155, date: '2026-01-15', camp: 'speenkamp' },
    // Quarantine
    { tag: 'BB-Q001', weight: 348, date: '2026-03-23', camp: 'kwarantyn' },
    { tag: 'BB-Q002', weight: 341, date: '2026-03-23', camp: 'kwarantyn' },
    { tag: 'BB-Q003', weight: 335, date: '2026-03-23', camp: 'kwarantyn' },
    { tag: 'BB-Q004', weight: 319, date: '2026-03-23', camp: 'kwarantyn' },
    { tag: 'BB-Q005', weight: 344, date: '2026-03-23', camp: 'kwarantyn' },
    { tag: 'BB-Q006', weight: 298, date: '2026-03-23', camp: 'kwarantyn' },
    { tag: 'BB-Q007', weight: 362, date: '2026-03-23', camp: 'kwarantyn' },
    { tag: 'BB-Q008', weight: 339, date: '2026-03-23', camp: 'kwarantyn' },
    { tag: 'BB-Q009', weight: 331, date: '2026-03-23', camp: 'kwarantyn' },
    { tag: 'BB-Q010', weight: 324, date: '2026-03-23', camp: 'kwarantyn' },
    { tag: 'BB-Q011', weight: 352, date: '2026-03-23', camp: 'kwarantyn' },
    { tag: 'BB-Q012', weight: 311, date: '2026-03-23', camp: 'kwarantyn' },
  ];

  // Commercial cow weights
  const commWeights = [487,502,478,511,493,469,451,524,462,488,477,461,495,483,455,518,472,466,441,489,503,458,479,447,463,507,481,444,492,468];
  for (let i = 0; i < COMMERCIAL_COWS.length; i++) {
    const cow = COMMERCIAL_COWS[i];
    const isOct = cow.currentCamp === 'bergkamp'; // dry cows weighed in Oct
    weightData.push({
      tag: cow.animalId,
      weight: commWeights[i],
      date: isOct ? '2025-10-20' : '2026-01-15',
      camp: cow.currentCamp,
    });
  }

  for (const w of weightData) {
    obs.push({
      type: 'weighing',
      campId: w.camp,
      animalId: w.tag,
      details: { weight_kg: w.weight },
      observedAt: `${w.date}T08:00:00.000Z`,
      loggedBy: 'kobus.basson@gmail.com',
    });
  }

  return obs;
}

// ── Transaction Data ─────────────────────────────────────────────────────────

interface TxRecord {
  type: 'income' | 'expense';
  category: string;
  amount: number;
  date: string;
  description: string;
  animalId?: string;
  campId?: string;
  saleType?: string;
  counterparty?: string;
  quantity?: number;
  avgMassKg?: number;
  fees?: number;
  transportCost?: number;
  animalIds?: string;
}

const SALES: TxRecord[] = [
  { type: 'income', category: 'Animal Sales', amount: 62000, date: '2025-06-10', description: 'SA Bonsmara National Sale - BB-B005', animalId: 'BB-B005', saleType: 'auction', counterparty: 'SA Bonsmara National Sale', quantity: 1 },
  { type: 'income', category: 'Animal Sales', amount: 28500, date: '2025-08-15', description: 'Cull cow direct sale - BB-X094', animalId: 'BB-X094', saleType: 'private', counterparty: 'Gerhard Steyn', quantity: 1 },
  { type: 'income', category: 'Animal Sales', amount: 88100, date: '2025-11-04', description: 'OVK Middelburg - 5 weaners', saleType: 'auction', counterparty: 'OVK Middelburg', quantity: 5, avgMassKg: 195 },
  { type: 'income', category: 'Animal Sales', amount: 138400, date: '2025-11-25', description: 'OVK Middelburg - 8 weaners', saleType: 'auction', counterparty: 'OVK Middelburg', quantity: 8, avgMassKg: 190 },
  { type: 'income', category: 'Animal Sales', amount: 52800, date: '2025-11-25', description: 'OVK Middelburg - 3 commercial heifers', saleType: 'auction', counterparty: 'OVK Middelburg', quantity: 3 },
];

const EXPENSES: TxRecord[] = [
  { type: 'expense', category: 'Medication/Vet', amount: 3200, date: '2025-03-01', description: 'Covexin 8 (50 dose) x4', counterparty: 'Farmovs Noupoort' },
  { type: 'expense', category: 'Medication/Vet', amount: 2800, date: '2025-03-01', description: 'Dectomax Pour-On 5L', counterparty: 'Farmovs Noupoort' },
  { type: 'expense', category: 'Medication/Vet', amount: 14000, date: '2025-04-10', description: 'Bonsmara semen (20 straws - Lot 4412)', counterparty: 'SA Studbook / Bovine Elite' },
  { type: 'expense', category: 'Medication/Vet', amount: 4500, date: '2025-04-15', description: 'CIDR devices (50 units)', counterparty: 'Farmovs' },
  { type: 'expense', category: 'Medication/Vet', amount: 1800, date: '2025-04-15', description: 'Estrumate 50ml', counterparty: 'Farmovs' },
  { type: 'expense', category: 'Feed/Supplements', amount: 8400, date: '2025-06-15', description: 'Molatek B3 lick (1 ton) - winter supplementation', counterparty: 'Voermol depot Noupoort' },
  { type: 'expense', category: 'Equipment/Repairs', amount: 2200, date: '2025-07-01', description: 'Windmill service (Weiveld 1 + 2)', counterparty: 'Potgieter Windpompe', campId: 'weiveld-1' },
  { type: 'expense', category: 'Medication/Vet', amount: 1850, date: '2025-09-12', description: 'Emergency vet - dystocia BB-C089', counterparty: 'Dr. du Toit', animalId: 'BB-C089' },
  { type: 'expense', category: 'Medication/Vet', amount: 980, date: '2025-10-14', description: 'Dectomax (weaning season drench)', counterparty: 'Farmovs Noupoort' },
  { type: 'expense', category: 'Fuel/Transport', amount: 1200, date: '2025-10-20', description: 'OVK registration fees (Nov auction)', counterparty: 'OVK Middelburg' },
  { type: 'expense', category: 'Fuel/Transport', amount: 4800, date: '2025-11-10', description: 'Transport - weaners to auction (2 loads)', counterparty: 'Swanepoel Vervoer' },
  { type: 'expense', category: 'Equipment/Repairs', amount: 6400, date: '2025-12-01', description: 'Borehole pump repair - burnt motor replaced', counterparty: 'Teebus Boorgat Dienste', campId: 'weiveld-3' },
  { type: 'expense', category: 'Equipment/Repairs', amount: 5200, date: '2025-12-01', description: 'Emergency water tanking (2 weeks)', counterparty: 'Moolman Vervoer', campId: 'weiveld-3' },
  { type: 'expense', category: 'Feed/Supplements', amount: 8800, date: '2026-01-20', description: 'Molatek lick (1 ton) - summer supplementation', counterparty: 'Voermol depot' },
  { type: 'expense', category: 'Medication/Vet', amount: 1200, date: '2026-02-04', description: 'Vet call - pneumonia BB-X019', counterparty: 'Dr. du Toit', animalId: 'BB-X019' },
  { type: 'expense', category: 'Medication/Vet', amount: 2600, date: '2026-02-04', description: 'Draxxin 50ml', counterparty: 'Farmovs Noupoort' },
  { type: 'expense', category: 'Medication/Vet', amount: 12400, date: '2026-03-03', description: 'Annual vaccination round (vaccines + vet help)', counterparty: 'Dr. du Toit + Farmovs' },
  { type: 'expense', category: 'Livestock Purchases', amount: 211200, date: '2026-03-18', description: '12 Bonsmara heifers from Van Aswegen Stoet', counterparty: 'Van Aswegen Stoet Potchefstroom', quantity: 12 },
  { type: 'expense', category: 'Fuel/Transport', amount: 8600, date: '2026-03-18', description: 'Transport - heifers from Potchefstroom', counterparty: 'Venter Vervoer' },
  { type: 'expense', category: 'Medication/Vet', amount: 680, date: '2026-03-18', description: 'Triatix dip (quarantine treatment)', counterparty: 'Farmovs Noupoort' },
];

// ── Database Seeding Functions ───────────────────────────────────────────────

async function seedCamps(client: Client): Promise<void> {
  console.log('\n  Seeding camps...');
  for (const camp of CAMPS) {
    await client.execute({
      sql: `INSERT INTO Camp (id, campId, campName, sizeHectares, waterSource) VALUES (?, ?, ?, ?, ?)`,
      args: [cuid(), camp.campId, camp.campName, camp.sizeHectares, camp.waterSource],
    });
  }
  console.log(`  ${CAMPS.length} camps created.`);
}

async function seedAnimals(client: Client): Promise<void> {
  console.log('\n  Seeding animals...');
  for (const a of ALL_ANIMALS) {
    await client.execute({
      sql: `INSERT INTO Animal (id, animalId, sex, dateOfBirth, breed, category, currentCamp, status, motherId, fatherId, registrationNumber, dateAdded, deceasedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        cuid(), a.animalId, a.sex, a.dateOfBirth, a.breed, a.category,
        a.currentCamp, a.status, a.motherId, a.fatherId,
        a.registrationNumber, TODAY, a.deceasedAt,
      ],
    });
  }
  console.log(`  ${ALL_ANIMALS.length} animals created.`);
}

async function seedObservations(client: Client): Promise<void> {
  console.log('\n  Seeding observations...');

  const allObs = [
    ...buildKIObservations(),
    ...buildCalvingObservations(),
    ...buildTreatmentObservations(),
    ...buildWeighingObservations(),
  ];

  for (const obs of allObs) {
    await client.execute({
      sql: `INSERT INTO Observation (id, type, campId, animalId, details, observedAt, loggedBy)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        cuid(), obs.type, obs.campId, obs.animalId,
        JSON.stringify(obs.details), obs.observedAt, obs.loggedBy,
      ],
    });
  }
  console.log(`  ${allObs.length} observations created.`);
}

async function seedTransactions(client: Client): Promise<void> {
  console.log('\n  Seeding transactions...');

  const allTx = [...SALES, ...EXPENSES];
  for (const tx of allTx) {
    await client.execute({
      sql: `INSERT INTO "Transaction" (id, type, category, amount, date, description, animalId, campId, saleType, counterparty, quantity, avgMassKg, fees, transportCost, animalIds)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        cuid(), tx.type, tx.category, tx.amount, tx.date, tx.description,
        tx.animalId ?? null, tx.campId ?? null, tx.saleType ?? null,
        tx.counterparty ?? null, tx.quantity ?? null, tx.avgMassKg ?? null,
        tx.fees ?? null, tx.transportCost ?? null, tx.animalIds ?? null,
      ],
    });
  }
  console.log(`  ${allTx.length} transactions created.`);
}

async function seedTransactionCategories(client: Client): Promise<void> {
  const categories = [
    { name: 'Animal Sales', type: 'income', isDefault: true },
    { name: 'Livestock Production', type: 'income', isDefault: true },
    { name: 'Subsidies', type: 'income', isDefault: true },
    { name: 'Medication/Vet', type: 'expense', isDefault: true },
    { name: 'Feed/Supplements', type: 'expense', isDefault: true },
    { name: 'Fuel/Transport', type: 'expense', isDefault: true },
    { name: 'Labour', type: 'expense', isDefault: true },
    { name: 'Equipment/Repairs', type: 'expense', isDefault: true },
    { name: 'Camp Maintenance', type: 'expense', isDefault: true },
    { name: 'Livestock Purchases', type: 'expense', isDefault: true },
  ];
  for (const cat of categories) {
    await client.execute({
      sql: `INSERT INTO TransactionCategory (id, name, type, isDefault) VALUES (?, ?, ?, ?)`,
      args: [cuid(), cat.name, cat.type, cat.isDefault ? 1 : 0],
    });
  }
  console.log(`  ${categories.length} transaction categories created.`);
}

async function seedFarmSettings(client: Client): Promise<void> {
  // Delete default row created by schema provisioning
  await client.execute(`DELETE FROM FarmSettings WHERE id = 'singleton'`);

  await client.execute({
    sql: `INSERT INTO FarmSettings (
      id, farmName, breed, alertThresholdHours, updatedAt,
      latitude, longitude, targetStockingRate,
      breedingSeasonStart, breedingSeasonEnd, weaningDate,
      adgPoorDoerThreshold, calvingAlertDays, daysOpenLimit, campGrazingWarningDays
    ) VALUES (
      'singleton', ?, ?, 48, datetime('now'),
      ?, ?, ?,
      ?, ?, ?,
      0.7, 14, 365, 7
    )`,
    args: [
      FARM_NAME, 'Bonsmara', -31.1742, 24.9561, 10,
      '2026-04-01', '2026-06-30', '2026-10-25',
    ],
  });
  console.log('  FarmSettings configured.');
}

// ── Meta DB Operations ───────────────────────────────────────────────────────

async function provisionMetaRecords(farmDbUrl: string, farmDbToken: string): Promise<void> {
  console.log('\n── Meta DB: Users & Farm ─────────────────────────────\n');

  // 1. Create Basson users (Kobus, Danie, Louis)
  const kobusId = randomUUID();
  const danieId = randomUUID();
  const louisId = randomUUID();

  const kobusHash = hashSync('BassonAdmin2026!', 12);
  const danieHash = hashSync('BassonDanie2026!', 12);
  const louisHash = hashSync('Louis2026!', 12);

  await createUser(kobusId, 'kobus.basson@gmail.com', 'kobus.basson', kobusHash, 'Kobus Basson', true);
  console.log('  User: kobus.basson (ADMIN)');

  await createUser(danieId, 'danie.basson@outlook.com', 'danie.basson', danieHash, 'Danie Basson', true);
  console.log('  User: danie.basson (ADMIN)');

  await createUser(louisId, null, 'louis.petrus', louisHash, 'Louis Petrus');
  console.log('  User: louis.petrus (LOGGER, no email)');

  // 2. Create farm record
  const farmId = randomUUID();
  await createFarm(farmId, FARM_SLUG, FARM_NAME, farmDbUrl, farmDbToken, FARM_TIER);
  console.log(`  Farm: ${FARM_SLUG} (${FARM_TIER} tier)`);

  // 3. Link users to farm
  await createFarmUser(kobusId, farmId, 'ADMIN');
  await createFarmUser(danieId, farmId, 'ADMIN');
  await createFarmUser(louisId, farmId, 'LOGGER');
  console.log('  Farm users linked.');

  // 4. Add Luc as ADMIN on this farm
  const metaClient = createClient({
    url: process.env.META_TURSO_URL!,
    authToken: process.env.META_TURSO_AUTH_TOKEN!,
  });
  const lucResult = await metaClient.execute({
    sql: `SELECT id FROM users WHERE username = 'luc' LIMIT 1`,
    args: [],
  });
  if (lucResult.rows.length > 0) {
    const lucId = lucResult.rows[0].id as string;
    await createFarmUser(lucId, farmId, 'ADMIN');
    console.log('  Luc added as ADMIN (platform admin).');
  } else {
    console.warn('  WARNING: luc user not found in meta DB — skipping platform admin link.');
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  BASSON BOERDERY — FarmTrack Onboarding');
  console.log('══════════════════════════════════════════════════════\n');

  // Check if farm already exists
  const existing = await getFarmBySlug(FARM_SLUG);
  if (existing) {
    console.error(`Farm '${FARM_SLUG}' already exists in meta DB. Aborting to prevent duplicate.`);
    console.error('To re-run, first delete the farm from meta DB and Turso.');
    process.exit(1);
  }

  // Step 1: Create Turso database
  console.log('── Step 1: Create Turso Database ─────────────────────\n');
  const dbName = `ft-${FARM_SLUG}`;
  const { url: farmDbUrl, token: farmDbToken } = await createTursoDatabase(dbName);
  console.log(`  Database created: ${dbName}`);
  console.log(`  URL: ${farmDbUrl}`);

  // Step 2: Apply schema
  console.log('\n── Step 2: Apply Schema ──────────────────────────────\n');
  const farmClient = createClient({ url: farmDbUrl, authToken: farmDbToken });
  await farmClient.executeMultiple(FARM_SCHEMA_SQL);
  console.log('  Schema applied.');

  // Step 3: Seed farm data
  console.log('\n── Step 3: Seed Farm Data ────────────────────────────');
  await seedFarmSettings(farmClient);
  await seedCamps(farmClient);
  await seedAnimals(farmClient);
  await seedTransactionCategories(farmClient);
  await seedObservations(farmClient);
  await seedTransactions(farmClient);

  // Step 4: Meta DB records
  await provisionMetaRecords(farmDbUrl, farmDbToken);

  // Summary
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  ONBOARDING COMPLETE');
  console.log('══════════════════════════════════════════════════════\n');
  console.log(`  Farm: ${FARM_NAME} (${FARM_SLUG})`);
  console.log(`  Tier: ${FARM_TIER}`);
  console.log(`  Animals: ${ALL_ANIMALS.length}`);
  console.log(`  Camps: ${CAMPS.length}`);
  console.log(`  Users: Kobus (ADMIN), Danie (ADMIN), Louis (LOGGER), Luc (ADMIN)`);
  console.log(`\n  Logins:`);
  console.log(`    kobus.basson / BassonAdmin2026!`);
  console.log(`    danie.basson / BassonDanie2026!`);
  console.log(`    louis.petrus / Louis2026!`);
  console.log(`    luc / (existing password)`);
  console.log('');

  process.exit(0);
}

main().catch((err) => {
  console.error('\nOnboarding failed:', err);
  process.exit(1);
});
