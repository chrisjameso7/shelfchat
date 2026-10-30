import type { Book } from "./types";
const ARCHIVE_EDITIONS: Record<string, string> = {
  "pride-prejudice": "1342", "strange-case": "43", "metamorphosis": "5200",
  "meditations": "2680", "leaves-grass": "1322", "dorian-gray": "174",
  "walden": "205", "beyond-good": "4363",
};

export function coverSources(book: Book): string[] {
  const sources: string[] = [];
  if (book.coverUrl?.startsWith("https://")) sources.push(book.coverUrl);
  try {
    const source = new URL(book.sourceUrl || "https://invalid.invalid");
    const gutenberg = source.hostname.endsWith("gutenberg.org")
      ? source.pathname.match(/\/(?:ebooks|epub)\/(\d+)/)?.[1]
      : undefined;
    const pg = gutenberg || book.id.match(/^pg-(\d+)$/)?.[1] || ARCHIVE_EDITIONS[book.id];
    if (pg) {
      sources.push(`https://www.gutenberg.org/cache/epub/${pg}/pg${pg}.cover.medium.jpg`);
      sources.push(`https://www.gutenberg.org/ebooks/${pg}.cover.medium`);
    }
    const archive = source.hostname === "archive.org"
      ? source.pathname.match(/^\/details\/([^/]+)/)?.[1]
      : undefined;
    const identifier = archive || (book.id.startsWith("ia-") ? book.id.slice(3) : "");
    if (identifier) {
      const safe = encodeURIComponent(decodeURIComponent(identifier));
      sources.push(`https://archive.org/services/img/${safe}`);
      sources.push(`https://archive.org/download/${safe}/__ia_thumb.jpg`);
    }
  } catch { /* Malformed source metadata must not break the catalog. */ }
  return [...new Set(sources)];
}
