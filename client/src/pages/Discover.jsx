import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

function toQuery(filters) {
  const p = new URLSearchParams();
  if (filters.minAge) p.set("minAge", filters.minAge);
  if (filters.maxAge) p.set("maxAge", filters.maxAge);
  if (filters.interest) p.set("interest", filters.interest);
  if (filters.sameCity) p.set("sameCity", "1");
  const s = p.toString();
  return s ? `?${s}` : "";
}

export default function Discover() {
  const [deck, setDeck] = useState([]);
  const [loading, setLoading] = useState(true);
  const [match, setMatch] = useState(null);
  const [leaving, setLeaving] = useState(null); // 'like' | 'pass'
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({ minAge: "", maxAge: "", interest: "", sameCity: false });

  async function load(f = filters) {
    setLoading(true);
    try {
      const { profiles } = await api(`/discover${toQuery(f)}`);
      setDeck(profiles);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const top = deck[0];

  async function swipe(direction) {
    if (!top || leaving) return;
    setLeaving(direction);
    const target = top;
    try {
      const res = await api("/swipe", {
        method: "POST",
        body: { targetId: target.id, direction },
      });
      if (res.matched) {
        setMatch({ user: res.target, conversationId: res.conversationId });
      }
    } catch {
      /* ignore, still advance */
    }
    setTimeout(() => {
      setDeck((d) => d.slice(1));
      setLeaving(null);
    }, 260);
  }

  return (
    <div className="page discover">
      <header className="page-head">
        <h2>Discover</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="ghost" onClick={() => setShowFilters(true)}>
            ⚙️ Filters
          </button>
          <button className="ghost" onClick={() => load()}>
            Refresh
          </button>
        </div>
      </header>

      <div className="deck">
        {loading ? (
          <div className="card profile-card empty">Finding people…</div>
        ) : !top ? (
          <div className="card profile-card empty">
            <div className="big">🎉</div>
            <p>That's everyone for now.</p>
            <button className="primary" onClick={() => load()}>
              Check again
            </button>
          </div>
        ) : (
          deck.slice(0, 3).map((p, i) => (
            <article
              key={p.id}
              className={
                "card profile-card" +
                (i === 0 && leaving ? ` leaving-${leaving}` : "")
              }
              style={{
                zIndex: 10 - i,
                transform: `translateY(${i * 10}px) scale(${1 - i * 0.04})`,
                "--accent": p.avatarColor,
              }}
            >
              <div className="avatar-hero" style={{ background: p.avatarColor }}>
                {p.photoUrl ? (
                  <img className="hero-photo" src={p.photoUrl} alt={p.displayName} />
                ) : (
                  <span>{p.avatarEmoji}</span>
                )}
                {p.isPremium && <span className="hero-premium">👑 Premium</span>}
              </div>
              <div className="profile-body">
                <h3>
                  {p.displayName}
                  {p.age ? <span className="age">{p.age}</span> : null}
                </h3>
                <p className="muted">
                  {[p.city, p.gender, p.orientation].filter(Boolean).join(" · ")}
                </p>
                {p.bio && <p className="bio">{p.bio}</p>}
                {p.interests?.length > 0 && (
                  <div className="tags">
                    {p.interests.map((t) => (
                      <span key={t} className="tag">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </article>
          ))
        )}
      </div>

      {top && (
        <div className="swipe-actions">
          <button className="round pass" onClick={() => swipe("pass")}>
            ✕
          </button>
          <button className="round like" onClick={() => swipe("like")}>
            ♥
          </button>
        </div>
      )}

      {match && (
        <div className="modal-backdrop" onClick={() => setMatch(null)}>
          <div className="card match-modal" onClick={(e) => e.stopPropagation()}>
            <div className="big">💞</div>
            <h3>It's a match!</h3>
            <p>You and {match.user.displayName} liked each other.</p>
            <div className="modal-actions">
              <button className="ghost" onClick={() => setMatch(null)}>
                Keep swiping
              </button>
              {match.conversationId && (
                <Link className="primary" to={`/chats/${match.conversationId}`}>
                  Send a message
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      {showFilters && (
        <FilterSheet
          value={filters}
          onClose={() => setShowFilters(false)}
          onApply={(f) => {
            setFilters(f);
            setShowFilters(false);
            load(f);
          }}
        />
      )}
    </div>
  );
}

function FilterSheet({ value, onClose, onApply }) {
  const [f, setF] = useState(value);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card sheet" onClick={(e) => e.stopPropagation()}>
        <h3>Filters</h3>
        <div className="row">
          <label>
            Min age
            <input type="number" value={f.minAge} onChange={(e) => setF({ ...f, minAge: e.target.value })} />
          </label>
          <label>
            Max age
            <input type="number" value={f.maxAge} onChange={(e) => setF({ ...f, maxAge: e.target.value })} />
          </label>
        </div>
        <label>
          Interest
          <input
            value={f.interest}
            onChange={(e) => setF({ ...f, interest: e.target.value })}
            placeholder="hiking, film, tacos…"
          />
        </label>
        <label className="pick-row" style={{ marginTop: 4 }}>
          <input type="checkbox" checked={f.sameCity} onChange={(e) => setF({ ...f, sameCity: e.target.checked })} />
          Only my city
        </label>
        <div className="modal-actions">
          <button className="ghost" onClick={() => onApply({ minAge: "", maxAge: "", interest: "", sameCity: false })}>
            Clear
          </button>
          <button className="primary" onClick={() => onApply(f)}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
