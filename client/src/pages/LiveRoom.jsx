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
        <span className={`live-badge big ${isLive ? "" : "backstage"}`}>● {isLive ? "LIVE" : "BACKSTAGE"}</span>
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

// One live broadcast, laid out like StreamHub: a header with live time and
// viewers, the video as a rounded card over a blurred backdrop, and a side
// panel with Chat and People tabs. The host and co-hosts publish (backstage
// first, then "Start broadcast"); everyone else watches via LivestreamPlayer.
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
  const [tab, setTab] = useState("chat");
  const room = useLiveChannel(chat.client, stream?.chatChannel);
  const now = useNow(1000);

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
        <header className="live-header">
          <button className="back" onClick={() => nav("/live")}>←</button>
          <div className="live-head-text"><div className="live-title">Live</div></div>
        </header>
        <div className="empty-state"><div className="big">📡</div><p>{error}</p></div>
      </div>
    );
  }
  if (!stream || video.loading) {
    return <div className="live-view"><div className="screen center"><div className="pulse">📡</div></div></div>;
  }

  const onStage = stream.isHost || stream.isCohost;
  const ended = stream.status === "ended";
  const viewers = room.watcherCount ?? stream.viewers ?? 0;
  const stage = [stream.host, ...stream.cohosts];
  const endedAt = stream.endedAt ? Date.parse(String(stream.endedAt).replace(" ", "T") + "Z") : now;

  return (
    <div className="live-view">
      <header className="live-header">
        <button className="back" onClick={() => nav("/live")} title="Back">←</button>
        <div className="live-head-text">
          <div className="live-title">{stream.title}</div>
          <div className="live-meta">
            {ended ? <span>Ended</span> : <span className="live-on">● LIVE</span>}
            <span>⏱ {clock(stream.startedAt, ended ? endedAt : now)}</span>
            <span>👁 {viewers}</span>
            <span className="tag violet">{stream.category}</span>
          </div>
        </div>
        <button className="icon-btn" onClick={() => setShowShare(true)} title="Share">⤴</button>
      </header>

      <div className="live-body">
        <div className="live-stage" style={{ "--thumb": stream.host.avatarColor }}>
          <div className="live-backdrop" style={stream.host.photoUrl ? { backgroundImage: `url(${stream.host.photoUrl})` } : undefined} />
          {ended ? (
            <div className="empty-state"><div className="big">🌙</div><p>This stream has ended.</p></div>
          ) : video.error ? (
            <div className="video-card offline">
              <span className="live-badge big">● LIVE</span>
              <div className="empty-state"><div className="big">🎥</div><p>{video.error}</p></div>
              <span className="host-tag">
                <Avatar user={stream.host} size="xs" /> {stream.host.displayName} <span className="crown">♛</span>
              </span>
            </div>
          ) : (
            <div className="video-card">
              <StreamVideo client={video.client}>
                <StreamTheme className="call-theme">
                  {onStage ? (
                    <Stage key={`stage-${stream.isHost}`} client={video.client} stream={stream} onChanged={load} />
                  ) : (
                    <>
                      <LivestreamPlayer
                        key="viewer"
                        callType={stream.callType}
                        callId={stream.callId}
                        joinBehavior="live"
                        layoutProps={{ showLiveBadge: false, showParticipantCount: false, showDuration: false, showSpeakerName: false }}
                      />
                      <span className="live-badge big">● LIVE</span>
                    </>
                  )}
                </StreamTheme>
              </StreamVideo>
              <span className="host-tag">
                <Avatar user={stream.host} size="xs" /> {stream.host.displayName} <span className="crown">♛</span>
              </span>
            </div>
          )}
        </div>

        <aside className="live-side">
          <div className="side-tabs">
            <button className={`side-tab ${tab === "chat" ? "on" : ""}`} onClick={() => setTab("chat")}>💬 Chat</button>
            <button className={`side-tab ${tab === "people" ? "on" : ""}`} onClick={() => setTab("people")}>
              👥 {stage.length + room.watchers.filter((w) => !stage.some((u) => String(u.id) === w.id)).length}
            </button>
          </div>
          {tab === "chat" ? (
            <LiveChat room={room} chatError={chat.error} frozen={ended} me={user} onGift={() => setShowGifts(true)} />
          ) : (
            <People stage={stream} watchers={room.watchers} />
          )}
        </aside>
      </div>

      {showGifts && !ended && (
        <LiveGifts stream={stream} me={user} onClose={() => setShowGifts(false)} />
      )}
      {showShare && <ShareSheet stream={stream} onClose={() => setShowShare(false)} />}
    </div>
  );
}

function useNow(ms) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function clock(startedAt, now) {
  const t = Date.parse(String(startedAt).replace(" ", "T") + "Z");
  const secs = Math.max(0, Math.floor((now - t) / 1000));
  const h = Math.floor(secs / 3600);
  const mm = String(Math.floor((secs % 3600) / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// Watches the stream's chat channel: messages, who's watching, and send().
function useLiveChannel(chatClient, ch) {
  const [messages, setMessages] = useState([]);
  const [watchers, setWatchers] = useState([]);
  const [watcherCount, setWatcherCount] = useState(null);
  const channelRef = useRef(null);
  const type = ch?.type;
  const cid = ch?.id;

  useEffect(() => {
    if (!chatClient || !type) return;
    const channel = chatClient.channel(type, cid);
    channelRef.current = channel;
    const sync = () => {
      setMessages([...channel.state.messages].slice(-150));
      setWatchers(Object.values(channel.state.watchers || {}).map((u) => ({ id: String(u.id), name: u.name, ...userLook(u) })));
      setWatcherCount(channel.state.watcher_count ?? null);
    };
    const events = ["message.new", "user.watching.start", "user.watching.stop"];
    events.forEach((e) => channel.on(e, sync));
    channel.watch({ watchers: { limit: 100 } }).then(sync).catch(() => {});
    return () => {
      events.forEach((e) => channel.off(e, sync));
      channel.stopWatching().catch(() => {});
      channelRef.current = null;
    };
  }, [chatClient, type, cid]);

  const send = useCallback(async (text) => {
    if (!channelRef.current) throw new Error("Chat isn't connected yet.");
    await channelRef.current.sendMessage({ text });
  }, []);

  return { ready: !!chatClient, messages, watchers, watcherCount, send };
}

// Users upserted from the server carry { custom: { emoji, color } }.
function userLook(u) {
  return { emoji: u?.custom?.emoji || u?.emoji || "🙂", color: u?.custom?.color || u?.color || "#8b5cf6" };
}

const NAME_COLORS = ["#60a5fa", "#a78bfa", "#f472b6", "#34d399", "#fbbf24", "#22d3ee"];
function nameColor(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return NAME_COLORS[h % NAME_COLORS.length];
}

function People({ stage, watchers }) {
  const onStage = [stage.host, ...stage.cohosts];
  const stageIds = new Set(onStage.map((u) => String(u.id)));
  const audience = watchers.filter((w) => !stageIds.has(w.id));
  return (
    <div className="people-list">
      <div className="people-head muted small">On stage</div>
      {onStage.map((u, i) => (
        <div key={u.id} className="person">
          <Avatar user={u} size="sm" />
          <span>{u.displayName}</span>
          <span className="muted small">{i === 0 ? "♛ Host" : "Co-host"}</span>
        </div>
      ))}
      <div className="people-head muted small">Watching ({audience.length})</div>
      {audience.length === 0 && <p className="muted small">No one else yet.</p>}
      {audience.map((w) => (
        <div key={w.id} className="person">
          <span className="avatar sm" style={{ background: w.color }}>{w.emoji}</span>
          <span>{w.name || "Viewer"}</span>
        </div>
      ))}
    </div>
  );
}

function LiveChat({ room, chatError, frozen, me, onGift }) {
  const [text, setText] = useState("");
  const listRef = useRef(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [room.messages]);

  async function send(e) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setText("");
    try {
      await room.send(body);
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div className="live-chat">
      <div className="live-chat-list" ref={listRef}>
        {chatError && <p className="muted small">Chat is offline: {chatError}</p>}
        {room.messages.length === 0 && !chatError && <p className="muted small">Say hi 👋</p>}
        {room.messages.map((m) => {
          if (m.messageKind === "system" || m.messageKind === "gift") {
            return <div key={m.id} className="live-msg system">{m.text}</div>;
          }
          const look = userLook(m.user);
          const mine = String(m.user?.id) === String(me.id);
          return (
            <div key={m.id} className="live-msg">
              <span className="avatar sm" style={{ background: look.color }}>{look.emoji}</span>
              <div className="live-msg-body">
                <div>
                  <b style={{ color: mine ? "#fbbf24" : nameColor(m.user?.id) }}>{m.user?.name || "Someone"}</b>
                  <span className="msg-time">
                    {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <div className="msg-text">{m.text}</div>
              </div>
            </div>
          );
        })}
      </div>
      {!frozen && (
        <form className="live-chat-form" onSubmit={send}>
          <button type="button" className="gift-btn" onClick={onGift} title="Send a gift">🎁</button>
          <input
            placeholder={room.ready ? "Say something nice…" : "Chat is connecting…"}
            value={text}
            maxLength={300}
            disabled={!room.ready}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" className="primary small-btn" disabled={!text.trim() || !room.ready}>Send</button>
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

export function ShareSheet({ stream, onClose }) {
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
