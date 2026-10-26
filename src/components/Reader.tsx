import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X, ArrowUpRight } from "lucide-react";
import type { Book } from "../types";
import type { Book as EpubBook, Rendition } from "epubjs";
import { api } from "../api";

export default function Reader({
  book,
  format,
  onClose,
}: {
  book: Book;
  format: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const rendition = useRef<Rendition | null>(null);
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [location, setLocation] = useState("");
  const [font, setFont] = useState(110);
  const [scroll, setScroll] = useState(false);
  const [navigation, setNavigation] = useState<
    { label: string; href: string }[]
  >([]);
  const progressKey = `shelfchat.reading.v1.${book.id}.${format}`;
  useEffect(() => {
    dialog.current?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let epub: EpubBook | undefined;
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 60000);
    async function open() {
      const file = await api<{ url: string; size: number }>(
        `/books/${encodeURIComponent(book.id)}/read?format=${format}`,
        { signal: controller.signal },
      );
      if (!active || controller.signal.aborted) return;
      setSource(file.url);
      if (format === "PDF") {
        setLoading(false);
        clearTimeout(timeout);
        return;
      }
      const MAX = 40 * 1024 * 1024;
      if (file.size > MAX)
        throw Error(
          "This EPUB is too large for the browser reader. Download it to read locally.",
        );
      const response = await fetch(file.url, {
        signal: controller.signal,
        credentials: "omit",
      });
      if (!response.ok || !response.body)
        throw Error("The source could not provide this EPUB.");
      if (Number(response.headers.get("content-length")) > MAX)
        throw Error("This EPUB exceeds the 40 MB browser limit.");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX)
            throw Error("This EPUB exceeds the 40 MB browser limit.");
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      const buffer = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.byteLength;
      }
      if (buffer[0] !== 80 || buffer[1] !== 75)
        throw Error("The source returned a page instead of an EPUB file.");
      const [{ default: ePub }, { default: JSZip }] = await Promise.all([
        import("epubjs"),
        import("jszip"),
      ]);
      const zip = await JSZip.loadAsync(buffer);
      // Inspect ZIP headers before decompression to reject oversized archives.
      const files = Object.values(zip.files);
      const expanded = files.reduce(
        (sum, file) =>
          sum +
          Number(
            (file as unknown as { _data?: { uncompressedSize?: number } })._data
              ?.uncompressedSize || 0,
          ),
        0,
      );
      if (files.length > 10000 || expanded > 150 * 1024 * 1024)
        throw Error(
          "This archive exceeds browser reading limits. Please download it instead.",
        );
      if (!active || controller.signal.aborted) return;
      epub = ePub();
      await epub.open(buffer.buffer, "binary");
      await epub.ready;
      if (!active || controller.signal.aborted) {
        epub.destroy();
        return;
      }
      const view = epub.renderTo(viewport.current!, {
        width: "100%",
        height: "100%",
        spread: "none",
        flow: "paginated",
        allowScriptedContent: false,
      });
      rendition.current = view;
      view.themes.default({
        body: {
          background: "#0a0a0a !important",
          color: "#eee9df !important",
          "font-family": "Georgia,serif !important",
          "line-height": "1.8 !important",
          padding: "16px !important",
        },
        a: { color: "#d7b893 !important" },
        "img,svg": { "max-width": "100% !important" },
      });
      view.themes.fontSize("110%");
      view.hooks.content.register((contents: { document: Document }) => {
        const doc = contents.document;
        doc
          .querySelectorAll("script,form,object,embed,iframe")
          .forEach((node) => node.remove());
        doc.querySelectorAll("*").forEach((node) =>
          Array.from(node.attributes).forEach((attr) => {
            if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
          }),
        );
        doc.addEventListener("keydown", (event) => {
          if (event.key === "ArrowRight") {
            event.preventDefault();
            void view.next();
          }
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            void view.prev();
          }
          if (event.key === "Escape") onClose();
        });
      });
      view.on(
        "relocated",
        (value: {
          start: { cfi: string; displayed: { page: number; total: number } };
        }) => {
          if (!active || controller.signal.aborted) return;
          setLocation(
            `Section page ${value.start.displayed.page} / ${value.start.displayed.total}`,
          );
          try {
            localStorage.setItem(progressKey, value.start.cfi);
          } catch {
            /* Reading works without storage. */
          }
        },
      );
      view.on("displayError", () => {
        if (active)
          setError(
            "This section could not be rendered. Try another section or download the EPUB.",
          );
      });
      const nav = await epub.loaded.navigation;
      if (active)
        setNavigation(
          nav.toc.map((item) => ({
            label: item.label.trim(),
            href: item.href,
          })),
        );
      let saved: string | undefined;
      try {
        saved = localStorage.getItem(progressKey) || undefined;
      } catch {
        /* Optional progress. */
      }
      await view.display(saved).catch(() => view.display());
      if (active) setLoading(false);
      clearTimeout(timeout);
    }
    const aborted = new Promise<never>((_, reject) =>
      controller.signal.addEventListener(
        "abort",
        () => reject(new DOMException("Reading canceled", "AbortError")),
        { once: true },
      ),
    );
    void Promise.race([open(), aborted]).catch((e) => {
      if (active) {
        setLoading(false);
        setError(
          e.name === "AbortError"
            ? "The source took too long to respond. Try downloading the file."
            : "Unable to open this edition. " +
                e.message +
                " The source may block cross-origin reading.",
        );
      }
    });
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
      rendition.current = null;
      epub?.destroy();
    };
  }, [book.id, format, progressKey, onClose]);
  function move(direction: "next" | "prev") {
    void rendition.current?.[direction]().catch(() =>
      setError("Could not navigate this section."),
    );
  }
  return (
    <dialog
      ref={dialog}
      className="reader-dialog"
      aria-labelledby="reader-title"
      onCancel={onClose}
    >
      <header className="reader-header">
        <div>
          <span className="eyebrow">SHELFCHAT / READING ROOM / {format}</span>
          <h2 id="reader-title">{book.title}</h2>
        </div>
        <button className="outline" onClick={onClose} aria-label="Close reader">
          <X size={20} />
        </button>
      </header>
      <div className="reader-tools">
        {format === "EPUB" && (
          <>
            <select
              aria-label="Table of contents"
              defaultValue=""
              onChange={(event) => {
                void rendition.current
                  ?.display(event.target.value)
                  .catch(() => setError("Section unavailable."));
              }}
            >
              <option value="" disabled>
                Contents
              </option>
              {navigation.map((item) => (
                <option key={item.href} value={item.href}>
                  {item.label}
                </option>
              ))}
            </select>
            <button
              className="outline"
              disabled={font <= 80}
              aria-label="Decrease text size"
              onClick={() => {
                const size = font - 10;
                setFont(size);
                rendition.current?.themes.fontSize(size + "%");
              }}
            >
              A−
            </button>
            <button
              className="outline"
              disabled={font >= 180}
              aria-label="Increase text size"
              onClick={() => {
                const size = font + 10;
                setFont(size);
                rendition.current?.themes.fontSize(size + "%");
              }}
            >
              A+
            </button>
            <button
              className="outline"
              aria-pressed={scroll}
              onClick={() => {
                setScroll(!scroll);
                rendition.current?.flow(scroll ? "paginated" : "scrolled-doc");
              }}
            >
              {scroll ? "Page mode" : "Scroll mode"}
            </button>
          </>
        )}
        <a
          className="text-button"
          href={`/api/books/${book.id}/download?format=${format}`}
        >
          Download {format} <ArrowUpRight size={14} />
        </a>
      </div>
      {loading && (
        <p role="status" className="reader-status">
          Opening your edition…
        </p>
      )}
      {error && (
        <p role="alert" className="reader-status error">
          {error}
        </p>
      )}
      {format === "PDF" && source ? (
        <iframe
          className="pdf-reader"
          src={source.split("#")[0] + "#view=FitH"}
          title={`${book.title} PDF reader`}
          referrerPolicy="no-referrer"
          onError={() =>
            setError(
              "The source blocks embedded viewing. Download the PDF instead.",
            )
          }
        />
      ) : (
        <div className="epub-reader" ref={viewport} />
      )}
      <footer className="reader-footer">
        {format === "EPUB" ? (
          <>
            <button
              className="outline"
              disabled={loading}
              onClick={() => move("prev")}
            >
              <ChevronLeft size={18} /> Previous
            </button>
            <span className="mono" aria-live="polite">
              {location || "Your place is saved on this browser"}
            </span>
            <button
              className="outline"
              disabled={loading}
              onClick={() => move("next")}
            >
              Next <ChevronRight size={18} />
            </button>
          </>
        ) : (
          <span className="mono">
            PDF not visible? Use Download PDF above to open it in your device’s
            reader.
          </span>
        )}
      </footer>
    </dialog>
  );
}
