import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useStreamChatClient } from "../streamChat.js";
import Avatar from "../components/Avatar.jsx";

function preview(c) {
  if (!c.lastMessage) return "No messages yet";
  const b = c.lastMessage.body;
  return b.length > 48 ? b.slice(0, 47) + "…" : b;
}

// When Stream Chat is on, real messages only live in Stream, so the server's
// lastMessage (local table) is stale. Summarise each watched channel into
// { [conversationId]: { lastMessage, unread } } to overlay on the list.
function summarizeChannels(client) {
  const out = {};
  for (const ch of Object.values(client.activeChannels)) {
    if (!ch.id?.startsWith("conv-")) continue;
    const m = ch.lastMessage();
    if (m?.type === "error") continue;
    out[ch.id.slice(5)] = {
      unread: ch.countUnread(),
      lastMessage: m
        ? {
            body: m.messageKind === "gift" ? `${m.user?.name || "Someone"} ${m.text}` : m.text || "",
            createdAt: m.created_at,
          }
        : null,
    };
  }
  return out;
}

const LIVE_EVENTS = new Set(["message.new", "message.read", "notification.mark_read"]);
const REQUERY_EVENTS = new Set(["notification.message_new", "notification.added_to_channel"]);

function useStreamChannelSummaries() {
  const { client } = useStreamChatClient();
  const [summaries, setSummaries] = useState({});

  useEffect(() => {
    if (!client) return;
    let alive = true;
    const query = () =>
      client
        .queryChannels(
          { type: "messaging", members: { $in: [client.userID] } },
          [{ last_message_at: -1 }],
          { limit: 30, watch: true, state: true }
        )
        .then(() => alive && setSummaries(summarizeChannels(client)))
        .catch(() => {});
    query();
    const sub = client.on((event) => {
      if (!alive) return;
      if (REQUERY_EVENTS.has(event.type)) query();
      else if (LIVE_EVENTS.has(event.type)) setSummaries(summarizeChannels(client));
    });
    return () => {
      alive = false;
      sub.unsubscribe();
    };
  }, [client]);

  return summaries;
}

export default function Chats() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const nav = useNavigate();
  const summaries = useStreamChannelSummaries();

  async function load() {
    const { conversations } = await api("/conversations");
    setItems(conversations);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  // Cupid stays pinned on top; everything else by most recent message.
  const rows = useMemo(() => {
    const merged = items.map((c) => {
      const s = c.type !== "ai" && summaries[String(c.id)];
      return s ? { ...c, lastMessage: s.lastMessage || c.lastMessage, unread: s.unread } : c;
    });
    const at = (c) => (c.lastMessage?.createdAt ? new Date(c.lastMessage.createdAt).getTime() : 0);
    return merged.sort((a, b) => (a.type === "ai" ? -1 : b.type === "ai" ? 1 : at(b) - at(a)));
  }, [items, summaries]);

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
          {rows.map((c) => (
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
                  <div className={"chat-preview" + (c.unread ? " unread" : " muted")}>{preview(c)}</div>
                </div>
                {c.unread > 0 && <span className="unread-count">{c.unread > 99 ? "99+" : c.unread}</span>}
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
