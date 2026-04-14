import { redirect } from 'next/navigation';

export default async function UpgradeCancelPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;
  redirect(`/${farmSlug}/subscribe/upgrade`);
}
