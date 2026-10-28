import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Clock3, Feather, ArrowDown, ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
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
    [notice, setNotice] = useState("");
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
    setSending(true);
    setError("");
    setNotice("");
    try {
      const result = await api<{ post: Margin; serverNow: string }>(
        "/margins",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
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
      setNotice("Your margin is here. It vanishes in 72 hours.");
    } catch (e) {
      if (alive.current) setError((e as Error).message);
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
        <span className="eyebrow">
          <span className="tiny-dot" /> COMMUNITY / MARGINS
        </span>
        <span className="margin-lifetime mono">
          <Clock3 size={13} />
          72 HOURS. THEN GONE.
        </span>
        <h1>
          Some thoughts belong
          <br />
          <em>in the margins.</em>
        </h1>
        <p>
          Late-night musings. A book you can’t shake. A small thought for
          whoever is here.
        </p>
        <Link className="text-button" to="/">
          Back to the library <ArrowUpRight size={14} />
        </Link>
      </div>
      <div className="community-layout">
        <div>
          <form className="margin-composer" onSubmit={submit}>
            <label htmlFor="margin-text">
              <Feather size={16} />
              {identity
                ? `Writing as @${identity.handle}`
                : "Leave a little thought"}
            </label>
            <textarea
              id="margin-text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={500}
              required
              rows={4}
              placeholder="What’s living rent-free in your reading mind?"
              aria-describedby="margin-guidance"
            />
            <div className="composer-bottom">
              <span id="margin-guidance" className="mono">
                WORDS ONLY · {draft.length}/500
              </span>
              <button
                type={identity ? "submit" : "button"}
                className="primary"
                disabled={sending || (!!identity && !draft.trim())}
                onClick={identity ? undefined : chooseIdentity}
              >
                {sending
                  ? "Leaving your margin…"
                  : identity
                    ? "Leave a margin"
                    : "Choose a handle"}
                <ArrowUpRight size={15} />
              </button>
            </div>
          </form>
          {notice && (
            <p className="margin-notice" role="status">
              {notice}
            </p>
          )}
          {error && (
            <p className="notice" role="alert">
              {error}
              <button onClick={() => void refresh()}>Retry feed</button>
            </p>
          )}
          <div className="margins-feed-heading">
            <h2>In the room right now</h2>
            <span className="mono">RECENT FIRST / FADING ALWAYS</span>
          </div>
          <div
            className="margins-feed"
            role="feed"
            aria-label="Community margins"
            aria-busy={loading || loadingMore}
          >
            {loading ? (
              <p className="empty" role="status">
                Opening the darkroom…
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
                <h3>The margins are quiet.</h3>
                <p>Leave the first thought. No permanent record required.</p>
              </div>
            )}
          </div>
          {cursor && (
            <button
              className="outline margins-more"
              onClick={() => void more()}
              disabled={loadingMore}
            >
              {loadingMore ? "Opening older margins…" : "Earlier in the room"}
              <ArrowDown size={14} />
            </button>
          )}
        </div>
        <aside className="community-aside">
          <span className="eyebrow">A SMALL, TEMPORARY ROOM</span>
          <h2>
            Words.
            <br />
            Company.
            <br />
            <em>No forever.</em>
          </h2>
          <p>
            Every margin leaves the feed after three days. There are no image
            uploads, videos, or popularity scores here.
          </p>
          <p>
            Your handle travels with you from the library. Change it anytime.
          </p>
          <div className="margin-room-rule mono">
            LEAVE ROOM FOR OTHER VOICES.
            <br />
            BE KIND IN THE MARGINS.
          </div>
          <p className="expiry-note">
            Posts disappear at 72 hours. Expired records are purged on feed
            visits and by daily cleanup.
          </p>
        </aside>
      </div>
    </section>
  );
}
