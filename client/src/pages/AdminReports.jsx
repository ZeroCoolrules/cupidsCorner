import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import Avatar from "../components/Avatar.jsx";

// Moderation queue: open reports grouped by the person reported, most
// reporters first. Admins can suspend the account or dismiss the reports.
export default function AdminReports() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const nav = useNavigate();

  useEffect(() => {
    api("/admin/reports")
      .then((d) => setItems(d.items))
      .catch((err) => setError(err.message));
  }, []);

  async function act(userId, action) {
    setBusyId(userId);
    setError("");
    try {
      await api(`/admin/users/${userId}/${action}`, {
        method: "POST",
        body: action === "ban" ? { reason: "Community guidelines" } : {},
      });
      setItems((list) => list.filter((i) => i.user?.id !== userId));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <button className="ghost" onClick={() => nav(-1)}>
          ←
        </button>
        <h2>Reports</h2>
        <span />
      </header>
      {error && <div className="error">{error}</div>}
      {items && items.length === 0 && <p className="muted pad">No open reports.</p>}
      {items?.map((i) => (
        <div key={i.user?.id} className="card" style={{ marginBottom: 14 }}>
          <div className="profile-preview">
            <Avatar user={i.user || {}} size="lg" />
            <div>
              <div className="chat-title">
                {i.user?.displayName} {i.user?.age ? <span className="age">{i.user.age}</span> : null}
              </div>
              <div className="muted sm">
                Reported by {i.reporterCount} {i.reporterCount === 1 ? "person" : "people"}
                {i.banned ? " · already suspended" : ""}
              </div>
            </div>
          </div>
          <ul className="report-reasons">
            {i.reports.map((r) => (
              <li key={r.id}>{r.reason}</li>
            ))}
          </ul>
          <div className="row">
            <button className="ghost" disabled={busyId === i.user?.id} onClick={() => act(i.user.id, "dismiss-reports")}>
              Dismiss
            </button>
            <button className="primary danger" disabled={busyId === i.user?.id || i.banned} onClick={() => act(i.user.id, "ban")}>
              Suspend account
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
