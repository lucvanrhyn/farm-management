/**
 * PATCH /api/observations/[id]/attachment — persist an `attachmentUrl`
 * onto an existing observation row.
 *
 * Wave C (#156) — adapter-only wiring under `tenantWrite` (any
 * authenticated tenant role; uploading a photo is part of the standard
 * field-logger flow, not an ADMIN-only operation).
 *
 * Wire shapes:
 *   - 200 → `{ success: true, attachmentUrl: string | null }`
 *   - 404 → `{ error: "OBSERVATION_NOT_FOUND" }`
 *   - 400 → `{ error: "VALIDATION_FAILED" }` (attachmentUrl invalid)
 */
import { NextResponse } from 'next/server';

import { tenantWrite, RouteValidationError } from '@/lib/server/route';
import { revalidateObservationWrite } from '@/lib/server/revalidate';
import { attachObservationPhoto } from '@/lib/domain/observations';

interface AttachmentBody {
  attachmentUrl: string;
}

const attachmentSchema = {
  parse(input: unknown): AttachmentBody {
    const body = (input ?? {}) as Record<string, unknown>;
    if (typeof body.attachmentUrl !== 'string' || !body.attachmentUrl) {
      throw new RouteValidationError(
        'attachmentUrl must be a non-empty string',
        { fieldErrors: { attachmentUrl: 'attachmentUrl must be a non-empty string' } },
      );
    }
    return { attachmentUrl: body.attachmentUrl };
  },
};

export const PATCH = tenantWrite<AttachmentBody, { id: string }>({
  schema: attachmentSchema,
  revalidate: revalidateObservationWrite,
  handle: async (ctx, body, _req, params) => {
    const result = await attachObservationPhoto(ctx.prisma, {
      id: params.id,
      attachmentUrl: body.attachmentUrl,
    });
    return NextResponse.json(result);
  },
});
