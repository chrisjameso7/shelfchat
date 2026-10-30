import { useState, type FormEvent } from "react";
import { Flag } from "lucide-react";
import { api } from "../api";
import { Modal } from "./Modal";
export function ReportButton({
  kind,
  targetId,
}: {
  kind: "book" | "margin";
  targetId: string;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = Object.fromEntries(new FormData(e.currentTarget));
      await api("/reports", {
        method: "POST",
        body: JSON.stringify({ ...data, kind, targetId }),
      });
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className="report-button"
        aria-label={kind === "book" ? "Report this book" : "Report this post"}
        onClick={() => setOpen(true)}
      >
        <Flag size={13} />
        Report
      </button>
      {open && (
        <Modal
          title={done ? "Report received" : "Report a concern"}
          onClose={() => setOpen(false)}
        >
          {done ? (
            <p>Thank you. Your report is private and available for review.</p>
          ) : (
            <form onSubmit={submit}>
              <label>
                Reason
                <select name="reason" aria-label="Reason">
                  <option value="spam">Spam</option>
                  <option value="abuse">Abuse or harassment</option>
                  <option value="impersonation">Impersonation</option>
                  <option value="copyright">
                    Copyright or distribution rights
                  </option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label>
                Details (optional)
                <textarea name="details" maxLength={500} rows={4} />
              </label>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <button className="primary" disabled={busy}>
                {busy ? "Sending…" : "Send report"}
              </button>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
