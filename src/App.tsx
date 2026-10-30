import Policy from "./components/Policy";
import Submissions from "./components/Submissions";
import Community from "./components/Community";
import Catalog from "./components/Catalog";
import Detail from "./components/Detail";
import { useEffect, useState } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import {
  ArrowDownToLine,
  BookOpen,
  Plus,
  Radio,
  UserRound,
} from "lucide-react";
import { api, capabilities, readIdentity } from "./api";
import { IdentityForm, UploadForm } from "./components/Forms";
import type { Identity, Snapshot, SnapshotDelta } from "./types";
const initial: Snapshot = { books: [], notes: [], activity: [], online: 0 };
export default function App() {
  const { pathname } = useLocation();
  const [data, setData] = useState(initial);
  const [identity, setIdentity] = useState<Identity | null>(readIdentity);
  const [modal, setModal] = useState<"identity" | "upload" | null>(null);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let active = true;
    let stop = () => {};
    let visitor: string;
    try {
      visitor =
        sessionStorage.getItem("shelfchat.visitor") || crypto.randomUUID();
      sessionStorage.setItem("shelfchat.visitor", visitor);
    } catch {
      visitor = crypto.randomUUID();
    }
    let refreshing = false;
    let catalogVersion = "";
    async function refresh() {
      if (refreshing || !active) return;
      refreshing = true;
      try {
        const result = await api<SnapshotDelta>(
          `/snapshot?visitor=${visitor}&catalogVersion=${encodeURIComponent(catalogVersion)}`,
        );
        if (active) {
          catalogVersion = result.catalogVersion || "";
          setData((previous) => ({
            ...previous,
            ...result,
            books: (result.books || previous.books).map((book) => ({
              ...book,
              downloads: result.downloads?.[book.id] ?? book.downloads,
            })),
          }));
          setError("");
          setConnected(true);
        }
      } catch (e) {
        if (active) {
          setError((e as Error).message);
          setConnected(false);
        }
      } finally {
        refreshing = false;
      }
    }
    window.addEventListener("shelfchat:refresh", refresh);
    capabilities()
      .then((config) => {
        if (!active) return;
        void refresh();
        if (config.transport === "poll") {
          const timer = window.setInterval(() => {
            if (document.visibilityState === "visible") void refresh();
          }, 60000);
          stop = () => clearInterval(timer);
        } else {
          const events = new EventSource("/api/events");
          events.onmessage = (e) => {
            if (!active) return;
            try {
              setData(JSON.parse(e.data));
              setError("");
              setConnected(true);
            } catch {
              setError("Could not read the live feed.");
            }
          };
          events.onerror = () => {
            if (active) setConnected(false);
          };
          stop = () => events.close();
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      stop();
      window.removeEventListener("shelfchat:refresh", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return (
    <>
      <header>
        <Link className="brand" to="/" aria-label="ShelfChat home">
          <BookOpen size={25} strokeWidth={1.6} />
          shelfchat<span className="brand-dot">.</span>
        </Link>
        <nav>
          <NavLink to="/" end>
            The library
          </NavLink>
          <NavLink to="/community">
            Community &amp; Margins <span className="tiny-dot" />
          </NavLink>
        </nav>
        <div className="header-actions">
          <button
            className="text-button identity"
            onClick={() => setModal("identity")}
          >
            <UserRound size={16} />
            {identity ? identity.handle : "Choose a handle"}
          </button>
          <button className="outline" onClick={() => setModal("upload")}>
            <Plus size={16} /> Contribute a book
          </button>
        </div>
      </header>
      <main>
        {error && (
          <div className="notice" role="alert">
            {error} <button onClick={() => location.reload()}>Retry</button>
          </div>
        )}
        <Routes>
          <Route path="/policies/:page" element={<Policy />} />
          <Route
            path="/submissions"
            element={<Submissions onSubmit={() => setModal("upload")} />}
          />
          <Route
            path="/community"
            element={
              <Community
                identity={identity}
                chooseIdentity={() => setModal("identity")}
              />
            }
          />
          <Route
            path="/"
            element={<Catalog onUpload={() => setModal("upload")} />}
          />
          <Route
            path="/book/:id"
            element={
              <Detail
                identity={identity}
                chooseIdentity={() => setModal("identity")}
              />
            }
          />
          <Route
            path="*"
            element={
              <section className="empty">
                <h1>This page slipped off the shelf.</h1>
                <Link to="/">Return to the library</Link>
              </section>
            }
          />
        </Routes>
        {pathname === "/" && (
          <section className="heartbeat" id="heartbeat">
            <div>
              <span className="eyebrow">
                <Radio size={14} /> THE READING ROOM
              </span>
              <h2>
                Quiet pages. <em>Good company.</em>
              </h2>

              <span className="live">
                <span className={connected ? "tiny-dot" : "offline-dot"} />
                {connected
                  ? `~${data.online} readers active`
                  : "Reconnecting to the reading room…"}
              </span>
            </div>
            <div className="activity">
              {data.activity.length ? (
                data.activity.slice(0, 4).map((a) => (
                  <div key={a.id}>
                    <ArrowDownToLine size={14} />
                    <span>{a.message}</span>
                    <time>
                      {new Date(a.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                ))
              ) : (
                <p>No recent activity.</p>
              )}
            </div>
          </section>
        )}
      </main>
      <footer>
        <Link className="brand" to="/">
          shelfchat.
        </Link>
        <div className="footer-links">
          <Link to="/submissions">Contributions</Link>
          <Link to="/policies/guidelines">Guidelines</Link>
          <Link to="/policies/privacy">Privacy</Link>
          <Link to="/policies/terms">Terms</Link>
          <Link to="/policies/copyright">Copyright</Link>
        </div>
      </footer>
      {modal === "identity" && (
        <IdentityForm
          identity={identity}
          onClose={() => setModal(null)}
          onSave={(i) => {
            setIdentity(i);
            setModal(null);
          }}
        />
      )}
      {modal === "upload" && <UploadForm onClose={() => setModal(null)} />}
    </>
  );
}
