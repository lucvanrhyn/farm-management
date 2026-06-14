export const dynamic = "force-dynamic";
import { getPrismaForFarm } from "@/lib/farm-prisma";
import { getAllSpeciesConfigs } from "@/lib/species/registry";
import SpeciesSettingsForm, { type SpeciesRow } from "@/components/admin/SpeciesSettingsForm";


export default async function SpeciesSettingsPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;
  const prisma = await getPrismaForFarm(farmSlug);

  if (!prisma) {
    return (
      <div className="flex min-h-screen bg-[var(--ft-bg)] items-center justify-center">
        <p className="text-red-500">Farm not found.</p>
      </div>
    );
  }

  const rows = await prisma.farmSpeciesSettings.findMany();
  const rowBySpecies = Object.fromEntries(rows.map((r) => [r.species, r]));

  const allConfigs = getAllSpeciesConfigs();
  const speciesRows: SpeciesRow[] = allConfigs.map((config) => ({
    id: config.id,
    label: config.label,
    icon: config.icon,
    enabled: rowBySpecies[config.id]?.enabled ?? true,
    required: config.id === "cattle",
  }));

  return (
    <div className="min-w-0 p-4 md:p-8 bg-[var(--ft-bg)] min-h-screen">
      <div className="mb-6">
        <h1 className="text-xl font-bold" style={{ color: "var(--ft-text)" }}>
          Species Settings
        </h1>
        <p className="text-xs mt-0.5 font-mono" style={{ color: "var(--ft-subtle)" }}>
          Enable or disable species modules for this farm
        </p>
      </div>

      <div className="max-w-2xl">
        <SpeciesSettingsForm farmSlug={farmSlug} species={speciesRows} />
      </div>
    </div>
  );
}
