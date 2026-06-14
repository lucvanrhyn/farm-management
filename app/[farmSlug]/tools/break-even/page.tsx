export const dynamic = "force-dynamic";
import { requireSession } from "@/lib/auth";
import { getFarmCreds } from "@/lib/meta-db";
import { PageHeader } from "@/components/ds";
import UpgradePrompt from "@/components/admin/UpgradePrompt";
import BreakEvenCalculator from "@/components/tools/BreakEvenCalculator";


export default async function BreakEvenPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;

  await requireSession(`/${farmSlug}/tools/break-even`);

  const creds = await getFarmCreds(farmSlug);
  if (creds?.tier === "basic") {
    return <UpgradePrompt feature="Break-even Calculator" farmSlug={farmSlug} />;
  }

  return (
    <div className="min-w-0 p-4 md:p-8 bg-[var(--ft-bg)]">
      <PageHeader
        className="px-0 py-0 mb-6"
        title="Break-even Calculator"
        subtitle="Calculate the sell price needed to cover feeding costs and hit your target margin."
      />
      <BreakEvenCalculator />
    </div>
  );
}
