import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  StreamVideo,
  StreamCall,
  SpeakerLayout,
  CallControls,
  CallingState,
  useCallStateHooks,
} from "@stream-io/video-react-sdk";
import "@stream-io/video-react-sdk/dist/css/styles.css";
import { useStreamVideoClient } from "../stream.js";
import { api } from "../api.js";

export default function CallRoom() {
  const { id } = useParams();
  const nav = useNavigate();
  const { client, error: clientError, loading: clientLoading } = useStreamVideoClient();
  const [call, setCall] = useState(null);
  const [title, setTitle] = useState("Room");
  const [error, setError] = useState("");

  useEffect(() => {
    api(`/conversations/${id}`)
      .then(({ conversation }) => setTitle(conversation.title))
      .catch(() => {});
  }, [id]);

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
        <div className="screen center">
          <div className="pulse">🎥</div>
        </div>
      </div>
    );
  }

  return (
    <div className="call-view">
      <StreamVideo client={client}>
        <StreamCall call={call}>
          <RoomUI title={title} onLeave={() => nav(`/chats/${id}`)} />
        </StreamCall>
      </StreamVideo>
    </div>
  );
}

function RoomUI({ title, onLeave }) {
  const { useCallCallingState, useParticipantCount } = useCallStateHooks();
  const callingState = useCallCallingState();
  const count = useParticipantCount();

  useEffect(() => {
    if (callingState === CallingState.LEFT) onLeave();
  }, [callingState, onLeave]);

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
      </header>
      <div className="room-stage">
        <SpeakerLayout participantsBarPosition="bottom" />
      </div>
      <div className="room-controls">
        <CallControls />
      </div>
    </>
  );
}
