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
import { fileSize } from "../api";
import type { Snapshot } from "../types";
import { Cover } from "./Cover";
export default function Catalog({
  data,
  loading,
  onUpload,
}: {
  data: Snapshot;
  loading: boolean;
  onUpload: () => void;
}) {
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
  const books = data.books
    .filter(
      (b) =>
        (category === "All books" || b.category === category) &&
        (format === "All formats" || b.format === format) &&
        `${b.title} ${b.author}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "popular"
        ? b.downloads - a.downloads
        : sort === "title"
          ? a.title.localeCompare(b.title)
          : b.createdAt.localeCompare(a.createdAt),
    );
  return (
    <>
      <section className="hero">
        <div className="eyebrow">
          <span className="tiny-dot" /> INDEPENDENT MINDS. SHARED SHELVES.
        </div>
        <h1>
          Less scrolling.
          <br />
          More <em>dog-eared pages.</em>
        </h1>
        <div className="hero-bottom">
          <p>
            A little corner of the internet for books worth getting lost in.
            <br />
            Find your next read. Leave a thought in the margins. Stay awhile.
          </p>
          <a className="hero-link" href="#catalog">
            Find something good <ArrowDown size={17} />
          </a>
        </div>
        <div className="hero-stamp">
          <BookOpen size={24} />
          <span>
            OPEN SHELVES
            <br />
            OPEN MINDS
          </span>
        </div>
      </section>
      <section id="catalog" className="catalog">
        <div className="section-heading">
          <div>
            <span className="eyebrow">THE OPEN LIBRARY</span>
            <h2>
              A shelf with no gatekeepers
              <span className="count">{data.books.length}</span>
            </h2>
          </div>
          <button className="text-button" onClick={onUpload}>
            Add to the shelf <Plus size={16} />
          </button>
        </div>
        <div className="search-row">
          <div className="search">
            <Search size={18} />
            <input
              ref={searchRef}
              aria-label="Search books or authors"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="A title, an author, a new obsession…"
            />
            <kbd>/</kbd>
          </div>
          <select
            aria-label="Filter by format"
            value={format}
            onChange={(e) => setFormat(e.target.value)}
          >
            <option>All formats</option>
            <option>EPUB</option>
            <option>PDF</option>
          </select>
          <select
            aria-label="Sort books"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="newest">Recently added</option>
            <option value="popular">Most downloaded</option>
            <option value="title">Title A–Z</option>
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
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
          <span className="mono results">
            {books.length} titles on the shelf
          </span>
        </div>
        {loading ? (
          <p className="empty" role="status">
            Opening the archive…
          </p>
        ) : !books.length ? (
          <div className="empty">
            <BookOpen />
            <h3>Nothing on this shelf yet.</h3>
            <p>Try another search, or contribute a book.</p>
            <button
              className="outline"
              onClick={() => {
                setQuery("");
                setCategory("All books");
                setFormat("All formats");
              }}
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="book-grid">
            {books.map((b, i) => (
              <article className="book-card" key={b.id}>
                <Link className="cover-link" to={`/book/${b.id}`}>
                  <Cover book={b} index={i} />
                  <span className="cover-label">{b.format}</span>
                </Link>
                <div className="book-info">
                  <span className="eyebrow category">{b.category}</span>
                  <Link to={`/book/${b.id}`}>
                    <h3>{b.title}</h3>
                  </Link>
                  <p>{b.author}</p>
                  <div className="book-meta">
                    <span>
                      {b.format} <span className="separator">/</span>{" "}
                      {fileSize(b.size)}
                    </span>
                    <span>
                      <ArrowDownToLine size={12} />
                      {b.downloads.toLocaleString()}
                    </span>
                  </div>
                  <div className="card-actions">
                    <a
                      href={`/api/books/${b.id}/download`}
                      className="download"
                    >
                      Download <ArrowDownToLine size={14} />
                    </a>
                    <Link
                      className="notes-link"
                      aria-label={`Read marginalia for ${b.title}`}
                      to={`/book/${b.id}`}
                    >
                      <MessageSquare size={14} />
                      {data.notes.filter((n) => n.bookId === b.id).length}
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
        <p className="shelf-end">
          YOU’VE REACHED THE END OF THIS SHELF. THE NEXT ONE IS YOURS TO BUILD.{" "}
          <ArrowUpRight size={14} />
        </p>
      </section>
    </>
  );
}
