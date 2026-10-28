import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Clock3, Feather, ArrowDown, ArrowUpRight } from "lucide-react";
import { api } from "../api";
import type { Identity } from "../types";
type Margin = {
  id: string;
  handle: string;
  tag: string;
  text: string;
  createdAt: string;
  expiresAt: string;
};
type Feed = { posts: Margin[]; nextCursor: string | null; serverNow: string };
export function fadingLabel(expiresAt: string, now: number) {
  const ms = Date.parse(expiresAt) - now;
  if (ms <= 0) return "Vanished";
  if (ms < 3600000) return "Fading soon";
  if (ms < 86400000) return `Vanishes in ${Math.ceil(ms / 3600000)} hours`;
  return `Vanishes in ${Math.ceil(ms / 86400000)} days`;
}
export default function Community({
  identity,
  chooseIdentity,
}: {
  identity: Identity | null;
  chooseIdentity: () => void;
}) {
  const [posts, setPosts] = useState<Margin[]>([]),
    [draft, setDraft] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [sending, setSending] = useState(false),
    [loadingMore, setLoadingMore] = useState(false),
    [cursor, setCursor] = useState<string | null>(null),
    [now, setNow] = useState(Date.now()),
    [notice, setNotice] = useState(""),
    [postError, setPostError] = useState("");
  const requestId = useRef<string | null>(null);
  const offset = useRef(0),
    loadedMore = useRef(false),
    alive = useRef(true),
    fetching = useRef<AbortController | null>(null),
    controller = useRef<AbortController | null>(null);
  const syncTime = useCallback((serverNow: string) => {
    offset.current = Date.parse(serverNow) - Date.now();
    setNow(Date.now() + offset.current);
  }, []);
  const refresh = useCallback(async () => {
    if (fetching.current && !fetching.current.signal.aborted) return;
    const requestController = controller.current;
    if (!requestController) return;
    fetching.current = requestController;
    try {
      const result = await api<Feed>("/margins", {
        signal: requestController.signal,
      });
      if (!alive.current || requestController.signal.aborted) return;
      syncTime(result.serverNow);
      setPosts((old) =>
        [
          ...new Map(
            [...result.posts, ...old].map((post) => [post.id, post]),
          ).values(),
        ].filter(
          (post) => Date.parse(post.expiresAt) > Date.parse(result.serverNow),
        ),
      );
      if (!loadedMore.current) setCursor(result.nextCursor);
      setError("");
    } catch (e) {
      if (
        alive.current &&
        !requestController.signal.aborted &&
        (e as Error).name !== "AbortError"
      )
        setError((e as Error).message);
    } finally {
      if (fetching.current === requestController) fetching.current = null;
      if (alive.current && !requestController.signal.aborted) setLoading(false);
    }
  }, [syncTime]);
  useEffect(() => {
    alive.current = true;
    controller.current = new AbortController();
    void refresh();
    const timer = setInterval(() => {
      setNow(Date.now() + offset.current);
      if (document.visibilityState === "visible") void refresh();
    }, 15000);
    const visible = () => {
      if (document.visibilityState === "visible") {
        setNow(Date.now() + offset.current);
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      alive.current = false;
      controller.current?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh]);
  useEffect(() => {
    const remaining = posts
      .map((p) => Date.parse(p.expiresAt) - now)
      .filter((ms) => ms > 0);
    if (!remaining.length) return;
    const timer = setTimeout(
      () => setNow(Date.now() + offset.current),
      Math.min(...remaining) + 10,
    );
    return () => clearTimeout(timer);
  }, [posts, now]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!identity) {
      chooseIdentity();
      return;
    }
    if (sending || !draft.trim()) return;
    requestId.current ||= crypto.randomUUID();
    setSending(true);
    setPostError("");
    setNotice("");
    try {
      const result = await api<{ post: Margin; serverNow: string }>(
        "/margins",
        {
          method: "POST",
          timeoutMs: 15000,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId: requestId.current,
            handle: identity.handle,
            tag: identity.tag,
            text: draft.trim(),
          }),
        },
      );
      if (!alive.current) return;
      syncTime(result.serverNow);
      setPosts((old) => [
        result.post,
        ...old.filter((p) => p.id !== result.post.id),
      ]);
      setDraft("");
      requestId.current = null;
      setNotice("Posted.");
    } catch (e) {
      if (alive.current) setPostError((e as Error).message);
    } finally {
      if (alive.current) setSending(false);
    }
  }
  async function more() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await api<Feed>(
        "/margins?cursor=" + encodeURIComponent(cursor),
        { signal: controller.current?.signal },
      );
      if (!alive.current) return;
      loadedMore.current = true;
      syncTime(result.serverNow);
      setPosts((old) => [
        ...new Map(
          [...old, ...result.posts].map((post) => [post.id, post]),
        ).values(),
      ]);
      setCursor(result.nextCursor);
      setError("");
    } catch (e) {
      if (alive.current && (e as Error).name !== "AbortError")
        setError((e as Error).message);
    } finally {
      if (alive.current) setLoadingMore(false);
    }
  }
  const visible = posts.filter((p) => Date.parse(p.expiresAt) > now);
  return (
    <section className="community-page">
      <div className="community-intro">
        <h1>
          Margins<span className="community-dot">.</span>
        </h1>
        <p>A thought between pages.</p>
        <span className="margin-lifetime mono">
          <Clock3 size={13} />
          Posts vanish after 3 days
        </span>
      </div>
      <div className="community-layout">
        <div>
          <form className="margin-composer" onSubmit={submit}>
            <label htmlFor="margin-text">
              <Feather size={16} />
              {identity ? `@${identity.handle}` : "Your thoughts"}
            </label>
            <textarea
              id="margin-text"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                requestId.current = null;
              }}
              disabled={sending}
              maxLength={500}
              required
              rows={4}
              placeholder="What are you reading?"
              aria-describedby="margin-guidance"
            />
            <div className="composer-bottom">
              <span id="margin-guidance" className="mono">
                {draft.length}/500
              </span>
              <button
                type={identity ? "submit" : "button"}
                className="primary"
                disabled={sending || (!!identity && !draft.trim())}
                onClick={identity ? undefined : chooseIdentity}
              >
                {sending ? "Posting…" : identity ? "Post" : "Choose a handle"}
                <ArrowUpRight size={15} />
              </button>
            </div>
          </form>
          {postError && (
            <p className="notice" role="alert">
              {postError}
            </p>
          )}
          {notice && (
            <p className="margin-notice" role="status">
              {notice}
            </p>
          )}
          {error && (
            <p className="notice" role="alert">
              {error}
              <button onClick={() => void refresh()}>Refresh</button>
            </p>
          )}
          <div className="margins-feed-heading">
            <h2>Latest</h2>
          </div>
          <div
            className="margins-feed"
            role="feed"
            aria-label="Community margins"
            aria-busy={loading || loadingMore}
          >
            {loading ? (
              <p className="empty" role="status">
                Loading…
              </p>
            ) : visible.length ? (
              visible.map((post) => (
                <article
                  className="margin-card"
                  key={post.id}
                  aria-label={`Margin by ${post.handle}`}
                >
                  <div className="note-heading">
                    <strong>@{post.handle}</strong>
                    <span className="tag">{post.tag}</span>
                    <time dateTime={post.createdAt}>
                      {new Date(post.createdAt).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                  <p>{post.text}</p>
                  <span
                    className={
                      "margin-ttl mono" +
                      (Date.parse(post.expiresAt) - now < 3600000
                        ? " fading"
                        : "")
                    }
                    title={`Expires ${new Date(post.expiresAt).toLocaleString()}`}
                  >
                    <Clock3 size={12} />
                    {fadingLabel(post.expiresAt, now)}
                  </span>
                </article>
              ))
            ) : (
              <div className="empty">
                <Feather size={23} />
                <h3>No posts yet.</h3>
              </div>
            )}
          </div>
          {cursor && (
            <button
              className="outline margins-more"
              onClick={() => void more()}
              disabled={loadingMore}
            >
              {loadingMore ? "Loading…" : "More"}
              <ArrowDown size={14} />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
