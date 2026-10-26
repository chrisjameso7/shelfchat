import {
  useState,
  useEffect,
  useCallback,
  lazy,
  Suspense,
  type FormEvent,
} from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowDownToLine,
  ArrowUpRight,
  ArrowLeft,
  BookOpen,
} from "lucide-react";
import { api, fileSize } from "../api";
import type { Identity, Book, Note } from "../types";
import { Cover } from "./Cover";
import { editions } from "../books";
const Reader = lazy(() => import("./Reader"));
export default function Detail({
  identity,
  chooseIdentity,
}: {
  identity: Identity | null;
  chooseIdentity: () => void;
}) {
  const { id } = useParams();
  const [book, setBook] = useState<Book | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loadError, setLoadError] = useState("");
  const [reading, setReading] = useState<string | null>(null);
  const closeReader = useCallback(() => setReading(null), []);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setBook(null);
    setLoadError("");
    setReading(null);
    const refresh = () => {
      api<{ book: Book; notes: Note[] }>(
        `/books/${encodeURIComponent(id || "")}`,
        { signal: controller.signal },
      )
        .then((result) => {
          if (active) {
            setBook(result.book);
            setNotes(result.notes);
            setLoadError("");
          }
        })
        .catch((e) => {
          if (active && e.name !== "AbortError") setLoadError(e.message);
        });
    };
    refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 10000);
    window.addEventListener("shelfchat:refresh", refresh);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("shelfchat:refresh", refresh);
    };
  }, [id]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!identity) {
      chooseIdentity();
      return;
    }
    setBusy(true);
    try {
      await api(`/books/${id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...identity, text }),
      });
      setText("");
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!book)
    return (
      <section className="empty">
        <h1>{loadError || "Opening the archive..."}</h1>
        <Link to="/">Back to the library</Link>
      </section>
    );
  return (
    <section className="detail">
      <Link className="back" to="/">
        <ArrowLeft size={15} /> Back to the shelf
      </Link>
      <div className="detail-grid">
        <Cover book={book} index={0} />
        <div>
          <span className="eyebrow">{book.category} / THE OPEN LIBRARY</span>
          <h1>{book.title}</h1>
          <p className="author">by {book.author}</p>
          <p>
            {book.description ||
              "A new addition to our shared shelf. Open a page and see where it takes you."}
          </p>
          <p className="mono">
            {book.downloads.toLocaleString()} downloads
            {book.publishedYear ? ` · Published ${book.publishedYear}` : ""}
          </p>
          <div className="edition-actions">
            {Object.entries(editions(book)).map(([kind, file]) => (
              <a
                key={kind}
                className="primary"
                href={`/api/books/${book.id}/download?format=${kind}`}
              >
                Download {kind} · {fileSize(file.size)}
                <ArrowDownToLine size={17} />
              </a>
            ))}
            {Object.keys(editions(book)).length > 0 && (
              <button
                className="outline"
                onClick={() => setReading(Object.keys(editions(book))[0])}
              >
                <BookOpen size={17} /> Read in Browser
              </button>
            )}
            {Object.keys(editions(book)).length > 1 && (
              <select
                aria-label="Read another format"
                value=""
                onChange={(e) => setReading(e.target.value)}
              >
                <option value="" disabled>
                  Read another format�
                </option>
                {Object.keys(editions(book)).map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            )}
          </div>
          {book.availability === "discovery" && (
            <p className="notice">
              Discovery entry � No authorized download is currently available.
              Explore legitimate editions at the source below.
            </p>
          )}
          {book.tags?.length ? (
            <p className="mono">{book.tags.join(" / ")}</p>
          ) : null}
          {book.sourceUrl && (
            <p className="source-credit">
              <a href={book.sourceUrl} target="_blank" rel="noreferrer">
                View source at Internet Archive ↗
              </a>
              {book.licenseUrl && (
                <>
                  {" "}
                  ·{" "}
                  <a href={book.licenseUrl} target="_blank" rel="noreferrer">
                    Public-domain designation ↗
                  </a>
                </>
              )}
            </p>
          )}
        </div>
      </div>
      {reading && (
        <Suspense fallback={<p role="status">Opening reader�</p>}>
          <Reader book={book} format={reading} onClose={closeReader} />
        </Suspense>
      )}
      <div className="marginalia">
        <span className="eyebrow">CONVERSATIONS BETWEEN THE LINES</span>
        <h2>
          Marginalia
          <span className="count">{notes.length}</span>
        </h2>
        <p>A sentence that stayed with you. A thought that won’t sit still.</p>
        <form onSubmit={submit}>
          <label htmlFor="note">
            {identity
              ? `Writing as @${identity.handle} · ${identity.tag}`
              : "Choose a handle to leave a note"}
          </label>
          <textarea
            id="note"
            value={text}
            onChange={(e) => setText(e.target.value)}
            required
            maxLength={2000}
            rows={4}
            placeholder="Leave something in the margins…"
          />
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Posting…" : identity ? "Leave a note" : "Choose a handle"}
            <ArrowUpRight size={16} />
          </button>
        </form>
        <div className="notes">
          {notes.map((n) => (
            <article key={n.id}>
              <div className="note-heading">
                <strong>@{n.handle}</strong>
                <span className="tag">{n.tag}</span>
                <time>{new Date(n.createdAt).toLocaleString()}</time>
              </div>
              <p>{n.text}</p>
            </article>
          ))}
          {!notes.length && (
            <p className="empty">Untouched margins. Leave the first note.</p>
          )}
        </div>
      </div>
    </section>
  );
}
