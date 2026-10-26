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
  editions?: Record<string, { size: number }>;
  sourceUrl?: string;
  licenseUrl?: string;
  publishedYear?: number;
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
export type SnapshotDelta = Omit<Snapshot, "books"> & {
  books?: Book[];
  catalogVersion?: string;
  downloads?: Record<string, number>;
};
