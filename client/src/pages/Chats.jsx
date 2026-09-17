import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import Avatar from "../components/Avatar.jsx";

function preview(c) {
  if (!c.lastMessage) return "No messages yet";
  const b = c.lastMessage.body;
  return b.length > 48 ? b.slice(0, 47) + "…" : b;
}

export default function Chats() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const nav = useNavigate();

  async function load() {
    const { conversations } = await api("/conversations");
    setItems(conversations);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="page">
      <header className="page-head">
        <h2>Chats</h2>
        <button className="ghost" onClick={() => setShowNew(true)}>
          + Group
        </button>
      </header>

      {loading ? (
        <p className="muted pad">Loading…</p>
      ) : (
        <ul className="chat-list">
          {items.map((c) => (
            <li key={c.id}>
              <button className="chat-row" onClick={() => nav(`/chats/${c.id}`)}>
                <Avatar user={{ photoUrl: c.photoUrl, avatarEmoji: c.emoji, avatarColor: c.color }} premium={c.isPremium} />
                <div className="chat-meta">
                  <div className="chat-title">
                    {c.title}
                    {c.type === "ai" && <span className="badge">AI</span>}
                    {(c.type === "group" || c.type === "room") && (
                      <span className="badge soft">{c.members.length}</span>
                    )}
                    {c.type === "room" && <span className="badge">Room</span>}
                  </div>
                  <div className="chat-preview muted">{preview(c)}</div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {showNew && (
        <NewGroup
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

function NewGroup({ onClose, onCreated }) {
  const [title, setTitle] = useState("");
  const [matches, setMatches] = useState([]);
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { matches } = await api("/matches");
      setMatches(matches);
    })();
  }, []);

  function toggle(id) {
    setPicked((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  async function create() {
    setBusy(true);
    try {
      const { conversation } = await api("/conversations/group", {
        method: "POST",
        body: { title: title.trim(), memberIds: [...picked] },
      });
      onCreated(conversation.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card sheet" onClick={(e) => e.stopPropagation()}>
        <h3>New group chat</h3>
        <label>
          Group name
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Trivia Team" />
        </label>
        <p className="muted sm">Add people from your matches:</p>
        <div className="pick-list">
          {matches.length === 0 && (
            <p className="muted sm">Match with people first to add them.</p>
          )}
          {matches.map((m) => (
            <label key={m.user.id} className="pick-row">
              <input
                type="checkbox"
                checked={picked.has(m.user.id)}
                onChange={() => toggle(m.user.id)}
              />
              <span className="avatar sm" style={{ background: m.user.avatarColor }}>
                {m.user.avatarEmoji}
              </span>
              {m.user.displayName}
            </label>
          ))}
        </div>
        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy} onClick={create}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
