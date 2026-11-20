import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import Avatar from "../components/Avatar.jsx";

// Live — who's broadcasting right now, and the "Go live" button.
export default function Live() {
  const [streams, setStreams] = useState([]);
  const [videoConfigured, setVideoConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [title, setTitle] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const nav = useNavigate();

  async function load() {
    const d = await api("/live");
    setStreams(d.streams);
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

  async function goLive(e) {
    e.preventDefault();
    setStarting(true);
    setError("");
    try {
      const { stream } = await api("/live", { method: "POST", body: { title } });
      nav(`/live/${stream.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <h2>Live</h2>
        <button className="go-live-btn" onClick={() => setShowNew(true)} disabled={!videoConfigured}>
          ● Go live
        </button>
      </header>

      {!videoConfigured && (
        <p className="muted small">Live video turns on once Stream keys are added to the server.</p>
      )}
      {error && !showNew && <p className="error">{error}</p>}

      {loading ? (
        <div className="screen center"><div className="pulse">📡</div></div>
      ) : streams.length === 0 ? (
        <div className="empty-state">
          <div className="big">📡</div>
          <p>Nobody's live right now. Be the first.</p>
        </div>
      ) : (
        <div className="live-grid">
          {streams.map((s) => (
            <button key={s.id} className="live-card" onClick={() => nav(`/live/${s.id}`)}>
              <div className="live-card-stage" style={{ background: s.host.avatarColor }}>
                <Avatar user={s.host} size="lg" />
                <span className="live-badge">{s.onAir === false ? "STARTING" : "LIVE"}</span>
                {s.viewers != null && <span className="live-viewers">👁 {s.viewers}</span>}
              </div>
              <div className="live-card-body">
                <div className="live-card-title">{s.title}</div>
                <div className="muted small">
                  {s.host.displayName}
                  {s.cohosts.length > 0 && ` + ${s.cohosts.map((c) => c.displayName).join(", ")}`}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {showNew && (
        <div className="modal-backdrop" onClick={() => setShowNew(false)}>
          <form className="card sheet" onClick={(e) => e.stopPropagation()} onSubmit={goLive}>
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
            {error && <p className="error">{error}</p>}
            <div className="row-actions">
              <button type="button" className="ghost" onClick={() => setShowNew(false)}>Cancel</button>
              <button type="submit" className="primary" disabled={starting || !title.trim()}>
                {starting ? "Starting…" : "Open backstage"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
