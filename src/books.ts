import type { Book } from "./types";
export function editions(book: Book): Record<string, { size: number }> {
  return book.editions && Object.keys(book.editions).length
    ? book.editions
    : { [book.format]: { size: book.size } };
}
export const formats = (book: Book) => Object.keys(editions(book));
