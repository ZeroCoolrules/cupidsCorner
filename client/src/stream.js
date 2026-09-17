import { useEffect, useRef, useState } from "react";
import { StreamVideoClient } from "@stream-io/video-react-sdk";
import { api } from "./api.js";

// Builds (and reuses) a StreamVideoClient for the current session. Returns
// { client, error, loading } — error is a friendly string when Stream isn't
// configured on the backend yet, so callers can show a helpful message
// instead of a crash.
export function useStreamVideoClient() {
  const [state, setState] = useState({ client: null, error: "", loading: true });
  const clientRef = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const creds = await api("/stream/credentials");
        if (!alive) return;
        const client = new StreamVideoClient({
          apiKey: creds.apiKey,
          user: { id: String(creds.userId) },
          token: creds.token,
        });
        clientRef.current = client;
        setState({ client, error: "", loading: false });
      } catch (err) {
        if (alive) setState({ client: null, error: err.message, loading: false });
      }
    })();
    return () => {
      alive = false;
      clientRef.current?.disconnectUser();
      clientRef.current = null;
    };
  }, []);

  return state;
}
