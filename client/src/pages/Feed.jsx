import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, apiUpload } from "../api.js";
import { useAuth } from "../auth.jsx";
import Avatar from "../components/Avatar.jsx";
import { timeAgo } from "../lib/text.jsx";

export default function Feed() {
  const { user } = useAuth();
  const [posts, setPosts] = useState(null);
  const [nextBefore, setNextBefore] = useState(null);
  const [limits, setLimits] = useState({ post: 1000, comment: 500 });
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    api("/feed")
      .then((d) => {
        setPosts(d.posts);
        setNextBefore(d.nextBefore);
        setLimits(d.limits);
      })
      .catch((e) => setError(e.message));
  }, []);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const d = await api(`/feed?before=${nextBefore}`);
      setPosts((p) => [...p, ...d.posts]);
      setNextBefore(d.nextBefore);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingMore(false);
    }
  }

  const patch = (id, changes) => setPosts((p) => p.map((x) => (x.id === id ? { ...x, ...changes } : x)));
  const remove = (id) => setPosts((p) => p.filter((x) => x.id !== id));

  return (
    <div className="page feed-page">
      <header className="page-head">
        <h2>Feed</h2>
        <Link to="/blog" className="ghost feed-blog-link">📰 Blog</Link>
      </header>

      <Composer user={user} max={limits.post} onPosted={(post) => setPosts((p) => [post, ...(p || [])])} />

      {error && <p className="feed-error">{error}</p>}
      {posts === null && !error && <p className="muted pad">Loading the feed…</p>}
      {posts?.length === 0 && (
        <div className="empty-state">
          <div className="big">🪶</div>
          <p>Nothing here yet. Be the first to post.</p>
        </div>
      )}

      {posts?.map((post) => (
        <PostCard key={post.id} post={post} max={limits.comment} onPatch={patch} onRemove={remove} />
      ))}

      {nextBefore && (
        <button className="ghost feed-more" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? "Loading…" : "Show more"}
        </button>
      )}
    </div>
  );
}

function Composer({ user, max, onPosted }) {
  const [body, setBody] = useState("");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef(null);

  useEffect(() => {
    if (!file) return setPreview("");
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function submit(e) {
    e.preventDefault();
    if (busy || (!body.trim() && !file)) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("body", body);
      if (file) form.append("photo", file);
      const { post } = await apiUpload("/feed", form);
      onPosted(post);
      setBody("");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card composer" onSubmit={submit}>
      <div className="composer-row">
        <Avatar user={user} size="sm" />
        <textarea
          rows={2}
          maxLength={max}
          placeholder="What's on your mind?"
          aria-label="Write a post"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>
      {preview && (
        <div className="composer-preview">
          <img src={preview} alt="" />
          <button type="button" className="icon-btn" aria-label="Remove photo" onClick={() => setFile(null)}>✕</button>
        </div>
      )}
      {error && <p className="feed-error">{error}</p>}
      <div className="composer-actions">
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          hidden
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
        <button type="button" className="ghost" onClick={() => fileInput.current?.click()}>📷 Photo</button>
        <span className="muted sm composer-count">{body.length > max - 100 ? `${body.length}/${max}` : ""}</span>
        <button className="primary" disabled={busy || (!body.trim() && !file)}>{busy ? "Posting…" : "Post"}</button>
      </div>
    </form>
  );
}

function PostCard({ post, max, onPatch, onRemove }) {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [note, setNote] = useState("");

  async function toggleLike() {
    const liked = !post.liked;
    onPatch(post.id, { liked, likeCount: post.likeCount + (liked ? 1 : -1) });
    try {
      const r = await api(`/feed/${post.id}/like`, { method: liked ? "POST" : "DELETE" });
      onPatch(post.id, r);
    } catch {
      onPatch(post.id, { liked: post.liked, likeCount: post.likeCount });
    }
  }

  async function del() {
    setMenu(false);
    if (!window.confirm("Delete this post?")) return;
    try {
      await api(`/feed/${post.id}`, { method: "DELETE" });
      onRemove(post.id);
    } catch (e) {
      setNote(e.message);
    }
  }

  async function report() {
    setMenu(false);
    const reason = window.prompt("What's wrong with this post?");
    if (reason === null) return;
    try {
      await api(`/feed/${post.id}/report`, { method: "POST", body: { reason } });
      setNote("Thanks. Our team will review this post.");
    } catch (e) {
      setNote(e.message);
    }
  }

  return (
    <article className="card post">
      <header className="post-head">
        <Link to={post.mine ? "/profile" : `/u/${post.author.id}`} className="post-author">
          <Avatar user={post.author} size="sm" />
          <span>
            <b>
              {post.author.displayName}
              {post.author.isVerified && <span className="post-verified" title="Verified"> ✔</span>}
            </b>
            <small className="muted">{timeAgo(post.createdAt)}</small>
          </span>
        </Link>
        <div className="post-menu-wrap">
          <button className="icon-btn" aria-label="Post options" onClick={() => setMenu((m) => !m)}>⋯</button>
          {menu && (
            <div className="post-menu">
              {post.canDelete && <button onClick={del}>🗑 Delete</button>}
              {!post.mine && <button onClick={report}>🚩 Report</button>}
            </div>
          )}
        </div>
      </header>
      {post.body && <p className="post-body">{post.body}</p>}
      {post.photoUrl && <img className="post-photo" src={post.photoUrl} alt="" loading="lazy" />}
      {note && <p className="muted sm">{note}</p>}
      <footer className="post-actions">
        <button className={"post-action" + (post.liked ? " on" : "")} onClick={toggleLike} aria-pressed={post.liked}>
          {post.liked ? "💜" : "🤍"} {post.likeCount || ""} {post.likeCount === 1 ? "like" : "likes"}
        </button>
        <button className="post-action" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          💬 {post.commentCount || ""} {post.commentCount === 1 ? "comment" : "comments"}
        </button>
      </footer>
      {open && (
        <Comments
          postId={post.id}
          max={max}
          onCount={(delta) => onPatch(post.id, { commentCount: Math.max(0, post.commentCount + delta) })}
        />
      )}
    </article>
  );
}

function Comments({ postId, max, onCount }) {
  const { user } = useAuth();
  const [items, setItems] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api(`/feed/${postId}/comments`)
      .then((d) => setItems(d.comments))
      .catch((e) => setError(e.message));
  }, [postId]);

  async function send(e) {
    e.preventDefault();
    if (busy || !text.trim()) return;
    setBusy(true);
    setError("");
    try {
      const { comment } = await api(`/feed/${postId}/comments`, { method: "POST", body: { body: text } });
      setItems((c) => [...(c || []), comment]);
      setText("");
      onCount(1);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function del(id) {
    try {
      await api(`/feed/comments/${id}`, { method: "DELETE" });
      setItems((c) => c.filter((x) => x.id !== id));
      onCount(-1);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="comments">
      {items === null && !error && <p className="muted sm">Loading comments…</p>}
      {items?.map((c) => (
        <div key={c.id} className="comment">
          <Avatar user={c.author} size="xs" />
          <div className="comment-bubble">
            <b>{c.author.displayName}</b> <small className="muted">{timeAgo(c.createdAt)}</small>
            <p>{c.body}</p>
          </div>
          {c.canDelete && (
            <button className="comment-del" aria-label="Delete comment" onClick={() => del(c.id)}>✕</button>
          )}
        </div>
      ))}
      {error && <p className="feed-error">{error}</p>}
      <form className="comment-form" onSubmit={send}>
        <Avatar user={user} size="xs" />
        <input
          value={text}
          maxLength={max}
          placeholder="Add a comment"
          aria-label="Add a comment"
          onChange={(e) => setText(e.target.value)}
        />
        <button className="ghost" disabled={busy || !text.trim()}>Send</button>
      </form>
    </div>
  );
}
