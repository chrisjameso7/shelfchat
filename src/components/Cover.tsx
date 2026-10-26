import type { Book } from "../types";
export function Cover({ book }: { book: Book; index?: number }) {
  const palette =
    Array.from(book.id).reduce(
      (hash, letter) => (hash * 31 + letter.charCodeAt(0)) >>> 0,
      0,
    ) % 6;
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
