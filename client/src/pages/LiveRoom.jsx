import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  StreamVideo,
  StreamCall,
  StreamTheme,
  LivestreamPlayer,
  PaginatedGridLayout,
  useCallStateHooks,
  useCall,
  ToggleAudioPublishingButton,
  ToggleVideoPublishingButton,
  ScreenShareButton,
} from "@stream-io/video-react-sdk";
import "@stream-io/video-react-sdk/dist/css/styles.css";
import { useStreamVideoClient } from "../stream.js";
import { useStreamChatClient } from "../streamChat.js";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import Avatar from "../components/Avatar.jsx";

// One live broadcast. The host and co-hosts publish (backstage first, then
// "Start broadcast"); everyone else watches through LivestreamPlayer. Chat,
// gifts and share sit beside the video.
export default function LiveRoom() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const video = useStreamVideoClient();
  const chat = useStreamChatClient();
  const [stream, setStream] = useState(null);
  const [error, setError] = useState("");
  const [showGifts, setShowGifts] = useState(false);
  const [showShare, setShowShare] = useState(false);

  const load = useCallback(async () => {
    const { stream } = await api(`/live/${id}`);
    setStream(stream);
    return stream;
  }, [id]);

  // Poll so a viewer who gets invited to co-host switches to the stage, and
  // everyone notices when the host ends the stream.
  useEffect(() => {
    load().catch((e) => setError(e.message));
    const t = setInterval(() => load().catch(() => {}), 8000);
    return () => clearInterval(t);
  }, [load]);

  if (error) {
    return (
      <div className="live-view">
        <LiveHeader title="Live" onBack={() => nav("/live")} />
        <div className="empty-state"><div className="big">📡</div><p>{error}</p></div>
      </div>
    );
  }
  if (!stream || video.loading) {
    return <div className="live-view"><div className="screen center"><div className="pulse">📡</div></div></div>;
  }

  const onStage = stream.isHost || stream.isCohost;
  const ended = stream.status === "ended";

  return (
    <div className="live-view">
      <LiveHeader
        title={stream.title}
        sub={`${stream.host.displayName}${stream.cohosts.length ? ` + ${stream.cohosts.length} co-host${stream.cohosts.length > 1 ? "s" : ""}` : ""}`}
        onBack={() => nav("/live")}
        onShare={() => setShowShare(true)}
      />

      <div className="live-stage">
        {ended ? (
          <div className="empty-state"><div className="big">🌙</div><p>This stream has ended.</p></div>
        ) : video.error ? (
          <div className="empty-state"><div className="big">🎥</div><p>{video.error}</p></div>
        ) : (
          <StreamVideo client={video.client}>
            <StreamTheme className="call-theme">
              {onStage ? (
                <Stage key={`stage-${stream.isHost}`} client={video.client} stream={stream} onChanged={load} />
              ) : (
                <LivestreamPlayer
                  key="viewer"
                  callType={stream.callType}
                  callId={stream.callId}
                  joinBehavior="live"
                />
              )}
            </StreamTheme>
          </StreamVideo>
        )}
      </div>

      <LiveChat
        chatClient={chat.client}
        chatError={chat.error}
        channel={stream.chatChannel}
        frozen={ended}
        me={user}
        onGift={() => setShowGifts(true)}
      />

      {showGifts && !ended && (
        <LiveGifts stream={stream} me={user} onClose={() => setShowGifts(false)} />
      )}
      {showShare && <ShareSheet stream={stream} onClose={() => setShowShare(false)} />}
    </div>
  );
}

function LiveHeader({ title, sub, onBack, onShare }) {
  return (
    <header className="chat-header live-header">
      <button className="back" onClick={onBack}>‹</button>
      <div className="chat-head-meta">
        <div className="chat-title"><span className="live-dot" /> {title}</div>
        {sub && <div className="muted small">{sub}</div>}
      </div>
      {onShare && <button className="ghost small-btn" onClick={onShare}>Share</button>}
    </header>
  );
}

// Host / co-host side: join the livestream call with camera and mic on.
function Stage({ client, stream, onChanged }) {
  const [call, setCall] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!client) return;
    let alive = true;
    const c = client.call(stream.callType, stream.callId);
    (async () => {
      try {
        await c.join();
        await c.camera.enable().catch(() => {});
        await c.microphone.enable().catch(() => {});
        if (alive) setCall(c);
        else c.leave().catch(() => {});
      } catch (err) {
        if (alive) setError(err.message);
      }
    })();
    return () => {
      alive = false;
      c.leave().catch(() => {});
    };
  }, [client, stream.callType, stream.callId]);

  if (error) return <div className="empty-state"><p>{error}</p></div>;
  if (!call) return <div className="screen center"><div className="pulse">🎥</div></div>;
  return (
    <StreamCall call={call}>
      <StageInner stream={stream} onChanged={onChanged} />
    </StreamCall>
  );
}

function StageInner({ stream, onChanged }) {
  const call = useCall();
  const nav = useNavigate();
  const { useIsCallLive, useParticipants } = useCallStateHooks();
  const isLive = useIsCallLive();
  const participants = useParticipants();
  const [busy, setBusy] = useState(false);
  const [showInvite, setShowInvite] = useState(false);

  const stageIds = new Set([stream.host.id, ...stream.cohosts.map((c) => c.id)].map(String));
  const audience = [];
  const seen = new Set();
  for (const p of participants) {
    if (stageIds.has(p.userId) || seen.has(p.userId)) continue;
    seen.add(p.userId);
    audience.push(p);
  }

  async function run(fn) {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stage">
      <div className="stage-video">
        <PaginatedGridLayout />
        <span className={`live-badge ${isLive ? "" : "backstage"}`}>{isLive ? "LIVE" : "BACKSTAGE"}</span>
        <span className="live-viewers">👁 {audience.length}</span>
      </div>
      <div className="str-video__call-controls stage-controls">
        <ToggleAudioPublishingButton />
        <ToggleVideoPublishingButton />
        <ScreenShareButton />
        {stream.isHost && (
          <>
            {isLive ? (
              <button className="ghost" disabled={busy} onClick={() => run(() => call.stopLive())}>Pause</button>
            ) : (
              <button className="go-live-btn" disabled={busy} onClick={() => run(() => call.goLive())}>
                ● Start broadcast
              </button>
            )}
            <button className="ghost" onClick={() => setShowInvite(true)}>Co-hosts</button>
            <button
              className="danger"
              disabled={busy}
              onClick={() =>
                confirm("End the stream for everyone?") &&
                run(async () => {
                  await api(`/live/${stream.id}/end`, { method: "POST" });
                  await onChanged();
                })
              }
            >
              End
            </button>
          </>
        )}
        {stream.isCohost && (
          <button
            className="ghost"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const meId = call.currentUserId;
                await api(`/live/${stream.id}/cohosts/${meId}`, { method: "DELETE" });
                await onChanged();
                nav(`/live/${stream.id}`);
              })
            }
          >
            Leave stage
          </button>
        )}
      </div>

      {showInvite && (
        <div className="modal-backdrop" onClick={() => setShowInvite(false)}>
          <div className="card sheet" onClick={(e) => e.stopPropagation()}>
            <h3>Co-hosts</h3>
            {stream.cohosts.length > 0 && (
              <ul className="plain-list">
                {stream.cohosts.map((c) => (
                  <li key={c.id}>
                    <Avatar user={c} size="sm" /> {c.displayName}
                    <button
                      className="ghost small-btn"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await api(`/live/${stream.id}/cohosts/${c.id}`, { method: "DELETE" });
                          await onChanged();
                        })
                      }
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="muted small">Invite someone who's watching to join you on camera (up to 3).</p>
            {audience.length === 0 ? (
              <p className="muted small">No viewers yet.</p>
            ) : (
              <ul className="plain-list">
                {audience.map((p) => (
                  <li key={p.userId}>
                    <span className="avatar sm" style={{ background: p.custom?.color || "#7d5fff" }}>
                      {p.custom?.emoji || "🙂"}
                    </span>{" "}
                    {p.name || `User ${p.userId}`}
                    <button
                      className="primary small-btn"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await api(`/live/${stream.id}/cohosts`, { method: "POST", body: { userId: Number(p.userId) } });
                          await onChanged();
                        })
                      }
                    >
                      Invite
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button className="ghost" onClick={() => setShowInvite(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

function LiveChat({ chatClient, chatError, channel: ch, frozen, me, onGift }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const channelRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (!chatClient) return;
    const channel = chatClient.channel(ch.type, ch.id);
    channelRef.current = channel;
    const sync = () => setMessages([...channel.state.messages].slice(-100));
    channel.on("message.new", sync);
    channel.watch().then(sync).catch(() => {});
    return () => {
      channel.off("message.new", sync);
      channel.stopWatching().catch(() => {});
      channelRef.current = null;
    };
  }, [chatClient, ch.type, ch.id]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  async function send(e) {
    e.preventDefault();
    const body = text.trim();
    if (!body || !channelRef.current) return;
    setText("");
    try {
      await channelRef.current.sendMessage({ text: body });
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div className="live-chat">
      <div className="live-chat-list" ref={listRef}>
        {chatError && <p className="muted small">Chat is offline: {chatError}</p>}
        {messages.map((m) => (
          <div key={m.id} className={`live-msg ${m.messageKind === "system" || m.messageKind === "gift" ? "system" : ""}`}>
            {m.messageKind === "system" || m.messageKind === "gift" ? (
              <span>{m.text}</span>
            ) : (
              <>
                <b className={String(m.user?.id) === String(me.id) ? "me" : ""}>{m.user?.name || "Someone"}</b>{" "}
                <span>{m.text}</span>
              </>
            )}
          </div>
        ))}
      </div>
      {!frozen && (
        <form className="live-chat-form" onSubmit={send}>
          <button type="button" className="gift-btn" onClick={onGift} title="Send a gift">🎁</button>
          <input
            placeholder={chatClient ? "Say something nice…" : "Chat is connecting…"}
            value={text}
            maxLength={300}
            disabled={!chatClient}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" className="primary small-btn" disabled={!text.trim() || !chatClient}>Send</button>
        </form>
      )}
    </div>
  );
}

function LiveGifts({ stream, me, onClose }) {
  const [catalog, setCatalog] = useState([]);
  const [sparks, setSparks] = useState(null);
  const stage = [stream.host, ...stream.cohosts].filter((u) => u.id !== me.id);
  const [recipientId, setRecipientId] = useState(stage[0]?.id);
  const [sending, setSending] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api("/gifts/catalog").then((d) => {
      setCatalog(d.catalog);
      setSparks(d.sparks);
    });
  }, []);

  async function send(gift) {
    setSending(gift.key);
    setError("");
    try {
      const res = await api(`/live/${stream.id}/gift`, { method: "POST", body: { giftKey: gift.key, recipientId } });
      setSparks(res.sparks);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending("");
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card sheet gift-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="gift-sheet-head">
          <h3>Send a gift</h3>
          <span className="sparks-pill">✨ {sparks ?? "…"}</span>
        </div>
        {stage.length === 0 ? (
          <p className="muted small">You're the only one on stage.</p>
        ) : (
          <>
            {stage.length > 1 && (
              <div className="pill-row">
                {stage.map((u) => (
                  <button
                    key={u.id}
                    className={`pill-btn ${u.id === recipientId ? "on" : ""}`}
                    onClick={() => setRecipientId(u.id)}
                  >
                    {u.displayName}
                  </button>
                ))}
              </div>
            )}
            <div className="gift-grid">
              {catalog.map((g) => (
                <button key={g.key} className="gift-tile" disabled={!!sending} onClick={() => send(g)}>
                  <span className="gift-tile-emoji">{g.emoji}</span>
                  <span className="gift-tile-name">{g.name}</span>
                  <span className="gift-tile-cost">✨ {g.cost}</span>
                </button>
              ))}
            </div>
          </>
        )}
        {error && <p className="error">{error}</p>}
        <button className="ghost" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

function ShareSheet({ stream, onClose }) {
  const url = `${window.location.origin}/live/${stream.id}`;
  const text = `${stream.host.displayName} is live on Cupid's Corner: ${stream.title}`;
  const enc = encodeURIComponent;
  const [copied, setCopied] = useState(false);

  async function nativeShare() {
    try {
      await navigator.share({ title: stream.title, text, url });
    } catch {
      /* cancelled */
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card sheet share-sheet" onClick={(e) => e.stopPropagation()}>
        <h3>Share this stream</h3>
        <div className="share-grid">
          {typeof navigator.share === "function" && <button className="primary" onClick={nativeShare}>📲 Share…</button>}
          <a className="share-link" target="_blank" rel="noreferrer" href={`https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}`}>𝕏 Post</a>
          <a className="share-link" target="_blank" rel="noreferrer" href={`https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`}>f Facebook</a>
          <a className="share-link" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${enc(`${text} ${url}`)}`}>🟢 WhatsApp</a>
          <a className="share-link" target="_blank" rel="noreferrer" href={`https://t.me/share/url?url=${enc(url)}&text=${enc(text)}`}>✈️ Telegram</a>
          <button
            className="ghost"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setCopied(true);
              } catch {
                prompt("Copy this link", url);
              }
            }}
          >
            {copied ? "✓ Copied" : "🔗 Copy link"}
          </button>
        </div>
        <button className="ghost" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
