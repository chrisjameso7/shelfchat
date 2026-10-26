# ShelfChat

An open shelf for restless minds. Vite + React + TypeScript + Tailwind, with a Node/Express API, SQLite persistence, local file storage and server-sent community updates.

## Run locally

Requires Node 22.13 or later and npm.

```sh
npm ci
npm run dev
```

Open http://localhost:5173. Vite proxies `/api` to port 3001. Identity is stored under `shelfchat.identity.v1` in browser localStorage. It is an editable display identity, not an authenticated or unique account. Anonymous browsing and downloading remain available when the welcome dialog is dismissed.

```sh
npm test
npm run build
npm start
```

Production serves both the SPA and API from port 3001, including direct `/book/:id` navigation. Do not deploy just `dist` to static hosting: the shared API is required.

## Deploy

Use a long-running Node host or Docker with **one instance and a persistent volume** mounted at `/app/data`. SQLite and uploaded files must survive redeploys. Set `PORT` and `DATA_DIR` through the host; `.env.example` documents configuration. Node does not auto-load `.env` here. Configure HTTPS and your `shelfchat.app` DNS with the host. The Docker image runs as an unprivileged user; the mounted volume must be writable by UID 1000.

```sh
docker build -t shelfchat .
docker run -p 3001:3001 -v shelfchat-data:/app/data shelfchat
```

For a reverse proxy, disable buffering on `/api/events` and allow connections longer than 25 seconds. Set `TRUST_PROXY` to the exact number of trusted proxies only if required for rate limiting. Online count measures active browser connections, so multiple tabs count separately. Counters for external files record a download request; the app cannot confirm completion at an external provider.

Back up the SQLite database using SQLite's backup API (or stop the process and copy the entire data directory, including WAL files), together with `data/files`. Multi-instance deployment requires moving the database, files and event fan-out to shared services.

## Features and structure

- `src/App.tsx`: catalog search, category/format filters, sorting, book routing, Marginalia and activity.
- `src/components`: accessible native dialog forms, editable local identity and contributions.
- `server/index.js`: validated API, upload storage, prepared SQL, download responses, rate limiting, security headers and live SSE snapshots.
- `server/seed.js`: eight public-domain starter works linking to Project Gutenberg. External sizes are labeled honestly rather than estimated; download counts begin at zero.
- `server/*.test.js`: input validation and integration coverage for uploads, downloads, counters, notes and live connections.
- `.github/workflows/ci.yml`: clean install, tests and production build.

API: `GET /api/snapshot`, `GET /api/events`, `GET /api/health`, `POST /api/books` (multipart), `POST /api/books/:id/notes` (JSON), `GET /api/books/:id/download`.

Uploads accept PDF/EPUB up to 25 MB with signature validation, or public HTTPS links. Contributors must affirm sharing rights. Rendered text is escaped by React. This anonymous contribution model intentionally has no account ownership or impersonation protection. Before a public launch at scale, establish moderation/takedown operations, malware scanning and quotas appropriate to your host. File signature checks are not malware scanning. Public-domain status varies by jurisdiction; review the seeded works for your audience. Seeded links depend on the external provider's availability.

No cloud resources, production domain, or deployment are provisioned by this repository.
