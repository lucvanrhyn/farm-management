import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth-options";
import { getFarmCreds } from "@/lib/meta-db";
import { getUserRoleForFarm } from "@/lib/auth";
import UpgradePrompt from "@/components/admin/UpgradePrompt";
import NvdPageClient from "./NvdPageClient";


export default async function NvdPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const { farmSlug } = await params;

  const creds = await getFarmCreds(farmSlug);
  if (creds?.tier === "basic") {
    return <UpgradePrompt feature="NVD Generator" farmSlug={farmSlug} />;
  }

  const isAdmin = getUserRoleForFarm(session, farmSlug) === "ADMIN";

  return (
    <div className="min-w-0 p-4 md:p-8 bg-[#FAFAF8] min-h-screen">
      <div className="mb-6">
        <h1 className="text-xl font-bold" style={{ color: "#1C1815" }}>
          National Vendor Declarations
        </h1>
        <p className="text-xs mt-0.5 font-mono" style={{ color: "#9C8E7A" }}>
          Issue legally-compliant NVDs for livestock sales. All data is frozen at issue time.
        </p>
      </div>
      <NvdPageClient farmSlug={farmSlug} isAdmin={isAdmin} />
    </div>
  );
}
