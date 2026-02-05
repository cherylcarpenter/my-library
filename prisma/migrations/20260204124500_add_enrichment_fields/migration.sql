-- Add enrichment fields to Book table
ALTER TABLE "Book" ADD COLUMN "openLibraryId" TEXT;
ALTER TABLE "Book" ADD COLUMN "enrichedAt" TIMESTAMP(3);
ALTER TABLE "Book" ADD COLUMN "enrichmentStatus" TEXT DEFAULT 'PENDING';

-- Add enrichment fields to Author table
ALTER TABLE "Author" ADD COLUMN "openLibraryId" TEXT;
ALTER TABLE "Author" ADD COLUMN "enrichedAt" TIMESTAMP(3);

-- Add index on enrichmentStatus for faster queries
CREATE INDEX IF NOT EXISTS "Book_enrichmentStatus_idx" ON "Book"("enrichmentStatus");
