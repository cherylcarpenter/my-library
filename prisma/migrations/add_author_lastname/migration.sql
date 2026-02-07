-- Add lastName column to Author table
ALTER TABLE "Author" ADD COLUMN "lastName" TEXT;

-- Create index for sorting
CREATE INDEX IF NOT EXISTS "Author_lastName_idx" ON "Author"("lastName");
