import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { RichText, longDate } from "../lib/text.jsx";

export default function BlogPost() {
  const { slug } = useParams();
  const { user } = useAuth();
  const [post, setPost] = useState(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setPost(null);
    setError("");
    api(`/blog/${encodeURIComponent(slug)}`)
      .then((d) => {
        setPost(d.post);
        document.title = `${d.post.title} · Cupid's Corner`;
      })
      .catch((e) => setError(e.status === 404 ? "We couldn't find that article." : e.message));
    return () => {
      document.title = "Cupid's Corner";
    };
  }, [slug]);

  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: post.title, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      /* closed the share sheet */
    }
  }

  return (
    <div className="page article-page">
      <header className="page-head">
        <Link to="/blog" className="ghost">← Blog</Link>
        {post && <button className="ghost" onClick={share}>{copied ? "Link copied" : "Share"}</button>}
      </header>
      {error && (
        <div className="empty-state">
          <div className="big">🔎</div>
          <p>{error}</p>
        </div>
      )}
      {!post && !error && <p className="muted pad">Loading…</p>}
      {post && (
        <article className="card article">
          {post.coverUrl && <img className="article-cover" src={post.coverUrl} alt="" />}
          <h1>{post.title}</h1>
          <p className="muted sm">
            {post.authorName} · {longDate(post.publishedAt)}
          </p>
          <div className="article-body">
            <RichText text={post.body} />
          </div>
        </article>
      )}
      {post && !user && (
        <div className="card article-cta">
          <b>Ready to meet someone?</b>
          <p className="muted">Cupid's Corner is live dating with real people. Joining takes a minute.</p>
          <Link to="/login" className="primary">Join free</Link>
        </div>
      )}
    </div>
  );
}
