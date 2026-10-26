import type { Book } from "../types";
export function Cover({ book, index = 0 }: { book: Book; index?: number }) {
  return (
    <div className={`cover cover-${index % 6}`} aria-hidden="true">
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
