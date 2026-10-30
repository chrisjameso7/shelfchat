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
-- statement
ALTER TABLE shelfchat_books ADD COLUMN IF NOT EXISTS cover_url text;
-- statement
ALTER TABLE shelfchat_books ADD COLUMN IF NOT EXISTS rights text CHECK(rights IN ('public-domain','open-license','permission'));
-- statement
ALTER TABLE shelfchat_books ADD COLUMN IF NOT EXISTS rights_statement text NOT NULL DEFAULT '' CHECK(length(rights_statement)<=1000);
-- statement
ALTER TABLE shelfchat_books ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;
-- statement
CREATE TABLE IF NOT EXISTS shelfchat_search_jobs (key text PRIMARY KEY,query text NOT NULL CHECK(length(query) BETWEEN 4 AND 160),status text NOT NULL CHECK(status IN ('pending','done','miss','error')),token uuid NOT NULL,expires_at timestamptz NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
-- statement
CREATE INDEX IF NOT EXISTS shelfchat_search_jobs_expiry ON shelfchat_search_jobs(expires_at);
-- statement
ALTER TABLE shelfchat_search_jobs ENABLE ROW LEVEL SECURITY;
-- statement
CREATE TABLE IF NOT EXISTS shelfchat_source_limits(source text PRIMARY KEY,next_allowed_at timestamptz NOT NULL);
-- statement
ALTER TABLE shelfchat_source_limits ENABLE ROW LEVEL SECURITY;
-- statement
CREATE TABLE IF NOT EXISTS shelfchat_margins (
 id uuid PRIMARY KEY,
 handle text NOT NULL CHECK(length(handle) BETWEEN 2 AND 24 AND handle ~ '^[A-Za-z0-9_-]+$'),
 tag text NOT NULL CHECK(length(tag) BETWEEN 1 AND 30),
 text text NOT NULL CHECK(length(btrim(text)) BETWEEN 1 AND 500),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT (now()+interval '72 hours'),
 CHECK(expires_at=created_at+interval '72 hours')
);
-- statement
CREATE INDEX IF NOT EXISTS shelfchat_margins_recent ON shelfchat_margins(created_at DESC,id DESC);
-- statement
CREATE INDEX IF NOT EXISTS shelfchat_margins_expiry ON shelfchat_margins(expires_at);
-- statement
ALTER TABLE shelfchat_margins ENABLE ROW LEVEL SECURITY;
-- statement
ALTER TABLE shelfchat_notes DROP CONSTRAINT IF EXISTS shelfchat_notes_tag_check;
-- statement
ALTER TABLE shelfchat_notes ADD CONSTRAINT shelfchat_notes_tag_check CHECK(length(tag) BETWEEN 0 AND 30);
-- statement
ALTER TABLE shelfchat_margins DROP CONSTRAINT IF EXISTS shelfchat_margins_tag_check;
-- statement
ALTER TABLE shelfchat_margins ADD CONSTRAINT shelfchat_margins_tag_check CHECK(length(tag) BETWEEN 0 AND 30);
-- statement
ALTER TABLE shelfchat_margins ADD COLUMN IF NOT EXISTS hidden_at timestamptz;
-- statement
ALTER TABLE shelfchat_books ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false;
-- statement
ALTER TABLE shelfchat_catalog_stats ADD COLUMN IF NOT EXISTS visible_count bigint NOT NULL DEFAULT 0;
-- statement
ALTER TABLE shelfchat_catalog_stats ADD COLUMN IF NOT EXISTS readable_count bigint NOT NULL DEFAULT 0;
-- statement
UPDATE shelfchat_catalog_stats SET visible_count=(SELECT count(*) FROM shelfchat_books WHERE NOT is_hidden),readable_count=(SELECT count(*) FROM shelfchat_books WHERE NOT is_hidden AND availability='downloadable') WHERE id=true;
-- statement
CREATE OR REPLACE FUNCTION shelfchat_catalog_count_insert() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN UPDATE shelfchat_catalog_stats SET book_count=book_count+(SELECT count(*) FROM inserted_books),visible_count=visible_count+(SELECT count(*) FROM inserted_books WHERE NOT is_hidden),readable_count=readable_count+(SELECT count(*) FROM inserted_books WHERE NOT is_hidden AND availability='downloadable') WHERE id=true; RETURN NULL; END $$;
-- statement
CREATE OR REPLACE FUNCTION shelfchat_catalog_count_delete() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN UPDATE shelfchat_catalog_stats SET book_count=book_count-(SELECT count(*) FROM deleted_books),visible_count=visible_count-(SELECT count(*) FROM deleted_books WHERE NOT is_hidden),readable_count=readable_count-(SELECT count(*) FROM deleted_books WHERE NOT is_hidden AND availability='downloadable') WHERE id=true; RETURN NULL; END $$;
-- statement
CREATE OR REPLACE FUNCTION shelfchat_catalog_count_update() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN IF EXISTS(SELECT 1 FROM changed_books n JOIN previous_books o USING(id) WHERE n.is_hidden IS DISTINCT FROM o.is_hidden OR n.availability IS DISTINCT FROM o.availability) THEN UPDATE shelfchat_catalog_stats SET visible_count=visible_count+(SELECT count(*) FROM changed_books WHERE NOT is_hidden)-(SELECT count(*) FROM previous_books WHERE NOT is_hidden),readable_count=readable_count+(SELECT count(*) FROM changed_books WHERE NOT is_hidden AND availability='downloadable')-(SELECT count(*) FROM previous_books WHERE NOT is_hidden AND availability='downloadable') WHERE id=true; END IF; RETURN NULL; END $$;
-- statement
DROP TRIGGER IF EXISTS shelfchat_catalog_update_count ON shelfchat_books;
-- statement
CREATE TRIGGER shelfchat_catalog_update_count AFTER UPDATE ON shelfchat_books REFERENCING OLD TABLE AS previous_books NEW TABLE AS changed_books FOR EACH STATEMENT EXECUTE FUNCTION shelfchat_catalog_count_update();
-- statement
CREATE TABLE IF NOT EXISTS shelfchat_reports(id uuid PRIMARY KEY,book_id text REFERENCES shelfchat_books(id) ON DELETE CASCADE,margin_id uuid REFERENCES shelfchat_margins(id) ON DELETE CASCADE,reason text NOT NULL CHECK(reason IN ('spam','abuse','impersonation','copyright','other')),details text NOT NULL DEFAULT '' CHECK(length(details)<=500),reporter_hash text NOT NULL CHECK(length(reporter_hash)=64),created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT(now()+interval '30 days'),resolved_at timestamptz,CHECK(num_nonnulls(book_id,margin_id)=1));
-- statement
CREATE UNIQUE INDEX IF NOT EXISTS shelfchat_reports_book_daily ON shelfchat_reports(book_id,reporter_hash) WHERE book_id IS NOT NULL;
-- statement
CREATE UNIQUE INDEX IF NOT EXISTS shelfchat_reports_margin_daily ON shelfchat_reports(margin_id,reporter_hash) WHERE margin_id IS NOT NULL;
-- statement
CREATE INDEX IF NOT EXISTS shelfchat_reports_recent ON shelfchat_reports(created_at DESC,id DESC) WHERE resolved_at IS NULL;
-- statement
CREATE INDEX IF NOT EXISTS shelfchat_reports_expiry ON shelfchat_reports(expires_at);
-- statement
ALTER TABLE shelfchat_reports ENABLE ROW LEVEL SECURITY;
-- statement
CREATE TABLE IF NOT EXISTS shelfchat_submissions(id uuid PRIMARY KEY,owner_hash text NOT NULL CHECK(length(owner_hash)=64),title text NOT NULL CHECK(length(title) BETWEEN 1 AND 150),author text NOT NULL CHECK(length(author) BETWEEN 1 AND 100),description text NOT NULL DEFAULT '' CHECK(length(description)<=1200),category text NOT NULL CHECK(category IN ('Fiction','Philosophy','Poetry','Essays','Nonfiction')),format text NOT NULL CHECK(format IN ('PDF','EPUB')),url text NOT NULL,rights_statement text NOT NULL CHECK(length(rights_statement) BETWEEN 20 AND 1000),status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','removed')),review_note text NOT NULL DEFAULT '' CHECK(length(review_note)<=1000),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
-- statement
CREATE INDEX IF NOT EXISTS shelfchat_submissions_review ON shelfchat_submissions(created_at DESC,id DESC) WHERE status='pending';
-- statement
ALTER TABLE shelfchat_submissions ENABLE ROW LEVEL SECURITY;
-- statement
CREATE TABLE IF NOT EXISTS shelfchat_moderation_events(id uuid PRIMARY KEY,action text NOT NULL CHECK(length(action)<=40),target_id text NOT NULL CHECK(length(target_id)<=180),created_at timestamptz NOT NULL DEFAULT now());
-- statement
CREATE INDEX IF NOT EXISTS shelfchat_moderation_events_time ON shelfchat_moderation_events(created_at);
-- statement
ALTER TABLE shelfchat_moderation_events ENABLE ROW LEVEL SECURITY;
-- statement
CREATE TABLE IF NOT EXISTS shelfchat_daily_metrics(day date NOT NULL,event text NOT NULL CHECK(event IN ('community_post','submission_received','report_received','download_request')),count bigint NOT NULL DEFAULT 0 CHECK(count>=0),PRIMARY KEY(day,event));
-- statement
ALTER TABLE shelfchat_daily_metrics ENABLE ROW LEVEL SECURITY;
-- statement
CREATE OR REPLACE FUNCTION shelfchat_count_action() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ DECLARE metric text; increment bigint:=1; BEGIN IF current_setting('shelfchat.suppress_metrics',true)='on' THEN RETURN NULL; END IF; IF TG_TABLE_NAME='shelfchat_books' THEN increment:=NEW.downloads-OLD.downloads; IF increment<=0 THEN RETURN NULL; END IF; metric:='download_request'; ELSIF TG_TABLE_NAME='shelfchat_margins' THEN metric:='community_post'; ELSIF TG_TABLE_NAME='shelfchat_submissions' THEN metric:='submission_received'; ELSE metric:='report_received'; END IF; INSERT INTO shelfchat_daily_metrics(day,event,count) VALUES((now() AT TIME ZONE 'UTC')::date,metric,increment) ON CONFLICT(day,event) DO UPDATE SET count=shelfchat_daily_metrics.count+excluded.count; RETURN NULL; END $$;
-- statement
DROP TRIGGER IF EXISTS shelfchat_metric_margins ON shelfchat_margins;
-- statement
CREATE TRIGGER shelfchat_metric_margins AFTER INSERT ON shelfchat_margins FOR EACH ROW EXECUTE FUNCTION shelfchat_count_action();
-- statement
DROP TRIGGER IF EXISTS shelfchat_metric_reports ON shelfchat_reports;
-- statement
CREATE TRIGGER shelfchat_metric_reports AFTER INSERT ON shelfchat_reports FOR EACH ROW EXECUTE FUNCTION shelfchat_count_action();
-- statement
DROP TRIGGER IF EXISTS shelfchat_metric_submissions ON shelfchat_submissions;
-- statement
CREATE TRIGGER shelfchat_metric_submissions AFTER INSERT ON shelfchat_submissions FOR EACH ROW EXECUTE FUNCTION shelfchat_count_action();
-- statement
DROP TRIGGER IF EXISTS shelfchat_metric_downloads ON shelfchat_books;
-- statement
CREATE TRIGGER shelfchat_metric_downloads AFTER UPDATE OF downloads ON shelfchat_books FOR EACH ROW WHEN(NEW.downloads>OLD.downloads) EXECUTE FUNCTION shelfchat_count_action();
