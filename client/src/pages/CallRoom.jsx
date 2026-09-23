import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  StreamVideo,
  StreamCall,
  StreamTheme,
  SpeakerLayout,
  PaginatedGridLayout,
  CallingState,
  useCallStateHooks,
  useCall,
  hasAudio,
  hasVideo,
  Restricted,
  OwnCapability,
  SpeakingWhileMutedNotification,
  ToggleAudioPublishingButton,
  ToggleVideoPublishingButton,
  ReactionsButton,
  ScreenShareButton,
  CancelCallButton,
} from "@stream-io/video-react-sdk";
import "@stream-io/video-react-sdk/dist/css/styles.css";
import { useStreamVideoClient } from "../stream.js";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import MatrixRain from "../components/MatrixRain.jsx";

// Stream's default CallControls minus the record button — nobody should be
// able to record other people's cams on a dating app.
function RoomControls() {
  return (
    <div className="str-video__call-controls">
      <Restricted requiredGrants={[OwnCapability.SEND_AUDIO]}>
        <SpeakingWhileMutedNotification>
          <ToggleAudioPublishingButton />
        </SpeakingWhileMutedNotification>
      </Restricted>
      <Restricted requiredGrants={[OwnCapability.SEND_VIDEO]}>
        <ToggleVideoPublishingButton />
      </Restricted>
      <Restricted requiredGrants={[OwnCapability.CREATE_REACTION]}>
        <ReactionsButton />
      </Restricted>
      <Restricted requiredGrants={[OwnCapability.SCREENSHARE]}>
        <ScreenShareButton />
      </Restricted>
      <CancelCallButton />
    </div>
  );
}

export default function CallRoom() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const { client, error: clientError, loading: clientLoading } = useStreamVideoClient();
  const [call, setCall] = useState(null);
  const [title, setTitle] = useState("Room");
  const [isRoom, setIsRoom] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api(`/conversations/${id}`)
      .then(({ conversation }) => {
        setTitle(conversation.title);
        setIsRoom(conversation.type === "room");
        setIsHost(conversation.type === "room" && conversation.createdById === user.id);
      })
      .catch(() => {});
  }, [id, user.id]);

  useEffect(() => {
    if (!client) return;
    let alive = true;
    let theCall = null;
    (async () => {
      try {
        const { callType, callId } = await api(`/conversations/${id}/call`, {
          method: "POST",
        });
        if (!alive) return;
        theCall = client.call(callType, callId);
        await theCall.join({ create: true });
        if (!alive) {
          theCall.leave().catch(() => {});
          return;
        }
        setCall(theCall);
      } catch (err) {
        if (alive) setError(err.message);
      }
    })();
    return () => {
      alive = false;
      theCall?.leave().catch(() => {});
      setCall(null);
    };
  }, [client, id]);

  if (clientError || error) {
    return (
      <div className="call-view">
        <MatrixRain />
        <header className="chat-header">
          <button className="back" onClick={() => nav(`/chats/${id}`)}>
            ‹
          </button>
          <div className="chat-head-meta">
            <div className="chat-title">Video</div>
          </div>
        </header>
        <div className="empty-state">
          <div className="big">🎥</div>
          <p>{clientError || error}</p>
        </div>
      </div>
    );
  }

  if (clientLoading || !call) {
    return (
      <div className="call-view">
        <MatrixRain />
        <div className="screen center">
          <div className="pulse">🎥</div>
        </div>
      </div>
    );
  }

  return (
    <div className="call-view">
      <MatrixRain />
      <StreamVideo client={client}>
        <StreamCall call={call}>
          {/* Stream's component styles are scoped under .str-video, which
              StreamTheme provides — without it CallControls render unstyled. */}
          <StreamTheme className="call-theme">
            <RoomUI
              title={title}
              grid={isRoom}
              hostRoomId={isHost ? id : null}
              onLeave={() => nav(`/chats/${id}`)}
            />
          </StreamTheme>
        </StreamCall>
      </StreamVideo>
    </div>
  );
}

// Public rooms show every cam at once in a grid; DMs and groups keep the
// speaker layout (one big active speaker, others in a strip).
function RoomUI({ title, grid, hostRoomId, onLeave }) {
  const { useCallCallingState, useParticipantCount } = useCallStateHooks();
  const callingState = useCallCallingState();
  const count = useParticipantCount();
  const [showPeople, setShowPeople] = useState(false);
  const call = useCall();

  useEffect(() => {
    if (callingState === CallingState.LEFT) onLeave();
  }, [callingState, onLeave]);

  // Host removals for accounts Stream can't kick directly arrive as a custom
  // event (see ejectFromCall in server/stream.js) — leave when it's for us.
  useEffect(() => {
    if (!call) return;
    return call.on("custom", (event) => {
      if (event.custom?.type === "cupid.eject" && event.custom.target === call.currentUserId) {
        call.leave().catch(() => {});
      }
    });
  }, [call]);

  if (callingState !== CallingState.JOINED) {
    return (
      <div className="screen center">
        <div className="pulse">🎥</div>
      </div>
    );
  }

  return (
    <>
      <header className="chat-header">
        <button className="back" onClick={onLeave}>
          ‹
        </button>
        <div className="chat-head-meta">
          <div className="chat-title">{title}</div>
          <div className="muted sm">
            {count} {count === 1 ? "person" : "people"} in the room
          </div>
        </div>
        {hostRoomId && (
          <button className="ghost sm-btn host-btn" onClick={() => setShowPeople((v) => !v)}>
            👑 People
          </button>
        )}
      </header>
      <div className="room-stage">
        {grid ? <PaginatedGridLayout /> : <SpeakerLayout participantsBarPosition="bottom" />}
      </div>
      {hostRoomId && showPeople && <HostPanel roomId={hostRoomId} onClose={() => setShowPeople(false)} />}
      <div className="room-controls">
        <RoomControls />
      </div>
    </>
  );
}

// Host-only list of everyone else on the call, with moderation actions.
// The server re-checks that the caller is the room's host.
function HostPanel({ roomId, onClose }) {
  const { useRemoteParticipants } = useCallStateHooks();
  const people = useRemoteParticipants();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function act(p, action) {
    if (action === "ban" && !confirm(`Ban ${p.name || "this person"} from the room? They won't be able to rejoin.`)) {
      return;
    }
    setBusy(`${p.sessionId}:${action}`);
    setError("");
    try {
      await api(`/rooms/${roomId}/moderate`, {
        method: "POST",
        body: { action, userId: Number(p.userId), sessionId: p.sessionId },
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="host-panel">
      <div className="host-panel-head">
        <strong>People on cam</strong>
        <button className="ghost sm-btn" onClick={onClose}>
          Done
        </button>
      </div>
      {error && <div className="error thin">{error}</div>}
      {people.length === 0 ? (
        <p className="muted sm">No one else is here yet.</p>
      ) : (
        <ul className="host-list">
          {people.map((p) => {
            const spotlit = !!p.pin && !p.pin.isLocalPin;
            const b = (action) => busy === `${p.sessionId}:${action}`;
            return (
              <li key={p.sessionId}>
                <span className="host-name">
                  {p.name || p.userId}
                  <span className="muted sm">
                    {hasAudio(p) ? " 🎙️" : " 🔇"}
                    {hasVideo(p) ? " 📷" : " 🚫📷"}
                  </span>
                </span>
                <span className="host-actions">
                  <button disabled={!hasAudio(p) || b("mute")} onClick={() => act(p, "mute")} title="Mute mic">
                    🔇
                  </button>
                  <button disabled={!hasVideo(p) || b("camOff")} onClick={() => act(p, "camOff")} title="Turn cam off">
                    🚫
                  </button>
                  <button
                    disabled={b("spotlight") || b("unspotlight")}
                    onClick={() => act(p, spotlit ? "unspotlight" : "spotlight")}
                    title={spotlit ? "Remove spotlight" : "Spotlight for everyone"}
                    className={spotlit ? "on" : ""}
                  >
                    ⭐
                  </button>
                  <button disabled={b("remove")} onClick={() => act(p, "remove")} title="Remove from call">
                    🚪
                  </button>
                  <button disabled={b("ban")} onClick={() => act(p, "ban")} title="Ban from room" className="danger">
                    ⛔
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
