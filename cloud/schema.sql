CREATE TABLE IF NOT EXISTS shelfchat_books (
 id text PRIMARY KEY, title text NOT NULL CHECK(length(title) BETWEEN 1 AND 150),
 author text NOT NULL CHECK(length(author) BETWEEN 1 AND 100), category text NOT NULL CHECK(category IN ('Fiction','Philosophy','Poetry','Essays','Nonfiction')),
 format text NOT NULL CHECK(format IN ('PDF','EPUB')), size bigint NOT NULL DEFAULT 0 CHECK(size>=0),
 downloads bigint NOT NULL DEFAULT 0 CHECK(downloads>=0), description text NOT NULL DEFAULT '' CHECK(length(description)<=1200),
 created_at timestamptz NOT NULL DEFAULT now(), url text NOT NULL
);
-- statement
CREATE TABLE IF NOT EXISTS shelfchat_notes (
 id text PRIMARY KEY, book_id text NOT NULL REFERENCES shelfchat_books(id) ON DELETE CASCADE,
 handle text NOT NULL CHECK(length(handle) BETWEEN 2 AND 24), tag text NOT NULL CHECK(length(tag) BETWEEN 1 AND 30),
 text text NOT NULL CHECK(length(text) BETWEEN 1 AND 2000), created_at timestamptz NOT NULL DEFAULT now()
);
-- statement
CREATE INDEX IF NOT EXISTS shelfchat_notes_book_time ON shelfchat_notes(book_id,created_at DESC);
-- statement
CREATE INDEX IF NOT EXISTS shelfchat_books_time ON shelfchat_books(created_at DESC);
-- statement
CREATE TABLE IF NOT EXISTS shelfchat_activity (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,message text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
-- statement
CREATE TABLE IF NOT EXISTS shelfchat_presence (id uuid PRIMARY KEY,seen_at timestamptz NOT NULL DEFAULT now());
-- statement
CREATE INDEX IF NOT EXISTS shelfchat_presence_seen ON shelfchat_presence(seen_at);
-- statement
CREATE TABLE IF NOT EXISTS shelfchat_rate_limits (id text PRIMARY KEY,count integer NOT NULL DEFAULT 1,expires_at timestamptz NOT NULL);
-- statement
CREATE INDEX IF NOT EXISTS shelfchat_rate_expiry ON shelfchat_rate_limits(expires_at);
-- statement
CREATE TABLE IF NOT EXISTS shelfchat_uploads (id uuid PRIMARY KEY,pathname text NOT NULL UNIQUE,format text NOT NULL,size bigint NOT NULL CHECK(size BETWEEN 1 AND 26214400),issued boolean NOT NULL DEFAULT false,consumed boolean NOT NULL DEFAULT false,expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes');
-- statement
ALTER TABLE shelfchat_books ENABLE ROW LEVEL SECURITY;
-- statement
ALTER TABLE shelfchat_notes ENABLE ROW LEVEL SECURITY;
-- statement
ALTER TABLE shelfchat_activity ENABLE ROW LEVEL SECURITY;
-- statement
ALTER TABLE shelfchat_presence ENABLE ROW LEVEL SECURITY;
-- statement
ALTER TABLE shelfchat_rate_limits ENABLE ROW LEVEL SECURITY;
-- statement
ALTER TABLE shelfchat_uploads ENABLE ROW LEVEL SECURITY;
-- statement
ALTER TABLE shelfchat_books ADD COLUMN IF NOT EXISTS editions jsonb NOT NULL DEFAULT '{}'::jsonb;
-- statement
ALTER TABLE shelfchat_books ADD COLUMN IF NOT EXISTS source_url text;
-- statement
ALTER TABLE shelfchat_books ADD COLUMN IF NOT EXISTS license_url text;
-- statement
ALTER TABLE shelfchat_books ADD COLUMN IF NOT EXISTS published_year integer;
-- statement
ALTER TABLE shelfchat_books ALTER COLUMN format DROP NOT NULL, ALTER COLUMN url DROP NOT NULL;
-- statement
ALTER TABLE shelfchat_books ADD COLUMN IF NOT EXISTS availability text NOT NULL DEFAULT 'downloadable' CHECK(availability IN ('downloadable','discovery'));
-- statement
ALTER TABLE shelfchat_books ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';
-- statement
ALTER TABLE shelfchat_books ADD COLUMN IF NOT EXISTS search_document tsvector GENERATED ALWAYS AS (to_tsvector('simple',title||' '||author||' '||description)) STORED;
-- statement
CREATE INDEX IF NOT EXISTS shelfchat_books_search ON shelfchat_books USING gin(search_document);
-- statement
CREATE INDEX IF NOT EXISTS shelfchat_books_tags ON shelfchat_books USING gin(tags);
-- statement
CREATE INDEX IF NOT EXISTS shelfchat_books_editions ON shelfchat_books USING gin(editions);
-- statement
CREATE INDEX IF NOT EXISTS shelfchat_books_recent_cursor ON shelfchat_books(created_at DESC,id DESC);
-- statement
CREATE INDEX IF NOT EXISTS shelfchat_books_title_cursor ON shelfchat_books(lower(title),id);
-- statement
CREATE INDEX IF NOT EXISTS shelfchat_books_popular_cursor ON shelfchat_books(downloads DESC,id DESC);
-- statement
CREATE INDEX IF NOT EXISTS shelfchat_books_category_recent ON shelfchat_books(category,created_at DESC,id DESC);
-- statement
CREATE TABLE IF NOT EXISTS shelfchat_catalog_stats (id boolean PRIMARY KEY DEFAULT true CHECK(id),book_count bigint NOT NULL DEFAULT 0);
-- statement
ALTER TABLE shelfchat_catalog_stats ENABLE ROW LEVEL SECURITY;
-- statement
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM shelfchat_catalog_stats WHERE id=true) THEN INSERT INTO shelfchat_catalog_stats(id,book_count) SELECT true,count(*) FROM shelfchat_books; END IF; END $$;
-- statement
CREATE OR REPLACE FUNCTION shelfchat_catalog_count_insert() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN UPDATE shelfchat_catalog_stats SET book_count=book_count+(SELECT count(*) FROM inserted_books) WHERE id=true; RETURN NULL; END $$;
-- statement
CREATE OR REPLACE FUNCTION shelfchat_catalog_count_delete() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN UPDATE shelfchat_catalog_stats SET book_count=book_count-(SELECT count(*) FROM deleted_books) WHERE id=true; RETURN NULL; END $$;
-- statement
DROP TRIGGER IF EXISTS shelfchat_catalog_count_trigger ON shelfchat_books;
-- statement
DROP TRIGGER IF EXISTS shelfchat_catalog_insert_count ON shelfchat_books;
-- statement
DROP TRIGGER IF EXISTS shelfchat_catalog_delete_count ON shelfchat_books;
-- statement
CREATE TRIGGER shelfchat_catalog_insert_count AFTER INSERT ON shelfchat_books REFERENCING NEW TABLE AS inserted_books FOR EACH STATEMENT EXECUTE FUNCTION shelfchat_catalog_count_insert();
-- statement
CREATE TRIGGER shelfchat_catalog_delete_count AFTER DELETE ON shelfchat_books REFERENCING OLD TABLE AS deleted_books FOR EACH STATEMENT EXECUTE FUNCTION shelfchat_catalog_count_delete();
-- statement
CREATE INDEX IF NOT EXISTS shelfchat_activity_time ON shelfchat_activity(created_at DESC);
-- statement
CREATE INDEX IF NOT EXISTS shelfchat_books_available_recent ON shelfchat_books(created_at DESC,id DESC) WHERE availability='downloadable';
