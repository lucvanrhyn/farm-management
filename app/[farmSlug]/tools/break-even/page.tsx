import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth-options";
import { getFarmCreds } from "@/lib/meta-db";
import UpgradePrompt from "@/components/admin/UpgradePrompt";
import BreakEvenCalculator from "@/components/tools/BreakEvenCalculator";

export const dynamic = "force-dynamic";

export default async function BreakEvenPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const { farmSlug } = await params;

  const creds = await getFarmCreds(farmSlug);
  if (creds?.tier === "basic") {
    return <UpgradePrompt feature="Break-even Calculator" farmSlug={farmSlug} />;
  }

  return (
    <div className="min-w-0 p-4 md:p-8 bg-[#FAFAF8]">
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "#1C1815" }}>
          Break-even Calculator
        </h1>
        <p className="text-sm mt-1" style={{ color: "#9C8E7A" }}>
          Calculate the sell price needed to cover feeding costs and hit your target margin.
        </p>
      </div>
      <BreakEvenCalculator />
    </div>
  );
}
