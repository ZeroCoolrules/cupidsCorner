import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api } from "../api.js";
import Avatar, { isOnline } from "../components/Avatar.jsx";

export default function Matches() {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [likeCount, setLikeCount] = useState(0);
  const nav = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const { matches } = await api("/matches");
        setMatches(matches);
      } finally {
        setLoading(false);
      }
    })();
    api("/likes").then((d) => setLikeCount(d.count));
  }, []);

  return (
    <div className="page">
      <header className="page-head">
        <h2>Matches</h2>
      </header>

      {likeCount > 0 && (
        <Link to="/likes" className="likes-banner">
          💌 {likeCount} {likeCount === 1 ? "person" : "people"} liked you — take a look
        </Link>
      )}

      {loading ? (
        <p className="muted pad">Loading…</p>
      ) : matches.length === 0 ? (
        <div className="empty-state">
          <div className="big">💔</div>
          <p>No matches yet. Head to Discover and start liking.</p>
        </div>
      ) : (
        <div className="match-grid">
          {matches.map((m) => (
            <button
              key={m.user.id}
              className="match-cell"
              onClick={() =>
                m.conversationId && nav(`/chats/${m.conversationId}`)
              }
            >
              <Avatar user={m.user} size="lg" online={isOnline(m.user.lastSeenAt)} premium={m.user.isPremium} />
              <div className="match-name">{m.user.displayName}</div>
              <div className="muted sm">{m.user.city}</div>
              <Link
                to={`/u/${m.user.id}`}
                className="profile-link"
                onClick={(e) => e.stopPropagation()}
              >
                View profile
              </Link>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
