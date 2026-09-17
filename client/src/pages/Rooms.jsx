import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";

const EMOJIS = ["🌐", "🍸", "🧠", "🌙", "🎮", "🎤", "🔥", "☕"];
const COLORS = ["#7d5fff", "#ff6b8a", "#3ec6a0", "#f4a259", "#ef476f", "#06d6a0"];

export default function Rooms() {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [joiningId, setJoiningId] = useState(null);
  const [boostingId, setBoostingId] = useState(null);
  const nav = useNavigate();
  const { user } = useAuth();

  async function load() {
    const { rooms } = await api("/rooms");
    setRooms(rooms);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function join(room) {
    if (room.amIMember) return nav(`/chats/${room.id}`);
    setJoiningId(room.id);
    try {
      await api(`/rooms/${room.id}/join`, { method: "POST" });
      nav(`/chats/${room.id}`);
    } finally {
      setJoiningId(null);
    }
  }

  async function boost(room) {
    setBoostingId(room.id);
    try {
      await api(`/rooms/${room.id}/boost`, { method: "POST" });
      await load();
    } catch (err) {
      alert(err.message);
    } finally {
      setBoostingId(null);
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <h2>Rooms</h2>
        <button className="ghost" onClick={() => setShowNew(true)}>
          + Room
        </button>
      </header>
      <p className="muted sm" style={{ margin: "-6px 0 14px" }}>
        Public webcam rooms — hop in, say hi, watch a few cams at once.
      </p>

      {loading ? (
        <p className="muted pad">Loading…</p>
      ) : rooms.length === 0 ? (
        <div className="empty-state">
          <div className="big">🌐</div>
          <p>No rooms yet — open the first one.</p>
        </div>
      ) : (
        <div className="room-list">
          {rooms.map((r) => (
            <div key={r.id} className="room-card">
              <div className="avatar lg" style={{ background: r.color }}>
                {r.emoji}
              </div>
              <div className="room-card-body">
                <div className="chat-title">
                  {r.title}
                  {r.boosted && <span className="badge">🚀 Boosted</span>}
                </div>
                {r.topic && <div className="muted sm">{r.topic}</div>}
                <div className="muted sm">
                  {r.memberCount} {r.memberCount === 1 ? "person" : "people"}
                  {r.createdBy ? ` · hosted by ${r.createdBy.displayName}` : ""}
                </div>
              </div>
              <div className="room-actions">
                <button className="room-join" onClick={() => join(r)} disabled={joiningId === r.id}>
                  {r.amIMember ? "Open" : joiningId === r.id ? "…" : "Join"}
                </button>
                {r.createdBy?.id === user.id && !r.boosted && (
                  <button className="ghost sm-btn" onClick={() => boost(r)} disabled={boostingId === r.id}>
                    🚀 Boost
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showNew && (
        <NewRoom
          onClose={() => setShowNew(false)}
          onCreated={(id) => {
            setShowNew(false);
            nav(`/chats/${id}`);
          }}
        />
      )}
    </div>
  );
}

function NewRoom({ onClose, onCreated }) {
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [emoji, setEmoji] = useState(EMOJIS[0]);
  const [color, setColor] = useState(COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    if (!title.trim()) return setError("give the room a name");
    setBusy(true);
    setError("");
    try {
      const { room } = await api("/rooms", { method: "POST", body: { title, topic, emoji, color } });
      onCreated(room.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card sheet" onClick={(e) => e.stopPropagation()}>
        <h3>Open a room</h3>
        <label>
          Room name
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Friday Night Lounge" />
        </label>
        <label>
          Topic
          <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Hang out, watch cams, say hi." />
        </label>
        <div className="picker">
          <span>Icon</span>
          <div className="emoji-row">
            {EMOJIS.map((e) => (
              <button
                type="button"
                key={e}
                className={"chip" + (emoji === e ? " on" : "")}
                onClick={() => setEmoji(e)}
              >
                {e}
              </button>
            ))}
          </div>
          <div className="emoji-row">
            {COLORS.map((c) => (
              <button
                type="button"
                key={c}
                className={"swatch" + (color === c ? " on" : "")}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy} onClick={create}>
            Open room
          </button>
        </div>
      </div>
    </div>
  );
}
