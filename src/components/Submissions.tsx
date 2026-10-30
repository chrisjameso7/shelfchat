import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
type Saved = { id: string; receipt: string; title: string };
type Submission = {
  id: string;
  title: string;
  author: string;
  status: string;
  review_note: string;
  created_at: string;
};
export default function Submissions({ onSubmit }: { onSubmit: () => void }) {
  const [rows, setRows] = useState<Submission[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const saved: Saved[] = JSON.parse(
          localStorage.getItem("shelfchat.submissions.v1") || "[]",
        );
        const results = await Promise.allSettled(
          saved
            .slice(-100)
            .map((item) =>
              api<{ submission: Submission }>("/submissions/" + item.id, {
                headers: { Authorization: "Bearer " + item.receipt },
                signal: controller.signal,
              }),
            ),
        );
        if (controller.signal.aborted) return;
        setRows(
          results.flatMap((result) =>
            result.status === "fulfilled" ? [result.value.submission] : [],
          ),
        );
        if (results.some((r) => r.status === "rejected"))
          setError("Some submissions could not be loaded.");
      } catch {
        setError("This browser cannot access saved submission receipts.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, []);
  return (
    <section className="workspace-page">
      <span className="eyebrow">CONTRIBUTIONS</span>
      <h1>Your submissions</h1>
      <p>
        Private receipts are saved in this browser. Clearing them removes access
        to these status pages.
      </p>
      <button className="primary" onClick={onSubmit}>
        Submit a book
      </button>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">Loading…</p>
      ) : rows.length ? (
        <div className="submission-list">
          {rows.map((row) => (
            <article key={row.id}>
              <div>
                <h2>{row.title}</h2>
                <p>{row.author}</p>
              </div>
              <span className="status-tag">{row.status}</span>
              {row.review_note && <p>{row.review_note}</p>}
            </article>
          ))}
        </div>
      ) : (
        <p className="empty">No submissions saved in this browser.</p>
      )}
      <Link className="back" to="/">
        Back to the library
      </Link>
    </section>
  );
}
