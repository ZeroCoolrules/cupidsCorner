import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";

const when = (iso) =>
  iso ? new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) : "";

// A paid voice session with Cupid. The phone number and the one-time code
// only come back from the API after the member has paid.
export default function Coach() {
  const nav = useNavigate();
  const { user, setUser } = useAuth();
  const [data, setData] = useState(null);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => api("/coach").then(setData).catch((e) => setError(e.message)), []);
  useEffect(() => {
    load();
  }, [load]);

  async function pay() {
    setPaying(true);
    setError("");
    try {
      const r = await api("/coach/sessions", { method: "POST" });
      setUser({ ...user, sparks: r.sparks });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setPaying(false);
    }
  }

  const s = data?.session;
  const short = data && !s && data.sparks < data.cost;

  return (
    <div className="page">
      <header className="page-head">
        <button className="ghost" onClick={() => nav(-1)}>
          ‹ Back
        </button>
        <h2 style={{ margin: 0 }}>Talk to Cupid</h2>
      </header>

      {error && <div className="error">{error}</div>}

      {!data ? (
        <p className="muted pad">Loading…</p>
      ) : !data.available ? (
        <div className="empty-state">
          <div className="big">📞</div>
          <p>Voice sessions with Cupid are coming soon.</p>
        </div>
      ) : s ? (
        <div className="card" style={{ padding: 20, textAlign: "center" }}>
          <div className="big">📞</div>
          <div className="chat-title" style={{ marginTop: 8 }}>
            {s.status === "in_progress" ? "Your session is in progress" : "You're all set. Call Cupid now."}
          </div>
          <a className="primary" href={s.phoneHref} style={{ display: "inline-block", margin: "14px 0 6px", padding: "12px 22px", borderRadius: 12, textDecoration: "none" }}>
            Call {s.phone}
          </a>
          <p className="muted sm" style={{ margin: "10px 0 4px" }}>When Cupid asks, say or key in your code</p>
          <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: 8 }}>{s.code}</div>
          <p className="muted sm" style={{ marginTop: 12 }}>
            {s.status === "in_progress"
              ? `Your ${s.minutes} minutes run until ${when(s.endsAt)}. If the call drops, call back with the same code.`
              : `Good for one ${s.minutes}-minute session. Call by ${when(s.callBy)}. The clock starts when Cupid accepts your code.`}
          </p>
          <p className="muted sm">This code is yours alone. Please don't share it.</p>
        </div>
      ) : (
        <>
          <div className="card" style={{ padding: 20 }}>
            <div className="chat-title">A real conversation with your dating coach</div>
            <p className="muted" style={{ margin: "8px 0 0" }}>
              Call Cupid and talk it through out loud: what to say next, how to read a match, how to plan a first
              date, or how to get your confidence back.
            </p>
            <ul className="muted" style={{ margin: "12px 0 0", paddingLeft: 18 }}>
              <li>One private {data.minutes}-minute phone session</li>
              <li>Call any time in the next {data.codeHours} hours</li>
              <li>You get the number and a personal code as soon as you pay</li>
            </ul>
          </div>

          <div className="card profile-preview" style={{ margin: "12px 0" }}>
            <div style={{ flex: 1 }}>
              <div className="chat-title">One session</div>
              <div className="muted sm">You have ✨ {data.sparks}</div>
            </div>
            <div className="sparks-pill" style={{ fontSize: 16 }}>
              ✨ {data.cost}
            </div>
          </div>

          {short ? (
            <Link to="/sparks" className="primary" style={{ display: "block", textAlign: "center", textDecoration: "none" }}>
              Get {data.cost - data.sparks} more sparks
            </Link>
          ) : (
            <button className="primary" style={{ width: "100%" }} disabled={paying} onClick={pay}>
              {paying ? "Setting up…" : `Start a session for ✨ ${data.cost}`}
            </button>
          )}
        </>
      )}

      {data?.history?.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div className="muted sm" style={{ marginBottom: 6 }}>Past sessions</div>
          {data.history.map((h) => (
            <div key={h.id} className="card profile-preview" style={{ marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <div>{when(h.startedAt || h.paidAt)}</div>
                <div className="muted sm">{h.used ? `${h.minutes} minutes` : "Not used"}</div>
              </div>
              <div className="muted sm">✨ {h.sparksSpent}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
