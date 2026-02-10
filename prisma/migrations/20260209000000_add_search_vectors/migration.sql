-- Add full-text search vectors to Book and Author tables

-- Book search vector (generated column based on title)
ALTER TABLE "Book" ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce("title", ''))) STORED;

-- Author search vector (generated column based on name)
ALTER TABLE "Author" ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce("name", ''))) STORED;

-- GIN indexes for fast full-text search
CREATE INDEX "book_search_idx" ON "Book" USING GIN ("search_vector");
CREATE INDEX "author_search_idx" ON "Author" USING GIN ("search_vector");
