export type Identity = { handle: string; tag: string };
export type Book = {
  id: string;
  title: string;
  author: string;
  category: string;
  format: string;
  size: number;
  downloads: number;
  description: string;
  createdAt: string;
};
export type Note = {
  id: string;
  bookId: string;
  handle: string;
  tag: string;
  text: string;
  createdAt: string;
};
export type Activity = { id: string; message: string; createdAt: string };
export type Snapshot = {
  books: Book[];
  notes: Note[];
  activity: Activity[];
  online: number;
};
