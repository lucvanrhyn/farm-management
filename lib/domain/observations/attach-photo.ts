/**
 * Wave C (#156) — domain op `attachObservationPhoto`.
 *
 * Persists `attachmentUrl` onto an existing observation row. The
 * adapter handles upstream auth + JSON parsing; this op enforces the
 * row-existence guard and the actual write.
 *
 * Throws `ObservationNotFoundError` when the row does not exist; the
 * adapter envelope maps it onto a 404.
 */
import type { PrismaClient } from "@prisma/client";

import { ObservationNotFoundError } from "./errors";

export interface AttachObservationPhotoInput {
  id: string;
  attachmentUrl: string;
}

export interface AttachObservationPhotoResult {
  success: true;
  attachmentUrl: string | null;
}

export async function attachObservationPhoto(
  prisma: PrismaClient,
  input: AttachObservationPhotoInput,
): Promise<AttachObservationPhotoResult> {
  const existing = await prisma.observation.findUnique({
    where: { id: input.id },
  });
  if (!existing) {
    throw new ObservationNotFoundError(input.id);
  }

  const updated = await prisma.observation.update({
    where: { id: input.id },
    data: { attachmentUrl: input.attachmentUrl },
  });

  return { success: true, attachmentUrl: updated.attachmentUrl };
}
