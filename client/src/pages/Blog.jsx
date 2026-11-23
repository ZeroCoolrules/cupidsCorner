import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { longDate } from "../lib/text.jsx";

// Public list of articles. Signed-in admins also see their drafts and a
// button to write a new article.
export default function Blog() {
  const { user } = useAuth();
  const [posts, setPosts] = useState(null);
  const [mine, setMine] = useState(null); // admin view: every article, drafts included
  const [error, setError] = useState("");

  useEffect(() => {
    api("/blog")
      .then((d) => setPosts(d.posts))
      .catch((e) => setError(e.message));
    if (user) {
      api("/admin/blog")
        .then((d) => setMine(d.posts))
        .catch(() => {}); // not an admin
    }
  }, [user]);

  const drafts = mine?.filter((p) => p.status !== "published") || [];

  return (
    <div className="page wide blog-page">
      <header className="blog-hero">
        <span className="stat-pill">THE BLOG</span>
        <h1>
          Dating advice, <span className="grad">without the fluff</span>
        </h1>
        <p className="muted">Tips, stories and news from the Cupid's Corner team.</p>
        <div className="row-gap">
          {mine && <Link to="/blog/write" className="primary">✍️ Write an article</Link>}
          {!user && <Link to="/login" className="primary">Join Cupid's Corner</Link>}
        </div>
      </header>

      {drafts.length > 0 && (
        <section>
          <h3 className="section-title">Your drafts</h3>
          <div className="draft-list">
            {drafts.map((p) => (
              <Link key={p.id} to={`/blog/write/${p.id}`} className="draft-row">
                <span className="tag amber">Draft</span>
                <b>{p.title}</b>
                <span className="muted sm">Edit →</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {error && <p className="feed-error">{error}</p>}
      {posts === null && !error && <p className="muted pad">Loading articles…</p>}
      {posts?.length === 0 && (
        <div className="empty-state">
          <div className="big">📰</div>
          <p>No articles yet. Check back soon.</p>
        </div>
      )}

      <div className="blog-grid">
        {posts?.map((p) => (
          <article key={p.id} className="blog-card">
            <Link to={`/blog/${p.slug}`} className="blog-card-link">
              <div className="blog-cover">
                {p.coverUrl ? <img src={p.coverUrl} alt="" loading="lazy" /> : <span>💘</span>}
              </div>
              <div className="blog-card-body">
                <h3>{p.title}</h3>
                <p className="muted">{p.excerpt}</p>
                <small className="muted">
                  {p.authorName} · {longDate(p.publishedAt)}
                </small>
              </div>
            </Link>
            {mine && (
              <Link to={`/blog/write/${p.id}`} className="ghost blog-edit">Edit</Link>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
