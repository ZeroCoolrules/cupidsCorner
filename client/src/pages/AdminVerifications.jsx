import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, getToken } from "../api.js";
import Avatar from "../components/Avatar.jsx";

// The selfie route needs the auth header, so fetch it as a blob.
function Selfie({ id }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let objectUrl = "";
    fetch(`/api/admin/verifications/${id}/selfie`, {
      headers: { authorization: `Bearer ${getToken()}` },
    })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (b) {
          objectUrl = URL.createObjectURL(b);
          setUrl(objectUrl);
        }
      });
    return () => objectUrl && URL.revokeObjectURL(objectUrl);
  }, [id]);
  return url ? <img className="verify-selfie" src={url} alt="Selfie" /> : <div className="verify-selfie muted sm">Loading…</div>;
}

export default function AdminVerifications() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const nav = useNavigate();

  async function load() {
    try {
      const { items } = await api("/admin/verifications");
      setItems(items);
    } catch (err) {
      setError(err.message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function decide(id, approve) {
    await api(`/admin/verifications/${id}/decision`, { method: "POST", body: { approve } });
    setItems((list) => list.filter((v) => v.id !== id));
  }

  return (
    <div className="page">
      <header className="page-head">
        <button className="ghost" onClick={() => nav(-1)}>
          ←
        </button>
        <h2>Verifications</h2>
        <span />
      </header>
      {error && <div className="error">{error}</div>}
      {items && items.length === 0 && <p className="muted pad">Nothing waiting for review.</p>}
      {items?.map((v) => (
        <div key={v.id} className="card" style={{ marginBottom: 14 }}>
          <div className="verify-pair">
            <div>
              <div className="muted sm">Profile photo</div>
              <Avatar user={v.user} size="lg" />
            </div>
            <div>
              <div className="muted sm">Selfie</div>
              <Selfie id={v.id} />
            </div>
          </div>
          <div className="chat-title" style={{ margin: "8px 0" }}>
            {v.user?.displayName} {v.user?.age ? <span className="age">{v.user.age}</span> : null}
          </div>
          <div className="row">
            <button className="ghost" onClick={() => decide(v.id, false)}>
              Reject
            </button>
            <button className="primary" onClick={() => decide(v.id, true)}>
              Approve
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
