import Link from 'next/link';
import type { FarmFeedOnOfferPayload } from '@/lib/server/feed-on-offer';
import { FeedOnOfferCampTable } from '@/components/feed-on-offer/FeedOnOfferCampTable';

export function FeedOnOfferTab({ farmSlug, payload }: { farmSlug: string; payload: FarmFeedOnOfferPayload }) {
  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="text-lg font-semibold">Feed on Offer</h2>
          <p className="text-sm text-gray-600">
            Latest Feed on Offer per camp. Record new cover readings in{' '}
            <Link href={`/${farmSlug}/tools/feed-on-offer`} className="underline">
              Tools &rarr; Feed on Offer
            </Link>
            .
          </p>
        </div>
      </div>
      <FeedOnOfferCampTable byCamp={payload.byCamp} />
    </div>
  );
}
