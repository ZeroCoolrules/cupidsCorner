import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function GiftTray({ recipients, conversationId, onClose, onSent }) {
  const [catalog, setCatalog] = useState([]);
  const [sparks, setSparks] = useState(null);
  const [recipientId, setRecipientId] = useState(recipients[0]?.id);
  const [sendingKey, setSendingKey] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api("/gifts/catalog").then((d) => {
      setCatalog(d.catalog);
      setSparks(d.sparks);
    });
  }, []);

  async function send(gift) {
    if (sendingKey || sparks == null) return;
    setSendingKey(gift.key);
    setError("");
    try {
      const res = await api("/gifts/send", {
        method: "POST",
        body: { recipientId, giftKey: gift.key, conversationId },
      });
      setSparks(res.sparks);
      onSent?.(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setSendingKey("");
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card sheet gift-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="gift-sheet-head">
          <h3>Send a gift</h3>
          <span className="sparks-pill">✨ {sparks ?? "…"}</span>
        </div>

        {recipients.length > 1 && (
          <label>
            To
            <select value={recipientId} onChange={(e) => setRecipientId(Number(e.target.value))}>
              {recipients.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
            </select>
          </label>
        )}

        {error && <div className="error">{error}</div>}

        <div className="gift-grid">
          {catalog.map((g) => (
            <button
              key={g.key}
              className="gift-tile"
              disabled={sendingKey === g.key || (sparks != null && sparks < g.cost)}
              onClick={() => send(g)}
            >
              <span className="gift-tile-emoji">{g.emoji}</span>
              <span className="gift-tile-name">{g.name}</span>
              <span className="gift-tile-cost">✨ {g.cost}</span>
            </button>
          ))}
        </div>

        <button className="ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
