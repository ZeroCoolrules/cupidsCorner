import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { useStreamChatClient } from "../streamChat.js";
import GiftTray from "../components/GiftTray.jsx";

export const REACTION_EMOJIS = ["❤️", "😂", "👍", "😮", "😢"];

function reactionsFromStreamMessage(m) {
  const counts = m.reaction_counts || {};
  const mine = new Set((m.own_reactions || []).map((r) => r.type));
  return Object.entries(counts).map(([emoji, count]) => ({ emoji, count, mine: mine.has(emoji) }));
}

function fromStreamMessage(m, myId) {
  const senderId = m.user?.id;
  const kind = m.messageKind || (senderId === "cupids-corner-system" ? "system" : "text");
  return {
    id: m.id,
    senderId,
    senderName: m.user?.name || "",
    senderEmoji: m.user?.custom?.emoji || "🙂",
    senderColor: m.user?.custom?.color || "#bbb",
    kind,
    body: m.text,
    gift: m.gift || null,
    createdAt: m.created_at,
    mine: senderId === String(myId),
    reactions: reactionsFromStreamMessage(m),
  };
}

function readsFromChannelState(channel) {
  const next = {};
  for (const uid of Object.keys(channel.state.read || {})) {
    next[uid] = channel.state.read[uid]?.last_read_message_id;
  }
  return next;
}

export default function Chat() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [conv, setConv] = useState(null);
  const [convError, setConvError] = useState(false);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [showGifts, setShowGifts] = useState(false);
  const [typingUsers, setTypingUsers] = useState([]);
  const [reads, setReads] = useState({});
  const [reactingOn, setReactingOn] = useState(null);
  const bottom = useRef(null);
  const lastId = useRef(0);
  const channelRef = useRef(null);
  const typingPingRef = useRef(0);

  const streamChat = useStreamChatClient();

  // 1. conversation metadata (type, title, members) first — decides transport
  useEffect(() => {
    let alive = true;
    setConv(null);
    setConvError(false);
    api(`/conversations/${id}`)
      .then(({ conversation }) => alive && setConv(conversation))
      .catch(() => alive && setConvError(true));
    return () => {
      alive = false;
    };
  }, [id]);

  const isAI = conv?.type === "ai";
  const isGroup = conv?.type === "group";
  const isRoom = conv?.type === "room";
  const isDM = conv?.type === "dm";
  const useStream = !isAI && !!conv && !!streamChat.client && !streamChat.error;
  const transportReady = !!conv && (isAI || streamChat.loading === false);

  const scrollDown = useCallback((smooth) => {
    bottom.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
  }, []);

  const appendUnique = useCallback((incoming) => {
    setMessages((m) => {
      const seen = new Set(m.map((x) => x.id));
      const added = incoming.filter((x) => !seen.has(x.id));
      return added.length ? [...m, ...added] : m;
    });
  }, []);

  // --- Stream Chat transport -------------------------------------------------
  useEffect(() => {
    if (!transportReady || !useStream) return;
    let alive = true;
    setMessages([]);
    setTypingUsers([]);
    const channel = streamChat.client.channel("messaging", `conv-${id}`);
    channelRef.current = channel;

    const onNew = (event) => {
      if (!alive) return;
      appendUnique([fromStreamMessage(event.message, user.id)]);
      if (event.message.user?.id !== String(user.id)) channel.markRead().catch(() => {});
    };
    const onReaction = (event) => {
      if (!alive || !event.message) return;
      const updated = fromStreamMessage(event.message, user.id);
      setMessages((m) => m.map((x) => (x.id === updated.id ? { ...x, reactions: updated.reactions } : x)));
    };
    const onTypingStart = (event) => {
      if (!alive || event.user?.id === String(user.id)) return;
      const name = event.user?.name || "Someone";
      setTypingUsers((names) => (names.includes(name) ? names : [...names, name]));
    };
    const onTypingStop = (event) => {
      if (!alive) return;
      const name = event.user?.name || "Someone";
      setTypingUsers((names) => names.filter((n) => n !== name));
    };
    const onRead = () => {
      if (alive) setReads(readsFromChannelState(channel));
    };

    channel.on("message.new", onNew);
    channel.on("reaction.new", onReaction);
    channel.on("reaction.deleted", onReaction);
    channel.on("typing.start", onTypingStart);
    channel.on("typing.stop", onTypingStop);
    channel.on("message.read", onRead);

    channel
      .watch()
      .then(() => {
        if (!alive) return;
        setMessages(channel.state.messages.map((m) => fromStreamMessage(m, user.id)));
        setReads(readsFromChannelState(channel));
        channel.markRead().catch(() => {});
      })
      .catch((err) => alive && setError(err.message));

    return () => {
      alive = false;
      channel.off("message.new", onNew);
      channel.off("reaction.new", onReaction);
      channel.off("reaction.deleted", onReaction);
      channel.off("typing.start", onTypingStart);
      channel.off("typing.stop", onTypingStop);
      channel.off("message.read", onRead);
      channel.stopWatching().catch(() => {});
      channelRef.current = null;
    };
  }, [transportReady, useStream, id, streamChat.client, user.id, appendUnique]);

  // --- Legacy local polling transport (Cupid always, or Stream not configured)
  const poll = useCallback(async () => {
    try {
      const { messages: fresh, conversation, typing, reads: readRows } = await api(
        `/conversations/${id}/messages?after=${lastId.current}`
      );
      setConv(conversation);
      setTypingUsers(typing || []);
      if (readRows) {
        const next = {};
        for (const r of readRows) next[String(r.user_id)] = r.last_read_id;
        setReads(next);
      }
      if (fresh.length) {
        lastId.current = Math.max(lastId.current, ...fresh.map((x) => x.id));
        appendUnique(fresh);
      }
    } catch (err) {
      if (err.status === 403 || err.status === 401) nav("/chats");
    }
  }, [id, nav, appendUnique]);

  useEffect(() => {
    if (!transportReady || useStream) return;
    setMessages([]);
    lastId.current = 0;
    let alive = true;
    const tick = () => alive && poll();
    tick();
    const t = setInterval(tick, 2500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [transportReady, useStream, poll]);

  useEffect(() => {
    scrollDown(true);
  }, [messages.length, scrollDown]);

  function onInputChange(e) {
    setText(e.target.value);
    if (isAI) return;
    if (useStream) {
      channelRef.current?.keystroke();
      return;
    }
    const now = Date.now();
    if (now - typingPingRef.current > 2000) {
      typingPingRef.current = now;
      api(`/conversations/${id}/typing`, { method: "POST" }).catch(() => {});
    }
  }

  async function send(e) {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError("");
    setText("");
    try {
      if (useStream) {
        const res = await channelRef.current.sendMessage({ text: body });
        // Frozen channels (a block is in place) answer with an unsaved
        // `error`-type message instead of rejecting.
        if (res.message.type === "error") throw new Error("This chat is unavailable.");
        appendUnique([fromStreamMessage(res.message, user.id)]);
      } else {
        await api(`/conversations/${id}/messages`, { method: "POST", body: { body } });
        await poll();
      }
    } catch (err) {
      setError(err.message);
      setText(body);
    } finally {
      setSending(false);
    }
  }

  async function toggleReaction(message, emoji) {
    setReactingOn(null);
    if (useStream) {
      try {
        if (message.reactions?.find((r) => r.emoji === emoji && r.mine)) {
          await channelRef.current.deleteReaction(message.id, emoji);
        } else {
          await channelRef.current.sendReaction(message.id, { type: emoji });
        }
      } catch {
        /* ignore — UI stays in sync via the reaction.* events */
      }
    } else {
      try {
        const res = await api(`/conversations/${id}/messages/${message.id}/react`, {
          method: "POST",
          body: { emoji },
        });
        setMessages((m) => m.map((x) => (x.id === message.id ? { ...x, reactions: res.reactions } : x)));
      } catch {
        /* ignore */
      }
    }
  }

  const otherMembers = useMemo(
    () => (conv ? conv.members.filter((m) => m.id !== user.id) : []),
    [conv, user.id]
  );

  async function afterGiftSent() {
    setShowGifts(false);
    if (!useStream) await poll();
  }

  // "Seen" under my last message, DM only — best-effort, exact-match style
  // (matches once the other party has caught up to the latest message).
  const lastMessage = messages[messages.length - 1];
  const seenByOther =
    isDM &&
    lastMessage?.mine &&
    otherMembers[0] &&
    (() => {
      const otherRead = reads[String(otherMembers[0].id)];
      if (otherRead == null) return false;
      return useStream ? otherRead === lastMessage.id : Number(otherRead) >= Number(lastMessage.id);
    })();

  if (convError) {
    return (
      <div className="chat-view">
        <div className="empty-state">
          <div className="big">🤔</div>
          <p>Couldn't open that chat.</p>
          <button className="ghost" onClick={() => nav("/chats")}>
            Back to chats
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-view">
      <header className="chat-header">
        <button className="back" onClick={() => nav("/chats")}>
          ‹
        </button>
        <div className="avatar sm" style={{ background: conv?.color || "#ccc" }}>
          {conv?.emoji || "💬"}
        </div>
        <div className="chat-head-meta">
          <div className="chat-title">{conv?.title || "…"}</div>
          {(isGroup || isRoom) && (
            <div className="muted sm">
              {conv.members.map((m) => m.displayName).join(", ")}
            </div>
          )}
          {isAI && <div className="muted sm">Your AI matchmaker</div>}
          {typingUsers.length > 0 && (
            <div className="muted sm typing-line">{typingUsers.join(", ")} typing…</div>
          )}
        </div>
        {!isAI && conv && (
          <button className="video-btn" onClick={() => nav(`/chats/${id}/call`)} title="Start video">
            🎥
          </button>
        )}
      </header>

      <div className="messages">
        {messages.map((m) => {
          if (m.kind === "system") {
            return (
              <div key={m.id} className="system-msg">
                {m.body}
              </div>
            );
          }
          if (m.kind === "gift") {
            return (
              <div key={m.id} className="gift-msg">
                <span className="gift-emoji">{m.gift?.emoji || "🎁"}</span>
                {m.mine ? "You" : m.senderName} sent {m.gift?.name || "a gift"}
              </div>
            );
          }
          const mine = m.mine;
          return (
            <div key={m.id} className={"msg-line" + (mine ? " mine" : "")}>
              {!mine && (
                <span className="avatar xs" style={{ background: m.senderColor || "#bbb" }}>
                  {m.senderEmoji || "🙂"}
                </span>
              )}
              <div className="bubble-wrap">
                {!mine && (isGroup || isAI || isRoom) && <span className="sender">{m.senderName}</span>}
                <div
                  className={"bubble" + (m.kind === "ai" ? " ai" : "")}
                  onClick={() => !isAI && setReactingOn(reactingOn === m.id ? null : m.id)}
                >
                  {m.body}
                </div>
                {m.reactions?.length > 0 && (
                  <div className="reaction-row">
                    {m.reactions.map((r) => (
                      <button
                        key={r.emoji}
                        className={"reaction-pill" + (r.mine ? " mine" : "")}
                        onClick={() => toggleReaction(m, r.emoji)}
                      >
                        {r.emoji} {r.count}
                      </button>
                    ))}
                  </div>
                )}
                {reactingOn === m.id && (
                  <div className="reaction-picker">
                    {REACTION_EMOJIS.map((e) => (
                      <button key={e} onClick={() => toggleReaction(m, e)}>
                        {e}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {isAI && sending && (
          <div className="msg-line">
            <span className="avatar xs" style={{ background: "#3aa0e8" }}>
              💘
            </span>
            <div className="bubble ai typing">
              <i></i>
              <i></i>
              <i></i>
            </div>
          </div>
        )}
        {seenByOther && <div className="seen-line">Seen</div>}
        <div ref={bottom} />
      </div>

      {error && <div className="error thin">{error}</div>}

      <form className="composer" onSubmit={send}>
        {!isAI && otherMembers.length > 0 && (
          <button type="button" className="gift-btn" onClick={() => setShowGifts(true)} title="Send a gift">
            🎁
          </button>
        )}
        <input
          value={text}
          onChange={onInputChange}
          placeholder={isAI ? "Ask Cupid anything…" : "Message…"}
          autoFocus
        />
        <button className="send" disabled={sending || !text.trim()}>
          ➤
        </button>
      </form>

      {showGifts && (
        <GiftTray
          recipients={otherMembers}
          conversationId={Number(id)}
          onClose={() => setShowGifts(false)}
          onSent={afterGiftSent}
        />
      )}
    </div>
  );
}
