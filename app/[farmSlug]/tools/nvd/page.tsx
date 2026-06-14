export const dynamic = "force-dynamic";
import { requireSession } from "@/lib/auth";
import { getFarmCreds } from "@/lib/meta-db";
import { getUserRoleForFarm } from "@/lib/auth";
import { PageHeader } from "@/components/ds";
import UpgradePrompt from "@/components/admin/UpgradePrompt";
import NvdPageClient from "./NvdPageClient";


export default async function NvdPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;

  const session = await requireSession(`/${farmSlug}/tools/nvd`);

  const creds = await getFarmCreds(farmSlug);
  if (creds?.tier === "basic") {
    return <UpgradePrompt feature="NVD Generator" farmSlug={farmSlug} />;
  }

  const isAdmin = getUserRoleForFarm(session, farmSlug) === "ADMIN";

  return (
    <div className="min-w-0 p-4 md:p-8 bg-[var(--ft-bg)] min-h-screen">
      <PageHeader
        className="px-0 py-0 mb-6"
        title="National Vendor Declarations"
        subtitle="NVD generator"
      />
      <NvdPageClient farmSlug={farmSlug} isAdmin={isAdmin} />
    </div>
  );
}
