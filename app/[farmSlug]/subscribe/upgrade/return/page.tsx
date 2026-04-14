import { redirect } from 'next/navigation';

export default async function UpgradeReturnPage({
  params,
}: {
  params: Promise<{ farmSlug: string }>;
}) {
  const { farmSlug } = await params;
  // PayFast redirects here after a successful subscription.
  // The ITN webhook handles actual activation — this is just a landing page.
  redirect(`/${farmSlug}/admin`);
}
