// The member feed and the public blog.
//
// Feed: members post a short update with an optional photo; others like and
// comment. Blocks and bans apply the same way they do everywhere else: you
// never see posts or comments from someone you blocked, who blocked you, or
// who is banned. Reporting a post files a normal report against its author,
// so it lands in the existing admin Reports queue.
//
// Blog: articles written by admins (ADMIN_USERNAMES). Published posts are
// public, with no sign-in, so they can be shared and found by search engines.

import fs from "node:fs";
import path from "node:path";
import { db } from "./db.js";

export const FEED_POST_MAX = 1000;
export const FEED_COMMENT_MAX = 500;
const BLOG_TITLE_MAX = 140;
const BLOG_EXCERPT_MAX = 300;
const BLOG_BODY_MAX = 50_000;

export async function initSocial() {
  await db.schema(`
    CREATE TABLE IF NOT EXISTS feed_posts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body       TEXT NOT NULL DEFAULT '',
      photo_url  TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_feed_posts_user ON feed_posts(user_id, id);

    CREATE TABLE IF NOT EXISTS feed_likes (
      post_id    INTEGER NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (post_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS feed_comments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id    INTEGER NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_feed_comments_post ON feed_comments(post_id, id);

    CREATE TABLE IF NOT EXISTS blog_posts (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      slug         TEXT NOT NULL UNIQUE,
      title        TEXT NOT NULL,
      excerpt      TEXT NOT NULL DEFAULT '',
      body         TEXT NOT NULL DEFAULT '',
      cover_url    TEXT,
      author_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      status       TEXT NOT NULL DEFAULT 'draft',
      published_at TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_blog_posts_status ON blog_posts(status, published_at);
  `);
}

// "My First Date Tips!" -> "my-first-date-tips"
export function slugify(title) {
  return (
    String(title || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .replace(/-+$/, "") || "post"
  );
}

// The viewer and the author must not have blocked each other.
const NOT_BLOCKED = (col) => `
  NOT EXISTS (
    SELECT 1 FROM blocks b
    WHERE (b.blocker_id = @me AND b.blocked_id = ${col})
       OR (b.blocker_id = ${col} AND b.blocked_id = @me)
  )`;

const POST_SELECT = `
  SELECT p.id, p.user_id, p.body, p.photo_url, p.created_at,
         pr.display_name, pr.avatar_emoji, pr.avatar_color, pr.photo_url AS author_photo, pr.verified_at,
         (SELECT COUNT(*) FROM feed_likes l WHERE l.post_id = p.id) AS like_count,
         (SELECT COUNT(*) FROM feed_comments c
            JOIN users cu ON cu.id = c.user_id
           WHERE c.post_id = p.id AND cu.banned_at IS NULL AND ${NOT_BLOCKED("c.user_id")}) AS comment_count,
         (SELECT COUNT(*) FROM feed_likes l WHERE l.post_id = p.id AND l.user_id = @me) AS liked
  FROM feed_posts p
  JOIN users u ON u.id = p.user_id
  JOIN profiles pr ON pr.user_id = p.user_id
  WHERE u.banned_at IS NULL AND ${NOT_BLOCKED("p.user_id")}`;

const sq = {
  feedPage: db.prepare(`${POST_SELECT} AND (@before = 0 OR p.id < @before) ORDER BY p.id DESC LIMIT @limit`),
  feedByUser: db.prepare(
    `${POST_SELECT} AND p.user_id = @userId AND (@before = 0 OR p.id < @before) ORDER BY p.id DESC LIMIT @limit`
  ),
  visiblePost: db.prepare(`${POST_SELECT} AND p.id = @id`),
  rawPost: db.prepare("SELECT * FROM feed_posts WHERE id = ?"),
  insertPost: db.prepare("INSERT INTO feed_posts (user_id, body, photo_url) VALUES (?, ?, ?)"),
  deletePost: db.prepare("DELETE FROM feed_posts WHERE id = ?"),
  like: db.prepare("INSERT INTO feed_likes (post_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING"),
  unlike: db.prepare("DELETE FROM feed_likes WHERE post_id = ? AND user_id = ?"),
  likeCount: db.prepare("SELECT COUNT(*) AS n FROM feed_likes WHERE post_id = ?"),
  comments: db.prepare(`
    SELECT c.id, c.post_id, c.user_id, c.body, c.created_at,
           pr.display_name, pr.avatar_emoji, pr.avatar_color, pr.photo_url AS author_photo, pr.verified_at
    FROM feed_comments c
    JOIN users u ON u.id = c.user_id
    JOIN profiles pr ON pr.user_id = c.user_id
    WHERE c.post_id = @postId AND u.banned_at IS NULL AND ${NOT_BLOCKED("c.user_id")}
    ORDER BY c.id ASC LIMIT 200`),
  commentById: db.prepare(`
    SELECT c.id, c.post_id, c.user_id, c.body, c.created_at,
           pr.display_name, pr.avatar_emoji, pr.avatar_color, pr.photo_url AS author_photo, pr.verified_at
    FROM feed_comments c JOIN profiles pr ON pr.user_id = c.user_id WHERE c.id = ?`),
  rawComment: db.prepare(
    "SELECT c.*, p.user_id AS post_owner FROM feed_comments c JOIN feed_posts p ON p.id = c.post_id WHERE c.id = ?"
  ),
  insertComment: db.prepare("INSERT INTO feed_comments (post_id, user_id, body) VALUES (?, ?, ?)"),
  deleteComment: db.prepare("DELETE FROM feed_comments WHERE id = ?"),

  blogPublished: db.prepare(`
    SELECT b.id, b.slug, b.title, b.excerpt, b.cover_url, b.published_at, pr.display_name AS author_name
    FROM blog_posts b LEFT JOIN profiles pr ON pr.user_id = b.author_id
    WHERE b.status = 'published' ORDER BY b.published_at DESC, b.id DESC LIMIT 100`),
  blogAll: db.prepare(`
    SELECT b.*, pr.display_name AS author_name
    FROM blog_posts b LEFT JOIN profiles pr ON pr.user_id = b.author_id
    ORDER BY b.updated_at DESC, b.id DESC`),
  blogBySlug: db.prepare(`
    SELECT b.*, pr.display_name AS author_name
    FROM blog_posts b LEFT JOIN profiles pr ON pr.user_id = b.author_id WHERE b.slug = ?`),
  blogById: db.prepare(`
    SELECT b.*, pr.display_name AS author_name
    FROM blog_posts b LEFT JOIN profiles pr ON pr.user_id = b.author_id WHERE b.id = ?`),
  blogSlugTaken: db.prepare("SELECT id FROM blog_posts WHERE slug = ? AND id != ?"),
  insertBlog: db.prepare(
    "INSERT INTO blog_posts (slug, title, excerpt, body, author_id, status, published_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ),
  updateBlog: db.prepare(`
    UPDATE blog_posts
    SET slug = ?, title = ?, excerpt = ?, body = ?, status = ?, published_at = ?, updated_at = datetime('now')
    WHERE id = ?`),
  setBlogCover: db.prepare("UPDATE blog_posts SET cover_url = ?, updated_at = datetime('now') WHERE id = ?"),
  deleteBlog: db.prepare("DELETE FROM blog_posts WHERE id = ?"),
  now: db.prepare("SELECT datetime('now') AS now"),
};

const author = (r) => ({
  id: r.user_id,
  displayName: r.display_name,
  avatarEmoji: r.avatar_emoji,
  avatarColor: r.avatar_color,
  photoUrl: r.author_photo || null,
  isVerified: !!r.verified_at,
});

const postOut = (r, me, admin) => ({
  id: r.id,
  body: r.body,
  photoUrl: r.photo_url || null,
  createdAt: r.created_at,
  author: author(r),
  likeCount: r.like_count,
  commentCount: r.comment_count,
  liked: !!r.liked,
  mine: r.user_id === me,
  canDelete: r.user_id === me || admin,
});

const commentOut = (r, me, admin, postOwner) => ({
  id: r.id,
  body: r.body,
  createdAt: r.created_at,
  author: author(r),
  canDelete: r.user_id === me || postOwner === me || admin,
});

const blogSummary = (r) => ({
  id: r.id,
  slug: r.slug,
  title: r.title,
  excerpt: r.excerpt,
  coverUrl: r.cover_url || null,
  publishedAt: r.published_at,
  authorName: r.author_name || "Cupid's Corner",
});

const blogFull = (r) => ({
  ...blogSummary(r),
  body: r.body,
  status: r.status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const clean = (v, max) => String(v ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);

async function uniqueSlug(wanted, ownId = 0) {
  const base = slugify(wanted);
  let slug = base;
  for (let n = 2; await sq.blogSlugTaken.get(slug, ownId); n++) slug = `${base}-${n}`;
  return slug;
}

// Photo files a member attached to feed posts, for cleanup when the account is deleted.
export async function feedPhotosOf(userId) {
  const rows = await db.prepare("SELECT photo_url FROM feed_posts WHERE user_id = ? AND photo_url IS NOT NULL").all(userId);
  return rows.map((r) => r.photo_url);
}

export function registerSocialRoutes(app, { auth, adminOnly, isAdmin, q, rateLimit, upload, uploadsDir }) {
  const removeUpload = (url) => {
    if (url) fs.unlink(path.join(uploadsDir, path.basename(url)), () => {});
  };
  const postLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 30,
    message: "You're posting a lot. Take a short break and try again.",
  });
  const commentLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 60,
    message: "You're commenting a lot. Take a short break and try again.",
  });
  const pageArgs = (req) => ({
    me: req.userId,
    before: Math.max(0, Math.floor(Number(req.query.before)) || 0),
    limit: Math.min(50, Math.max(1, Math.floor(Number(req.query.limit)) || 20)),
  });

  // ---- feed ---------------------------------------------------------------

  app.get("/api/feed", auth, async (req, res) => {
    const args = pageArgs(req);
    const userId = Math.floor(Number(req.query.user)) || 0;
    const rows = userId ? await sq.feedByUser.all({ ...args, userId }) : await sq.feedPage.all(args);
    const admin = isAdmin(req.username);
    res.json({
      posts: rows.map((r) => postOut(r, req.userId, admin)),
      nextBefore: rows.length === args.limit ? rows[rows.length - 1].id : null,
      isAdmin: admin,
      limits: { post: FEED_POST_MAX, comment: FEED_COMMENT_MAX },
    });
  });

  app.post("/api/feed", auth, postLimiter, upload.single("photo"), async (req, res) => {
    const body = clean(req.body?.body, FEED_POST_MAX);
    if (!body && !req.file) {
      return res.status(400).json({ error: "Write something or add a photo first." });
    }
    const ins = await sq.insertPost.run(req.userId, body, req.file ? `/uploads/${req.file.filename}` : null);
    const row = await sq.visiblePost.get({ me: req.userId, id: Number(ins.lastInsertRowid) });
    res.json({ post: postOut(row, req.userId, isAdmin(req.username)) });
  });

  app.delete("/api/feed/:id", auth, async (req, res) => {
    const post = await sq.rawPost.get(Number(req.params.id));
    if (!post) return res.status(404).json({ error: "That post is gone." });
    if (post.user_id !== req.userId && !isAdmin(req.username)) {
      return res.status(403).json({ error: "You can only delete your own posts." });
    }
    await sq.deletePost.run(post.id);
    removeUpload(post.photo_url);
    res.json({ ok: true });
  });

  // Loads a post the member is allowed to see, or answers 404.
  async function visiblePost(req, res) {
    const row = await sq.visiblePost.get({ me: req.userId, id: Number(req.params.id) });
    if (!row) res.status(404).json({ error: "That post is gone." });
    return row;
  }

  app.post("/api/feed/:id/like", auth, async (req, res) => {
    const post = await visiblePost(req, res);
    if (!post) return;
    await sq.like.run(post.id, req.userId);
    res.json({ liked: true, likeCount: (await sq.likeCount.get(post.id)).n });
  });

  app.delete("/api/feed/:id/like", auth, async (req, res) => {
    const post = await visiblePost(req, res);
    if (!post) return;
    await sq.unlike.run(post.id, req.userId);
    res.json({ liked: false, likeCount: (await sq.likeCount.get(post.id)).n });
  });

  app.get("/api/feed/:id/comments", auth, async (req, res) => {
    const post = await visiblePost(req, res);
    if (!post) return;
    const admin = isAdmin(req.username);
    const rows = await sq.comments.all({ me: req.userId, postId: post.id });
    res.json({ comments: rows.map((r) => commentOut(r, req.userId, admin, post.user_id)) });
  });

  app.post("/api/feed/:id/comments", auth, commentLimiter, async (req, res) => {
    const post = await visiblePost(req, res);
    if (!post) return;
    const body = clean(req.body?.body, FEED_COMMENT_MAX);
    if (!body) return res.status(400).json({ error: "Write a comment first." });
    const ins = await sq.insertComment.run(post.id, req.userId, body);
    const row = await sq.commentById.get(Number(ins.lastInsertRowid));
    res.json({ comment: commentOut(row, req.userId, isAdmin(req.username), post.user_id) });
  });

  // The comment's author, the post's author, or an admin can remove a comment.
  app.delete("/api/feed/comments/:id", auth, async (req, res) => {
    const c = await sq.rawComment.get(Number(req.params.id));
    if (!c) return res.status(404).json({ error: "That comment is gone." });
    if (c.user_id !== req.userId && c.post_owner !== req.userId && !isAdmin(req.username)) {
      return res.status(403).json({ error: "You can't delete that comment." });
    }
    await sq.deleteComment.run(c.id);
    res.json({ ok: true });
  });

  const feedReportLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 30,
    message: "You've sent a lot of reports. Try again later.",
  });
  app.post("/api/feed/:id/report", auth, feedReportLimiter, async (req, res) => {
    const post = await visiblePost(req, res);
    if (!post) return;
    if (post.user_id === req.userId) return res.status(400).json({ error: "That's your own post." });
    const why = clean(req.body?.reason, 300) || "No reason given";
    const quote = post.body ? ` "${post.body.slice(0, 120)}"` : "";
    await q.insertReport.run(req.userId, post.user_id, `Feed post #${post.id}${quote}: ${why}`.slice(0, 500));
    res.json({ ok: true });
  });

  // ---- blog (public reads) ------------------------------------------------

  app.get("/api/blog", async (req, res) => {
    res.json({ posts: (await sq.blogPublished.all()).map(blogSummary) });
  });

  app.get("/api/blog/:slug", async (req, res) => {
    const row = await sq.blogBySlug.get(String(req.params.slug));
    if (!row || row.status !== "published") return res.status(404).json({ error: "No such article." });
    res.json({ post: blogFull(row) });
  });

  // ---- blog (admin writes) ------------------------------------------------

  function blogInput(body) {
    const title = clean(body?.title, BLOG_TITLE_MAX);
    if (!title) return { error: "Give the article a title." };
    const text = clean(body?.body, BLOG_BODY_MAX);
    const status = body?.status === "published" ? "published" : "draft";
    if (status === "published" && !text) return { error: "Write the article before publishing it." };
    const excerpt =
      clean(body?.excerpt, BLOG_EXCERPT_MAX) ||
      text.replace(/[#*_>\[\]`]/g, "").replace(/\s+/g, " ").trim().slice(0, 180);
    return { title, body: text, status, excerpt, slug: clean(body?.slug, 80) };
  }

  app.get("/api/admin/blog", auth, adminOnly, async (req, res) => {
    res.json({ posts: (await sq.blogAll.all()).map(blogFull) });
  });

  app.get("/api/admin/blog/:id", auth, adminOnly, async (req, res) => {
    const row = await sq.blogById.get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: "No such article." });
    res.json({ post: blogFull(row) });
  });

  app.post("/api/admin/blog", auth, adminOnly, async (req, res) => {
    const input = blogInput(req.body);
    if (input.error) return res.status(400).json({ error: input.error });
    const slug = await uniqueSlug(input.slug || input.title);
    const publishedAt = input.status === "published" ? (await sq.now.get()).now : null;
    const ins = await sq.insertBlog.run(
      slug, input.title, input.excerpt, input.body, req.userId, input.status, publishedAt
    );
    res.json({ post: blogFull(await sq.blogById.get(Number(ins.lastInsertRowid))) });
  });

  app.put("/api/admin/blog/:id", auth, adminOnly, async (req, res) => {
    const cur = await sq.blogById.get(Number(req.params.id));
    if (!cur) return res.status(404).json({ error: "No such article." });
    const input = blogInput(req.body);
    if (input.error) return res.status(400).json({ error: input.error });
    // The link stays the same once an article exists, unless a new one is asked for.
    const slug = input.slug && slugify(input.slug) !== cur.slug ? await uniqueSlug(input.slug, cur.id) : cur.slug;
    const publishedAt =
      input.status === "published" ? cur.published_at || (await sq.now.get()).now : cur.published_at;
    await sq.updateBlog.run(slug, input.title, input.excerpt, input.body, input.status, publishedAt, cur.id);
    res.json({ post: blogFull(await sq.blogById.get(cur.id)) });
  });

  app.post("/api/admin/blog/:id/cover", auth, adminOnly, upload.single("photo"), async (req, res) => {
    const cur = await sq.blogById.get(Number(req.params.id));
    if (!cur) {
      if (req.file) removeUpload(req.file.filename);
      return res.status(404).json({ error: "No such article." });
    }
    if (!req.file) return res.status(400).json({ error: "Upload a jpg, png, webp, or gif under 5MB." });
    removeUpload(cur.cover_url);
    await sq.setBlogCover.run(`/uploads/${req.file.filename}`, cur.id);
    res.json({ post: blogFull(await sq.blogById.get(cur.id)) });
  });

  app.delete("/api/admin/blog/:id/cover", auth, adminOnly, async (req, res) => {
    const cur = await sq.blogById.get(Number(req.params.id));
    if (!cur) return res.status(404).json({ error: "No such article." });
    removeUpload(cur.cover_url);
    await sq.setBlogCover.run(null, cur.id);
    res.json({ post: blogFull(await sq.blogById.get(cur.id)) });
  });

  app.delete("/api/admin/blog/:id", auth, adminOnly, async (req, res) => {
    const cur = await sq.blogById.get(Number(req.params.id));
    if (!cur) return res.status(404).json({ error: "No such article." });
    await sq.deleteBlog.run(cur.id);
    removeUpload(cur.cover_url);
    res.json({ ok: true });
  });
}
