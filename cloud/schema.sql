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
