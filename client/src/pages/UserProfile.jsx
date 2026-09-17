import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import GiftTray from "../components/GiftTray.jsx";
import Avatar, { isOnline } from "../components/Avatar.jsx";

function Stars({ value, onRate }) {
  return (
    <div className="stars">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={"star" + (n <= Math.round(value || 0) ? " on" : "")}
          onClick={() => onRate(n)}
        >
          ★
        </button>
      ))}
    </div>
  );
}

export default function UserProfile() {
  const { id } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [gifts, setGifts] = useState([]);
  const [showGifts, setShowGifts] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportSent, setReportSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [profile, giftList] = await Promise.all([
      api(`/users/${id}`),
      api(`/users/${id}/gifts`),
    ]);
    setData(profile);
    setGifts(giftList.gifts);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function rate(stars) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api(`/users/${id}/rating`, { method: "POST", body: { stars } });
      setData((d) => ({ ...d, rating: res.rating, myRating: res.myRating }));
    } finally {
      setBusy(false);
    }
  }

  async function toggleFan() {
    if (busy || !data) return;
    setBusy(true);
    try {
      const res = data.fans.amIFan
        ? await api(`/users/${id}/fan`, { method: "DELETE" })
        : await api(`/users/${id}/fan`, { method: "POST" });
      setData((d) => ({ ...d, fans: res.fans }));
    } finally {
      setBusy(false);
    }
  }

  async function toggleBlock() {
    setShowMenu(false);
    setBusy(true);
    try {
      const res = data.amIBlocking
        ? await api(`/users/${id}/block`, { method: "DELETE" })
        : await api(`/users/${id}/block`, { method: "POST" });
      setData((d) => ({ ...d, amIBlocking: res.blocked }));
    } finally {
      setBusy(false);
    }
  }

  async function sendReport() {
    setBusy(true);
    try {
      await api(`/users/${id}/report`, { method: "POST", body: { reason: reportReason } });
      setReportSent(true);
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <div className="page">
        <div className="pad muted">Loading…</div>
      </div>
    );
  }

  const { user, isSelf, rating, myRating, fans, amIBlocking } = data;

  return (
    <div className="page">
      <header className="page-head">
        <button className="ghost" onClick={() => nav(-1)}>
          ‹ Back
        </button>
        {!isSelf && (
          <button className="ghost" onClick={() => setShowMenu(true)}>
            ⋯
          </button>
        )}
      </header>

      <div className="card profile-preview" style={{ marginBottom: 14 }}>
        <Avatar user={user} size="lg" online={isOnline(user.lastSeenAt)} premium={user.isPremium} />
        <div>
          <div className="chat-title">
            {user.displayName}
            {user.age ? <span className="age">{user.age}</span> : null}
          </div>
          <div className="muted sm">
            {[user.city, user.gender, user.orientation].filter(Boolean).join(" · ") || "—"}
          </div>
        </div>
      </div>

      {amIBlocking && (
        <div className="card" style={{ marginBottom: 14, textAlign: "center" }}>
          <p className="muted sm">You've blocked {user.displayName}.</p>
          <button className="ghost" onClick={toggleBlock} disabled={busy}>
            Unblock
          </button>
        </div>
      )}

      {user.bio && <p className="bio card">{user.bio}</p>}

      {user.interests?.length > 0 && (
        <div className="tags" style={{ margin: "10px 0 16px" }}>
          {user.interests.map((t) => (
            <span key={t} className="tag">
              {t}
            </span>
          ))}
        </div>
      )}

      {user.prompts?.length > 0 && (
        <div className="prompt-cards">
          {user.prompts.map((p, i) => (
            <div key={i} className="card prompt-card">
              <div className="muted sm">{p.question}</div>
              <div>{p.answer}</div>
            </div>
          ))}
        </div>
      )}

      {!amIBlocking && (
        <>
          <div className="stat-row">
            <div className="stat-cell">
              <Stars value={isSelf ? rating.average || 0 : myRating || rating.average || 0} onRate={isSelf ? () => {} : rate} />
              <div className="muted sm">
                {rating.average ? rating.average.toFixed(1) : "—"} ({rating.count})
              </div>
            </div>
            <div className="stat-cell">
              <button className={"fan-btn" + (fans.amIFan ? " on" : "")} disabled={isSelf} onClick={toggleFan}>
                {fans.amIFan ? "★ Fan" : "☆ Be a fan"}
              </button>
              <div className="muted sm">{fans.count} fans</div>
            </div>
          </div>

          {!isSelf && (
            <button className="primary" style={{ width: "100%", marginTop: 14 }} onClick={() => setShowGifts(true)}>
              🎁 Send a gift
            </button>
          )}

          <div style={{ marginTop: 20 }}>
            <div className="section-label">Gifts received ({data.gifts.receivedCount})</div>
            {gifts.length === 0 ? (
              <p className="muted sm">No gifts yet.</p>
            ) : (
              <ul className="gift-feed">
                {gifts.map((g) => (
                  <li key={g.id}>
                    <span className="gift-emoji">{g.gift.emoji}</span>
                    <span>
                      <b>{g.sender.name}</b> sent {g.gift.name}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {showGifts && (
        <GiftTray
          recipients={[{ id: user.id, displayName: user.displayName }]}
          conversationId={null}
          onClose={() => setShowGifts(false)}
          onSent={() => {
            setShowGifts(false);
            load();
          }}
        />
      )}

      {showMenu && (
        <div className="modal-backdrop" onClick={() => setShowMenu(false)}>
          <div className="card sheet" onClick={(e) => e.stopPropagation()}>
            <button className="menu-item" onClick={toggleBlock}>
              {amIBlocking ? "Unblock" : "🚫 Block"} {user.displayName}
            </button>
            <button
              className="menu-item danger"
              onClick={() => {
                setShowMenu(false);
                setShowReport(true);
              }}
            >
              🚩 Report {user.displayName}
            </button>
            <button className="ghost" style={{ width: "100%", marginTop: 8 }} onClick={() => setShowMenu(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {showReport && (
        <div className="modal-backdrop" onClick={() => setShowReport(false)}>
          <div className="card sheet" onClick={(e) => e.stopPropagation()}>
            {reportSent ? (
              <>
                <h3>Report sent</h3>
                <p className="muted sm">Thanks — we'll take a look.</p>
                <button className="primary" onClick={() => setShowReport(false)}>
                  Done
                </button>
              </>
            ) : (
              <>
                <h3>Report {user.displayName}</h3>
                <label>
                  What's going on?
                  <textarea
                    rows={3}
                    value={reportReason}
                    onChange={(e) => setReportReason(e.target.value)}
                    placeholder="Tell us what happened…"
                  />
                </label>
                <div className="modal-actions">
                  <button className="ghost" onClick={() => setShowReport(false)}>
                    Cancel
                  </button>
                  <button className="primary" disabled={busy || !reportReason.trim()} onClick={sendReport}>
                    Submit
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
