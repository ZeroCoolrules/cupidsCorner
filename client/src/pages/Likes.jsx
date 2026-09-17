import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api } from "../api.js";
import Avatar from "../components/Avatar.jsx";

export default function Likes() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nav = useNavigate();

  useEffect(() => {
    api("/likes").then(setData);
  }, []);

  async function goPremium() {
    setBusy(true);
    setError("");
    try {
      await api("/me/premium", { method: "POST" });
      setData(await api("/likes"));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <button className="ghost" onClick={() => nav(-1)}>
          ‹ Back
        </button>
        <h2 style={{ margin: 0 }}>Likes</h2>
      </header>

      {!data ? (
        <p className="muted pad">Loading…</p>
      ) : data.count === 0 ? (
        <div className="empty-state">
          <div className="big">💌</div>
          <p>No one's liked you yet — check back soon.</p>
        </div>
      ) : data.locked ? (
        <div className="card locked-likes">
          <div className="big">💌</div>
          <h3>
            {data.count} {data.count === 1 ? "person" : "people"} liked you
          </h3>
          <p className="muted sm">Go Premium to see exactly who — plus a boost in Discover.</p>
          {error && <div className="error">{error}</div>}
          <button className="primary" disabled={busy} onClick={goPremium}>
            👑 Go Premium — 200 ✨ / 7 days
          </button>
        </div>
      ) : (
        <div className="match-grid">
          {data.profiles.map((u) => (
            <Link key={u.id} to={`/u/${u.id}`} className="match-cell">
              <Avatar user={u} size="lg" />
              <div className="match-name">{u.displayName}</div>
              <div className="muted sm">{u.city}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
