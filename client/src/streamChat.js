import { useEffect, useRef, useState } from "react";
import { StreamChat } from "stream-chat";
import { api } from "./api.js";

// Builds (and reuses) a Stream Chat client for the current session. Mirrors
// useStreamVideoClient in stream.js — same credentials endpoint, same
// "error is a friendly string" contract so callers can fall back to the
// local polling chat instead of crashing when Stream isn't configured.
export function useStreamChatClient() {
  const [state, setState] = useState({ client: null, error: "", loading: true });
  const clientRef = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const creds = await api("/stream/credentials");
        if (!alive) return;
        const client = StreamChat.getInstance(creds.apiKey);
        await client.connectUser(
          { id: String(creds.userId) },
          creds.chatToken
        );
        if (!alive) {
          client.disconnectUser().catch(() => {});
          return;
        }
        clientRef.current = client;
        setState({ client, error: "", loading: false });
      } catch (err) {
        if (alive) setState({ client: null, error: err.message, loading: false });
      }
    })();
    return () => {
      alive = false;
      clientRef.current?.disconnectUser().catch(() => {});
      clientRef.current = null;
    };
  }, []);

  return state;
}
