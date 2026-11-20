import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import Avatar from "../components/Avatar.jsx";
import { ShareSheet } from "./LiveRoom.jsx";

const CATEGORY_EMOJI = {
  Dating: "💘", Music: "🎵", Gaming: "🎮", Cooking: "🍳", Fitness: "💪", Art: "🎨",
  Technology: "💻", Comedy: "😂", Dance: "💃", "Talk Show": "🎙️", Education: "📚", Social: "🌐",
};
const SORTS = [
  { key: "viewers", label: "↗ Most Viewers" },
  { key: "newest", label: "✦ Newest" },
  { key: "trending", label: "☆ Trending" },
];

export function since(startedAt, now = Date.now()) {
  const t = Date.parse(String(startedAt).replace(" ", "T") + "Z");
  const mins = Math.max(0, Math.floor((now - t) / 60000));
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// Live — StreamHub-style home: hero with live stats, search, sort, category
// chips and a grid of stream cards.
export default function Live() {
  const [streams, setStreams] = useState([]);
  const [categories, setCategories] = useState([]);
  const [videoConfigured, setVideoConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [params, setParams] = useSearchParams();
  const [showNew, setShowNew] = useState(params.get("go") === "1");
  const [sharing, setSharing] = useState(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("viewers");
  const [cat, setCat] = useState("All");
  const [error, setError] = useState("");
  const nav = useNavigate();

  async function load() {
    const d = await api("/live");
    setStreams(d.streams);
    setCategories(d.categories || []);
    setVideoConfigured(d.videoConfigured);
    setLoading(false);
  }

  useEffect(() => {
    load().catch((e) => {
      setError(e.message);
      setLoading(false);
    });
    const t = setInterval(() => load().catch(() => {}), 15000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (params.get("go") === "1") {
      setShowNew(true);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = streams.filter(
      (s) =>
        (cat === "All" || s.category === cat) &&
        (!q ||
          s.title.toLowerCase().includes(q) ||
          s.category?.toLowerCase().includes(q) ||
          [s.host, ...s.cohosts].some((u) => u.displayName.toLowerCase().includes(q)))
    );
    const by = {
      viewers: (a, b) => (b.viewers ?? 0) - (a.viewers ?? 0),
      newest: (a, b) => b.id - a.id,
      trending: (a, b) => b.giftSparks - a.giftSparks || (b.viewers ?? 0) - (a.viewers ?? 0),
    }[sort];
    return [...list].sort(by);
  }, [streams, query, sort, cat]);

  const totalViewers = streams.reduce((n, s) => n + (s.viewers ?? 0), 0);
  const cohostCount = streams.reduce((n, s) => n + s.cohosts.length, 0);

  return (
    <div className="page wide live-home">
      <section className="live-hero">
        <div className="live-hero-copy">
          <div className="pill-row">
            <span className="stat-pill live">● {streams.length} LIVE NOW</span>
            <span className="stat-pill">👁 {totalViewers.toLocaleString()} WATCHING</span>
          </div>
          <h1>
            Go Live. <span className="grad">Connect.</span>
            <br />
            <span className="dim">Find Your Match.</span>
          </h1>
          <p className="muted">
            Open a broadcast room, invite co-hosts, and meet people in real time. Your DatingPro members
            sign in with the account they already have.
          </p>
          <div className="row hero-actions">
            <button className="primary" onClick={() => setShowNew(true)} disabled={!videoConfigured}>
              📡 Start Streaming
            </button>
            <button className="ghost-dark" onClick={() => document.getElementById("live-list")?.scrollIntoView({ behavior: "smooth" })}>
              Browse Streams
            </button>
          </div>
          {!videoConfigured && (
            <p className="muted small">Going live turns on once Stream keys are added to the server.</p>
          )}
        </div>
        <div className="stat-tiles">
          <StatTile icon="📡" tone="red" value={streams.length} label="Live Streams" />
          <StatTile icon="👥" tone="violet" value={totalViewers.toLocaleString()} label="Total Viewers" />
          <StatTile icon="⚡" tone="amber" value={cohostCount} label="Co-Hosts Active" />
          <StatTile icon="🌐" tone="green" value={categories.length || 12} label="Categories" />
        </div>
      </section>

      <section className="live-filters" id="live-list">
        <div className="filter-row">
          <input
            className="search"
            placeholder="🔍  Search streams, hosts, tags…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="sort-tabs">
            {SORTS.map((s) => (
              <button key={s.key} className={`sort-tab ${sort === s.key ? "on" : ""}`} onClick={() => setSort(s.key)}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="cat-row">
          {["All", ...categories].map((c) => (
            <button key={c} className={`cat-chip ${cat === c ? "on" : ""}`} onClick={() => setCat(c)}>
              {c}
            </button>
          ))}
        </div>
      </section>

      <h2 className="section-title">{cat === "All" ? "All Live Streams" : `${cat} Streams`}</h2>
      <p className="muted section-sub">
        {shown.length} stream{shown.length === 1 ? "" : "s"} available
      </p>
      {error && <p className="error">{error}</p>}

      {loading ? (
        <div className="screen center"><div className="pulse">📡</div></div>
      ) : shown.length === 0 ? (
        <div className="empty-state">
          <div className="big">📡</div>
          <p>{streams.length ? "No streams match that." : "Nobody's live right now. Be the first."}</p>
        </div>
      ) : (
        <div className="live-grid">
          {shown.map((s) => (
            <StreamCard key={s.id} s={s} onWatch={() => nav(`/live/${s.id}`)} onShare={() => setSharing(s)} />
          ))}
        </div>
      )}

      {showNew && (
        <GoLiveSheet categories={categories} onClose={() => setShowNew(false)} onStarted={(id) => nav(`/live/${id}`)} />
      )}
      {sharing && <ShareSheet stream={sharing} onClose={() => setSharing(null)} />}
    </div>
  );
}

function StatTile({ icon, tone, value, label }) {
  return (
    <div className={`stat-tile ${tone}`}>
      <span className="stat-icon">{icon}</span>
      <b>{value}</b>
      <span className="muted small">{label}</span>
    </div>
  );
}

function StreamCard({ s, onWatch, onShare }) {
  return (
    <div className="stream-card">
      <button className="stream-thumb" onClick={onWatch} style={{ "--thumb": s.host.avatarColor }}>
        {s.host.photoUrl ? (
          <img src={s.host.photoUrl} alt="" />
        ) : (
          <span className="thumb-emoji">{CATEGORY_EMOJI[s.category] || "📡"}</span>
        )}
        <span className="live-badge">● {s.onAir === false ? "STARTING" : "LIVE"}</span>
        <span className="vis-tag">🌐 Public</span>
        <span className="thumb-stat left">👁 {s.viewers ?? 0}</span>
        <span className="thumb-stat right">{since(s.startedAt)}</span>
      </button>
      <div className="stream-body">
        <div className="stream-head">
          <Avatar user={s.host} size="sm" className="ring" />
          <div className="stream-head-text">
            <div className="stream-title">{s.title}</div>
            <div className="muted small">
              {s.host.displayName} <span className="crown">♛</span>
            </div>
          </div>
        </div>
        <div className="tag-row">
          <span className="tag violet">{s.category}</span>
          {s.cohosts.length > 0 && (
            <span className="tag green">👥 {s.cohosts.length} co-host{s.cohosts.length > 1 ? "s" : ""}</span>
          )}
          {s.giftSparks > 0 && <span className="tag amber">✨ {s.giftSparks}</span>}
        </div>
        {s.cohosts.length > 0 && (
          <div className="cohost-row">
            <span className="avatar-stack">
              {s.cohosts.map((c) => <Avatar key={c.id} user={c} size="xs" />)}
            </span>
            <span className="muted small">Co-hosting</span>
          </div>
        )}
        <div className="stream-actions">
          <button className="watch-btn" onClick={onWatch}>▷ Watch</button>
          <button className="icon-btn" onClick={onShare} title="Share">⤴</button>
        </div>
      </div>
    </div>
  );
}

function GoLiveSheet({ categories, onClose, onStarted }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Dating");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setStarting(true);
    setError("");
    try {
      const { stream } = await api("/live", { method: "POST", body: { title, category } });
      onStarted(stream.id);
    } catch (err) {
      setError(err.message);
      setStarting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="card sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>Go live</h3>
        <p className="muted small">
          Your camera goes on in a backstage first. Nobody sees you until you tap "Start broadcast".
        </p>
        <input
          autoFocus
          placeholder="What's your stream about?"
          value={title}
          maxLength={80}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="cat-row compact">
          {categories.map((c) => (
            <button type="button" key={c} className={`cat-chip ${category === c ? "on" : ""}`} onClick={() => setCategory(c)}>
              {CATEGORY_EMOJI[c]} {c}
            </button>
          ))}
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row-actions">
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={starting || !title.trim()}>
            {starting ? "Starting…" : "Open backstage"}
          </button>
        </div>
      </form>
    </div>
  );
}
