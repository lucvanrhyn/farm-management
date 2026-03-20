/**
 * Seed the Camp table from the existing hardcoded CAMPS array.
 * Run locally:  npx tsx scripts/seed-camps.ts
 * Run on prod:  TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npx tsx scripts/seed-camps.ts
 */

import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env" });

function makePolygon(col: number, row: number): string {
  const lat = -25.5 + row * 0.025;
  const lng = 28.45 + col * 0.025;
  const half = 0.0075;
  const coords = [
    [lng - half, lat - half],
    [lng + half, lat - half],
    [lng + half, lat + half],
    [lng - half, lat + half],
    [lng - half, lat - half],
  ];
  return JSON.stringify({ type: "Polygon", coordinates: [coords] });
}

const CAMPS = [
  // Row 0
  { campId: "I-1",             campName: "I-1",             sizeHectares: 245, waterSource: "borehole", geojson: makePolygon(0, 0), notes: "Main breeding camp" },
  { campId: "I-3",             campName: "I-3",             sizeHectares: 210, waterSource: "borehole", geojson: makePolygon(1, 0), notes: null },
  { campId: "A",               campName: "A",               sizeHectares: 180, waterSource: "dam",      geojson: makePolygon(2, 0), notes: null },
  { campId: "B",               campName: "B",               sizeHectares: 195, waterSource: "trough",   geojson: makePolygon(3, 0), notes: "Water trough needs monitoring" },
  // Row 1
  { campId: "C",               campName: "C",               sizeHectares: 155, waterSource: "borehole", geojson: makePolygon(0, 1), notes: null },
  { campId: "D",               campName: "D",               sizeHectares: 140, waterSource: "borehole", geojson: makePolygon(1, 1), notes: null },
  { campId: "Teerlings",       campName: "Teerlings",       sizeHectares: 120, waterSource: "dam",      geojson: makePolygon(2, 1), notes: null },
  { campId: "Sirkel",          campName: "Sirkel",          sizeHectares: 130, waterSource: "borehole", geojson: makePolygon(3, 1), notes: null },
  // Row 2
  { campId: "Bulle",           campName: "Bulle",           sizeHectares: 80,  waterSource: "borehole", geojson: makePolygon(0, 2), notes: "Bull camp — check fence regularly" },
  { campId: "H",               campName: "H",               sizeHectares: 170, waterSource: "trough",   geojson: makePolygon(1, 2), notes: "Trough level low — monitor" },
  { campId: "Uithoek",         campName: "Uithoek",         sizeHectares: 160, waterSource: "river",    geojson: makePolygon(2, 2), notes: "Far camp — check every 2 days" },
  { campId: "Wildskamp",       campName: "Wildskamp",       sizeHectares: 115, waterSource: "borehole", geojson: makePolygon(3, 2), notes: null },
  // Row 3
  { campId: "Bloukom",         campName: "Bloukom",         sizeHectares: 190, waterSource: "dam",      geojson: makePolygon(0, 3), notes: null },
  { campId: "Ben se Huis",     campName: "Ben se Huis",     sizeHectares: 100, waterSource: "trough",   geojson: makePolygon(1, 3), notes: "Trough fed by solar pump" },
  { campId: "Everlyn",         campName: "Everlyn",         sizeHectares: 175, waterSource: "borehole", geojson: makePolygon(2, 3), notes: null },
  { campId: "Praalhoek",       campName: "Praalhoek",       sizeHectares: 145, waterSource: "river",    geojson: makePolygon(3, 3), notes: "River pump broken — urgent" },
  // Row 4
  { campId: "Praalhoek Verse", campName: "Praalhoek Verse", sizeHectares: 110, waterSource: "borehole", geojson: makePolygon(0, 4), notes: null },
  { campId: "B4",              campName: "B4",              sizeHectares: 75,  waterSource: "borehole", geojson: makePolygon(1, 4), notes: null },
  { campId: "B1",              campName: "B1",              sizeHectares: 60,  waterSource: "borehole", geojson: makePolygon(2, 4), notes: "Overgrazed — rotate urgently" },
];

function createPrisma(): PrismaClient {
  if (process.env.TURSO_DATABASE_URL) {
    if (!process.env.TURSO_AUTH_TOKEN) throw new Error("TURSO_AUTH_TOKEN not set");
    const libsql = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    return new PrismaClient({ adapter: new PrismaLibSQL(libsql) });
  }
  return new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
}

async function main() {
  const prisma = createPrisma();

  let created = 0;
  let skipped = 0;

  for (const camp of CAMPS) {
    const result = await prisma.camp.upsert({
      where: { campId: camp.campId },
      update: {},           // don't overwrite if already exists
      create: camp,
    });
    if (result.campId === camp.campId) created++;
    else skipped++;
  }

  // Update FarmSettings with farm identity
  await prisma.farmSettings.upsert({
    where: { id: "singleton" },
    update: { farmName: "Trio B Boerdery", breed: "Brangus" },
    create: { id: "singleton", farmName: "Trio B Boerdery", breed: "Brangus", alertThresholdHours: 48 },
  });

  const total = await prisma.camp.count();
  console.log(`✓ Seeded camps: ${CAMPS.length} processed, ${total} total in DB`);
  console.log(`✓ FarmSettings updated: farmName="Trio B Boerdery", breed="Brangus"`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
