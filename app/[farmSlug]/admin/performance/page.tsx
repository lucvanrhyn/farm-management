import { redirect } from "next/navigation";

export default async function PerformancePage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;
  redirect(`/${farmSlug}/admin/camps?tab=performance`);
}
