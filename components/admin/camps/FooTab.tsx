import Link from 'next/link';
import type { FarmFooPayload } from '@/lib/server/foo';
import { FooCampTable } from '@/components/foo/FooCampTable';

export function FooTab({ farmSlug, payload }: { farmSlug: string; payload: FarmFooPayload }) {
  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="text-lg font-semibold">Feed on Offer</h2>
          <p className="text-sm text-gray-600">
            Latest FOO per camp. Record new cover readings in{' '}
            <Link href={`/${farmSlug}/tools/feed-on-offer`} className="underline">
              Tools &rarr; Feed on Offer
            </Link>
            .
          </p>
        </div>
      </div>
      <FooCampTable byCamp={payload.byCamp} />
    </div>
  );
}
