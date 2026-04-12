// Server component — loads rotation data and composes the Rotation tab.

import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getRotationStatusByCamp } from "@/lib/server/rotation-engine";
import type { Camp } from "@/lib/types";
import RotationKpiCards from "./RotationKpiCards";
import CurrentlyGrazingTable from "./CurrentlyGrazingTable";
import NextToGrazeQueue from "./NextToGrazeQueue";
import RestingCampsTable from "./RestingCampsTable";
import RotationLegend from "./RotationLegend";

interface Props {
  farmSlug: string;
  camps: Camp[];
}

export default async function RotationSection({ farmSlug, camps }: Props) {
  const prisma = await getPrismaForFarm(farmSlug);
  if (!prisma) return null;

  const payload = await getRotationStatusByCamp(prisma);

  if (payload.camps.length === 0) {
    return (
      <div
        className="rounded-2xl border p-8 text-center"
        style={{ background: "#FFFFFF", borderColor: "#E0D5C8" }}
      >
        <p className="text-sm font-medium" style={{ color: "#9C8E7A" }}>
          No camps found. Add camps to start tracking rotation.
        </p>
      </div>
    );
  }

  // Build ordered queue: nextToGraze is already ranked, join to full camp records.
  const campById = new Map(payload.camps.map((c) => [c.campId, c]));
  const queuedCamps = payload.nextToGraze
    .map((entry) => campById.get(entry.campId))
    .filter((c): c is NonNullable<typeof c> => c !== undefined);

  return (
    <div>
      <RotationKpiCards counts={payload.counts} />
      <CurrentlyGrazingTable camps={[...payload.camps]} />
      <NextToGrazeQueue queuedCamps={queuedCamps} allCamps={camps} />
      <RestingCampsTable camps={[...payload.camps]} />
      <RotationLegend />
    </div>
  );
}
