import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowDownToLine, ArrowUpRight, ArrowLeft } from "lucide-react";
import { api, fileSize } from "../api";
import type { Snapshot, Identity } from "../types";
import { Cover } from "./Cover";
import { editions } from "../books";
export default function Detail({
  data,
  identity,
  chooseIdentity,
}: {
  data: Snapshot;
  identity: Identity | null;
  chooseIdentity: () => void;
}) {
  const { id } = useParams();
  const book = data.books.find((b) => b.id === id);
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
        <h1>
          {data.books.length ? "Book not found." : "Opening the archive…"}
        </h1>
        <Link to="/">Back to the library</Link>
      </section>
    );
  return (
    <section className="detail">
      <Link className="back" to="/">
        <ArrowLeft size={15} /> Back to the shelf
      </Link>
      <div className="detail-grid">
        <Cover book={book} index={data.books.indexOf(book)} />
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
          </div>
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
      <div className="marginalia">
        <span className="eyebrow">CONVERSATIONS BETWEEN THE LINES</span>
        <h2>
          Marginalia
          <span className="count">
            {data.notes.filter((n) => n.bookId === id).length}
          </span>
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
          {data.notes
            .filter((n) => n.bookId === id)
            .map((n) => (
              <article key={n.id}>
                <div className="note-heading">
                  <strong>@{n.handle}</strong>
                  <span className="tag">{n.tag}</span>
                  <time>{new Date(n.createdAt).toLocaleString()}</time>
                </div>
                <p>{n.text}</p>
              </article>
            ))}
          {!data.notes.some((n) => n.bookId === id) && (
            <p className="empty">Untouched margins. Leave the first note.</p>
          )}
        </div>
      </div>
    </section>
  );
}
