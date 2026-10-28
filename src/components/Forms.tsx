import { useState, type FormEvent } from "react";
import { Upload, ArrowUpRight } from "lucide-react";
import { Modal } from "./Modal";
import { api, capabilities } from "../api";
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
      <p>
        No account. No password. Just a name to leave in the margins. Your
        handle belongs to this browser and is not a verified identity.
      </p>
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
          Gender / identity tag
          <input
            name="tag"
            required
            maxLength={30}
            defaultValue={identity?.tag}
            placeholder="she/her, he/him, they/them, or your own"
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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      const config = await capabilities();
      if (config.uploads === "blob") {
        const data: Record<string, unknown> = Object.fromEntries(
          form.entries(),
        );
        data.rights = form.get("rights") === "on";
        const file = form.get("file");
        delete data.file;
        if (file instanceof File && file.size) {
          const intent = await api<{ id: string; pathname: string }>(
            "/uploads/prepare",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                filename: file.name,
                size: file.size,
                rights: data.rights,
              }),
            },
          );
          const { upload } = await import("@vercel/blob/client");
          const blob = await upload(intent.pathname, file, {
            access: "public",
            handleUploadUrl: "/api/uploads/token",
            clientPayload: JSON.stringify({ id: intent.id }),
            contentType:
              file.type ||
              (file.name.toLowerCase().endsWith(".pdf")
                ? "application/pdf"
                : "application/epub+zip"),
          });
          data.uploadId = intent.id;
          data.blobUrl = blob.url;
        }
        await api("/books", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
      } else {
        await api("/books", { method: "POST", body: form });
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Make room for another story." onClose={onClose}>
      <p>
        Contribute public-domain books or works you have permission to share.
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
          <select name="category">
            {["Fiction", "Philosophy", "Poetry", "Essays", "Nonfiction"].map(
              (x) => (
                <option key={x}>{x}</option>
              ),
            )}
          </select>
        </label>
        <label>
          A few words about it
          <textarea name="description" maxLength={1200} rows={3} />
        </label>
        <label className="file-field">
          <Upload size={22} /> Upload PDF or EPUB · up to 25 MB
          <input name="file" type="file" accept=".pdf,.epub" />
        </label>
        <label>
          Or a Gutenberg / Internet Archive HTTPS file link
          <input name="url" type="url" placeholder="https://…/book.epub" />
        </label>
        <label>
          Link format
          <select name="format">
            <option>EPUB</option>
            <option>PDF</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" name="rights" required /> I have the right to
          share this book.
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? "Adding to the shelf…" : "Contribute to the library"}
          <ArrowUpRight size={17} />
        </button>
      </form>
    </Modal>
  );
}
