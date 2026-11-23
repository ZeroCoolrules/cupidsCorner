import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, apiUpload } from "../api.js";
import { RichText } from "../lib/text.jsx";

// Admin-only: write, edit, publish or delete a blog article.
export default function BlogEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const [post, setPost] = useState(null);
  const [title, setTitle] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [denied, setDenied] = useState(false);
  const coverInput = useRef(null);

  useEffect(() => {
    const req = id ? api(`/admin/blog/${id}`) : api("/admin/blog");
    req
      .then((d) => {
        if (!id) return;
        setPost(d.post);
        setTitle(d.post.title);
        setExcerpt(d.post.excerpt);
        setBody(d.post.body);
      })
      .catch((e) => (e.status === 403 ? setDenied(true) : setError(e.message)));
  }, [id]);

  async function save(status) {
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const payload = { title, excerpt, body, status };
      const d = post
        ? await api(`/admin/blog/${post.id}`, { method: "PUT", body: payload })
        : await api("/admin/blog", { method: "POST", body: payload });
      setPost(d.post);
      setSaved(status === "published" ? "Published." : "Draft saved.");
      if (!post) nav(`/blog/write/${d.post.id}`, { replace: true });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadCover(file) {
    if (!file || !post) return;
    setError("");
    try {
      const form = new FormData();
      form.append("photo", file);
      const d = await apiUpload(`/admin/blog/${post.id}/cover`, form);
      setPost(d.post);
    } catch (e) {
      setError(e.message);
    }
  }

  async function removeCover() {
    try {
      const d = await api(`/admin/blog/${post.id}/cover`, { method: "DELETE" });
      setPost(d.post);
    } catch (e) {
      setError(e.message);
    }
  }

  async function del() {
    if (!window.confirm("Delete this article for good?")) return;
    try {
      await api(`/admin/blog/${post.id}`, { method: "DELETE" });
      nav("/blog", { replace: true });
    } catch (e) {
      setError(e.message);
    }
  }

  if (denied) {
    return (
      <div className="page">
        <div className="empty-state">
          <div className="big">🔒</div>
          <p>Only admins can write blog articles.</p>
          <Link to="/blog" className="ghost">Back to the blog</Link>
        </div>
      </div>
    );
  }

  const live = post?.status === "published";

  return (
    <div className="page wide editor-page">
      <header className="page-head">
        <Link to="/blog" className="ghost">← Blog</Link>
        <span className={"tag " + (live ? "green" : "amber")}>{live ? "Published" : "Draft"}</span>
      </header>

      <div className="card editor">
        <label>
          Title
          <input value={title} maxLength={140} placeholder="5 first date ideas that work" onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Short summary (shown on the blog list)
          <input value={excerpt} maxLength={300} placeholder="Leave empty to use the first lines of the article" onChange={(e) => setExcerpt(e.target.value)} />
        </label>

        <div className="editor-tabs">
          <button type="button" className={"sort-tab" + (!preview ? " on" : "")} onClick={() => setPreview(false)}>Write</button>
          <button type="button" className={"sort-tab" + (preview ? " on" : "")} onClick={() => setPreview(true)}>Preview</button>
        </div>
        {preview ? (
          <div className="article-body editor-preview">
            {body.trim() ? <RichText text={body} /> : <p className="muted">Nothing to preview yet.</p>}
          </div>
        ) : (
          <>
            <textarea
              rows={16}
              value={body}
              aria-label="Article text"
              placeholder="Write your article here."
              onChange={(e) => setBody(e.target.value)}
            />
            <p className="muted sm">
              Leave an empty line between paragraphs. Start a line with ## for a heading, - for a bullet, &gt; for a
              quote. Use **bold**, *italic* and [link text](https://example.com).
            </p>
          </>
        )}

        <div className="editor-cover">
          <b>Cover photo</b>
          {post ? (
            <>
              {post.coverUrl && <img src={post.coverUrl} alt="" />}
              <input
                ref={coverInput}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                hidden
                onChange={(e) => uploadCover(e.target.files?.[0])}
              />
              <div className="row-gap">
                <button type="button" className="ghost" onClick={() => coverInput.current?.click()}>
                  {post.coverUrl ? "Change photo" : "Add photo"}
                </button>
                {post.coverUrl && <button type="button" className="ghost" onClick={removeCover}>Remove</button>}
              </div>
            </>
          ) : (
            <p className="muted sm">Save a draft first, then you can add a cover photo.</p>
          )}
        </div>

        {error && <p className="feed-error">{error}</p>}
        {saved && <p className="editor-saved">{saved} {live && post && <Link to={`/blog/${post.slug}`}>View article</Link>}</p>}

        <div className="editor-actions">
          {post && <button type="button" className="ghost editor-del" onClick={del}>Delete</button>}
          <span className="spacer" />
          <button type="button" className="ghost" disabled={busy || !title.trim()} onClick={() => save("draft")}>
            {live ? "Unpublish" : "Save draft"}
          </button>
          <button type="button" className="primary" disabled={busy || !title.trim()} onClick={() => save("published")}>
            {live ? "Update" : "Publish"}
          </button>
        </div>
      </div>
    </div>
  );
}
