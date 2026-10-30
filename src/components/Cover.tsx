import { useState } from "react";
import type { Book } from "../types";
import { coverSources } from "../covers";
export function Cover({ book, priority = false }: { book: Book; index?: number; priority?: boolean }) {
  const [failedUrls, setFailedUrls] = useState<string[]>([]);
  const source = coverSources(book).find((url) => !failedUrls.includes(url));
  const palette =
    Array.from(book.id).reduce(
      (hash, letter) => (hash * 31 + letter.charCodeAt(0)) >>> 0,
      0,
    ) % 6;
  if (source)
    return (
      <div className="cover source-cover" aria-hidden="true">
        <span className="cover-loading-title">{book.title}</span>
        <img
          key={source}
          src={source}
          alt=""
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrls((previous) => [...previous, source])}
        />
      </div>
    );
  return (
    <div className={`cover cover-${palette}`} aria-hidden="true">
      <div className="cover-top">
        SHELFCHAT ARCHIVE <span>№ {book.id.slice(0, 4).toUpperCase()}</span>
      </div>
      <div className="cover-title">{book.title}</div>
      <div className="cover-art">
        <span />
        <span />
        <span />
      </div>
      <div className="cover-bottom">
        {book.author}
        <span>↗</span>
      </div>
    </div>
  );
}
