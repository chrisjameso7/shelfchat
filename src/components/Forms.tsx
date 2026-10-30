import { useRef, useState, type FormEvent } from "react";
import { ArrowUpRight } from "lucide-react";
import { Modal } from "./Modal";
import { api } from "../api";
import type { Identity } from "../types";
export function IdentityForm({
  identity,
  onSave,
  onClose,
}: {
  identity: Identity | null;
  onSave: (i: Identity) => void;
  onClose: () => void;
}) {
  const [error, setError] = useState("");
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const value = {
      handle: String(data.get("handle")).trim(),
      tag: String(data.get("tag")).trim(),
    };
    try {
      localStorage.setItem("shelfchat.identity.v1", JSON.stringify(value));
      onSave(value);
    } catch {
      setError(
        "Browser storage is unavailable. Enable local storage to remember your handle.",
      );
    }
  }
  return (
    <Modal
      title={identity ? "Your name in the margins." : "Come as you are."}
      onClose={onClose}
    >
      <p>Saved in this browser. Handles are not verified identities.</p>
      <form onSubmit={submit}>
        <label>
          Your handle
          <input
            name="handle"
            required
            minLength={2}
            maxLength={24}
            pattern="[A-Za-z0-9_-]+"
            title="2–24 letters, numbers, underscores or hyphens"
            defaultValue={identity?.handle}
            placeholder="midnight_reader"
            autoFocus
          />
        </label>
        <label>
          Tag (optional)
          <input
            name="tag"
            maxLength={30}
            defaultValue={identity?.tag}
            placeholder="Pronouns, a reading mood, or leave blank"
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button className="primary" type="submit">
          Enter the reading room <ArrowUpRight size={17} />
        </button>
      </form>
    </Modal>
  );
}
export function UploadForm({ onClose }: { onClose: () => void }) {
  const request = useRef<{ id: string; receipt: string } | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [submitted, setSubmitted] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      request.current ||= {
        id: crypto.randomUUID(),
        receipt: Array.from(
          crypto.getRandomValues(new Uint8Array(32)),
          (byte) => byte.toString(16).padStart(2, "0"),
        ).join(""),
      };
      try {
        const saved = JSON.parse(
          localStorage.getItem("shelfchat.submissions.v1") || "[]",
        );
        if (
          !saved.some((item: { id: string }) => item.id === request.current!.id)
        )
          localStorage.setItem(
            "shelfchat.submissions.v1",
            JSON.stringify(
              [
                ...saved,
                { ...request.current, title: form.get("title") },
              ].slice(-100),
            ),
          );
      } catch {}
      const result = await api<{ id: string; receipt: string; status: string }>(
        "/submissions",
        {
          method: "POST",
          body: JSON.stringify({
            ...Object.fromEntries(form),
            requestId: request.current.id,
            receipt: request.current.receipt,
            rights: form.get("rights") === "on",
          }),
        },
      );
      try {
        const saved = JSON.parse(
          localStorage.getItem("shelfchat.submissions.v1") || "[]",
        );
        localStorage.setItem(
          "shelfchat.submissions.v1",
          JSON.stringify(
            [
              ...saved.filter((item: { id: string }) => item.id !== result.id),
              {
                id: result.id,
                receipt: result.receipt,
                title: form.get("title"),
              },
            ].slice(-100),
          ),
        );
      } catch {
        setError(
          "Save this submission receipt: " + result.id + ":" + result.receipt,
        );
      }
      setSubmitted(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={submitted ? "Submitted for review" : "Submit a book"}
      onClose={onClose}
    >
      {submitted ? (
        <>
          <p>Your book is pending review. It is not public yet.</p>
          <a className="primary" href="/submissions">
            Your submissions <ArrowUpRight size={16} />
          </a>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </>
      ) : (
        <>
          <p>
            Submit an existing authorized file link. Private file uploads are
            not open yet.
          </p>
          <form onSubmit={submit}>
            <div className="form-grid">
              <label>
                Book title
                <input name="title" required maxLength={150} />
              </label>
              <label>
                Author
                <input name="author" required maxLength={100} />
              </label>
            </div>
            <label>
              Category
              <select name="category" aria-label="Category">
                {[
                  "Fiction",
                  "Philosophy",
                  "Poetry",
                  "Essays",
                  "Nonfiction",
                ].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              Description
              <textarea name="description" maxLength={1200} rows={3} />
            </label>
            <label>
              Existing HTTPS file link
              <input
                name="url"
                type="url"
                required
                placeholder="https://…/book.epub"
              />
            </label>
            <label>
              Format
              <select name="format" aria-label="Format">
                <option>EPUB</option>
                <option>PDF</option>
              </select>
            </label>
            <label>
              Distribution permission
              <textarea
                name="rightsStatement"
                minLength={20}
                maxLength={1000}
                rows={3}
                required
                placeholder="Explain who owns this work and why it may be distributed here. Include a source or licensing reference."
              />
            </label>
            <label className="check">
              <input type="checkbox" name="rights" required />I have the right
              to submit this work for free distribution.
            </label>
            <p className="mono">Submissions are reviewed before publication.</p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {busy ? "Submitting…" : "Submit for review"}
              <ArrowUpRight size={16} />
            </button>
          </form>
        </>
      )}
    </Modal>
  );
}
