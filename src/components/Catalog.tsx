import { VIBES } from "../../shared/vibes.js";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUpRight,
  BookOpen,
  Plus,
  Search,
  MessageSquare,
} from "lucide-react";
import { api, fileSize } from "../api";
import type { Book } from "../types";
import { Cover } from "./Cover";
import { editions, formats } from "../books";
export default function Catalog({ onUpload }: { onUpload: () => void }) {
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        event.key === "/" &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) &&
        !target.isContentEditable &&
        !document.querySelector("dialog[open]")
      ) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All books");
  const [format, setFormat] = useState("All formats");
  const [sort, setSort] = useState("newest");
  const [availability, setAvailability] = useState("downloadable");
  const [page, setPage] = useState(1);
  const [vibe, setVibe] = useState("");
  const [tag, setTag] = useState("");
  const [books, setBooks] = useState<Book[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lookupStatus, setLookupStatus] = useState<string | null>(null);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const update = () => setRefresh((v) => v + 1);
    window.addEventListener("shelfchat:refresh", update);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") update();
    }, 30000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("shelfchat:refresh", update);
    };
  }, []);
  const cursor = cursors[page - 1] || "";
  useEffect(() => {
    const controller = new AbortController();
    let retryTimer: number | undefined;
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: query, sort, cursor });
      if (availability) params.set("availability", availability);
      if (category !== "All books") params.set("category", category);
      if (format !== "All formats") params.set("format", format);
      if (tag) params.set("tag", tag);
      if (vibe) params.set("vibe", vibe);
      api<{
        books: Book[];
        total: number;
        nextCursor: string | null;
        lookup?: { status: string; retryAfterMs: number };
      }>("/catalog?" + params, { signal: controller.signal })
        .then((result) => {
          setBooks(result.books);
          setTotal(result.total);
          setNextCursor(result.nextCursor);
          setLookupStatus(result.lookup?.status || null);
          if (result.lookup?.status === "pending")
            retryTimer = window.setTimeout(
              () => setRefresh((v) => v + 1),
              Math.max(1000, result.lookup.retryAfterMs),
            );
        })
        .catch((e) => {
          if (e.name !== "AbortError") setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      clearTimeout(retryTimer);
      controller.abort();
    };
  }, [query, category, format, sort, tag, vibe, availability, cursor, refresh]);
  const visibleBooks = books;
  function changePage(value: number) {
    if (value > page)
      setCursors((previous) => [...previous.slice(0, page), nextCursor]);
    setPage(value);
    document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth" });
  }
  return (
    <>
      <section className="hero">
        <h1>
          Books worth
          <br />
          <em>getting lost in.</em>
        </h1>
        <div className="hero-bottom">
          <p>Find your book soulmate in the marginalia.</p>
          <a className="hero-link" href="#catalog">
            Find something good <ArrowDown size={17} />
          </a>
        </div>
      </section>
      <section id="catalog" className="catalog">
        <div className="section-heading">
          <div>
            <span className="eyebrow">THE OPEN LIBRARY</span>
            <h2>
              A shelf with no gatekeepers
              <span className="count">{total.toLocaleString()}</span>
            </h2>
          </div>
          <button className="text-button" onClick={onUpload}>
            Add to the shelf <Plus size={16} />
          </button>
        </div>
        <div className="search-row">
          <select
            aria-label="Book availability"
            value={availability}
            onChange={(e) => {
              setAvailability(e.target.value);
              setPage(1);
              setCursors([null]);
            }}
          >
            <option value="downloadable">Read &amp; download</option>
            <option value="">All titles</option>
            <option value="discovery">Discovery only</option>
          </select>
          <div className="search">
            <Search size={18} />
            <input
              ref={searchRef}
              aria-label="Search books or authors"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder="A title, an author, a new obsession…"
            />
            <kbd>/</kbd>
          </div>
          <select
            aria-label="Filter by format"
            value={format}
            onChange={(e) => {
              setFormat(e.target.value);
              setPage(1);
            }}
          >
            <option>All formats</option>
            <option>EPUB</option>
            <option>PDF</option>
          </select>
          <select
            aria-label="Sort books"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              setPage(1);
            }}
          >
            <option value="newest">Recently added</option>
            <option value="popular">Most downloaded</option>
            <option value="title">Title A–Z</option>
          </select>
        </div>
        <div className="vibe-filters" aria-label="Explore by atmosphere">
          <span className="eyebrow">PICK YOUR ATMOSPHERE</span>
          {VIBES.map((item) => (
            <button
              key={item.id}
              aria-pressed={vibe === item.id}
              className={vibe === item.id ? "selected" : ""}
              onClick={() => {
                setVibe(vibe === item.id ? "" : item.id);
                setPage(1);
                setCursors([null]);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="collection-row">
          <label htmlFor="collection" className="mono">
            EXPLORE A SHELF
          </label>
          <select
            id="collection"
            value={tag}
            onChange={(e) => {
              setTag(e.target.value);
              setPage(1);
              setCursors([null]);
            }}
          >
            <option value="">All collections</option>
            <option value="booktok">BookTok picks</option>
            <option value="romantasy">Romantasy</option>
            <option value="dark-academia">Dark academia</option>
            <option value="literary-fiction">Literary fiction</option>
            <option value="queer-fiction">Queer fiction</option>
            <option value="horror">Horror &amp; the uncanny</option>
          </select>
        </div>
        <div className="filters">
          {[
            "All books",
            "Fiction",
            "Philosophy",
            "Poetry",
            "Essays",
            "Nonfiction",
          ].map((c) => (
            <button
              key={c}
              aria-pressed={category === c}
              className={category === c ? "selected" : ""}
              onClick={() => {
                setCategory(c);
                setPage(1);
              }}
            >
              {c}
            </button>
          ))}
          <span className="mono results">
            {books.length} shown - {total.toLocaleString()} in the archive
          </span>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}{" "}
            <button onClick={() => setRefresh((v) => v + 1)}>Retry</button>
          </p>
        )}
        {loading || lookupStatus === "pending" ? (
          <p className="empty" role="status">
            {lookupStatus === "pending"
              ? "Checking open catalogs for a reading edition..."
              : "Opening the archive..."}
          </p>
        ) : !books.length ? (
          <div className="empty">
            <BookOpen />
            <h3>Nothing on this shelf yet.</h3>
            <p>
              {lookupStatus === "error"
                ? "Open catalogs are temporarily unavailable. Please try again shortly."
                : availability === "downloadable"
                  ? "Try another search, or choose All titles to include discovery entries."
                  : "Try another search, or contribute a book."}
            </p>
            <button
              className="outline"
              onClick={() => {
                setQuery("");
                setCategory("All books");
                setFormat("All formats");
                setAvailability("downloadable");
                setTag("");
                setVibe("");
                setCursors([null]);
                setPage(1);
              }}
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="book-grid">
            {visibleBooks.map((b, i) => (
              <article className="book-card" key={b.id}>
                <Link className="cover-link" to={`/book/${b.id}`}>
                  <Cover book={b} index={i} />
                  <span className="cover-label">
                    {formats(b).join(" / ") || "DISCOVERY"}
                  </span>
                </Link>
                <div className="book-info">
                  <span className="eyebrow category">{b.category}</span>
                  <Link to={`/book/${b.id}`}>
                    <h3 title={b.title}>{b.title}</h3>
                  </Link>
                  <p>{b.author}</p>
                  {b.availability === "discovery" && (
                    <p className="mono">
                      Metadata only - explore legitimate editions
                    </p>
                  )}
                  <div className="book-meta">
                    <span>
                      {b.availability === "discovery"
                        ? "DISCOVERY"
                        : format === "All formats"
                          ? formats(b).join(" + ")
                          : format}{" "}
                      <span className="separator">/</span>{" "}
                      {b.availability === "discovery"
                        ? "No file available"
                        : fileSize(
                            format === "All formats"
                              ? b.size
                              : editions(b)[format]?.size || b.size,
                          )}
                    </span>
                    <span>
                      <ArrowDownToLine size={12} />
                      {b.downloads.toLocaleString()}
                    </span>
                  </div>
                  <div className="card-actions">
                    <div className="format-downloads">
                      {b.availability === "discovery" && (
                        <Link className="download" to={`/book/${b.id}`}>
                          Explore editions <ArrowUpRight size={13} />
                        </Link>
                      )}
                      {formats(b).map((kind) => (
                        <a
                          key={kind}
                          href={`/api/books/${b.id}/download?format=${kind}`}
                          className="download"
                          aria-label={`Download ${b.title} as ${kind}`}
                        >
                          {kind}
                          <ArrowDownToLine size={13} />
                        </a>
                      ))}
                    </div>
                    <Link
                      className="notes-link"
                      aria-label={`Read marginalia for ${b.title}`}
                      to={`/book/${b.id}`}
                    >
                      <MessageSquare size={14} />
                      Marginalia
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
        {(page > 1 || nextCursor) && (
          <div className="pagination" aria-label="Catalog pagination">
            <button
              className="outline"
              disabled={page === 1 || loading}
              onClick={() => changePage(page - 1)}
            >
              Previous
            </button>
            <span className="mono" role="status">
              Page {page} - {books.length} titles
            </span>
            <button
              className="outline"
              disabled={!nextCursor || loading}
              onClick={() => changePage(page + 1)}
            >
              Next
            </button>
          </div>
        )}
      </section>
      <section
        className="creator-portal"
        id="contribute"
        aria-labelledby="creator-heading"
      >
        <div>
          <span className="eyebrow">FOR WRITERS</span>
          <h2 id="creator-heading">Share your book.</h2>
          <p>Share a PDF or EPUB with the community.</p>
          <button className="primary" onClick={onUpload}>
            Submit your work <ArrowUpRight size={16} />
          </button>
        </div>
      </section>
    </>
  );
}
