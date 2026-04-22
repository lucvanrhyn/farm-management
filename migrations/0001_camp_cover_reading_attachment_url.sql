-- Adds a nullable URL column for photos attached to cover readings.
-- Paired with prisma/schema.prisma CampCoverReading.attachmentUrl and the new
-- PATCH /api/[farmSlug]/camps/[campId]/cover/[readingId]/attachment route.
ALTER TABLE "CampCoverReading" ADD COLUMN "attachmentUrl" TEXT;
