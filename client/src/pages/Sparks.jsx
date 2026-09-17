import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";

export default function Sparks() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { user, setUser } = useAuth();
  const [data, setData] = useState(null);
  const [buyingKey, setBuyingKey] = useState("");
  const [error, setError] = useState("");
  const status = params.get("status");

  useEffect(() => {
    api("/billing/packs").then(setData);
    if (status === "success") {
      // the webhook may land a beat after redirect — poll /me briefly
      let tries = 0;
      const t = setInterval(async () => {
        tries += 1;
        const { user } = await api("/me");
        setUser(user);
        if (tries >= 5) clearInterval(t);
      }, 1200);
      return () => clearInterval(t);
    }
  }, [status, setUser]);

  async function buy(pack) {
    setBuyingKey(pack.key);
    setError("");
    try {
      const { url } = await api("/billing/checkout", { method: "POST", body: { packKey: pack.key } });
      window.location.href = url;
    } catch (err) {
      setError(err.message);
      setBuyingKey("");
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <button className="ghost" onClick={() => nav(-1)}>
          ‹ Back
        </button>
        <h2 style={{ margin: 0 }}>Buy sparks</h2>
      </header>

      <div className="card profile-preview" style={{ marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <div className="chat-title">Your balance</div>
          <div className="muted sm">Sparks buy gifts, room boosts, and Premium.</div>
        </div>
        <div className="sparks-pill" style={{ fontSize: 16 }}>
          ✨ {user.sparks}
        </div>
      </div>

      {status === "success" && <div className="ok" style={{ marginBottom: 12 }}>Payment received — sparks are on the way ✓</div>}
      {status === "cancelled" && <p className="muted sm">Checkout cancelled — no charge made.</p>}
      {error && <div className="error">{error}</div>}

      {!data ? (
        <p className="muted pad">Loading…</p>
      ) : !data.configured ? (
        <div className="empty-state">
          <div className="big">💳</div>
          <p>
            Payments aren't set up yet. Add <code>STRIPE_SECRET_KEY</code> to a <code>.env</code> file to turn this
            on.
          </p>
        </div>
      ) : (
        <div className="pack-list">
          {data.packs.map((p) => (
            <button key={p.key} className="pack-card" disabled={!!buyingKey} onClick={() => buy(p)}>
              <div>
                <div className="chat-title">{p.label}</div>
                <div className="muted sm">one-time purchase</div>
              </div>
              <div className="pack-price">
                {buyingKey === p.key ? "…" : `$${(p.price / 100).toFixed(2)}`}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
