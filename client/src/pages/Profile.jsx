import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth.jsx";
import { api, apiUpload } from "../api.js";
import Avatar from "../components/Avatar.jsx";

const EMOJIS = ["💘", "🌻", "🎸", "🌵", "📚", "🏔️", "🌊", "🍜", "🎺", "🪩", "🔥", "✨"];
const COLORS = ["#ff6b8a", "#5b8def", "#3ec6a0", "#f4a259", "#7d5fff", "#ef476f", "#06d6a0", "#ffd166"];

function isPremiumActive(user) {
  return !!user.premiumUntil && new Date(user.premiumUntil.replace(" ", "T") + "Z") > new Date();
}

export default function Profile() {
  const { user, setUser, logout } = useAuth();
  const [form, setForm] = useState({
    displayName: user.displayName || "",
    age: user.age || "",
    gender: user.gender || "",
    orientation: user.orientation || "",
    city: user.city || "",
    bio: user.bio || "",
    avatarEmoji: user.avatarEmoji || "💘",
    avatarColor: user.avatarColor || "#ff6b8a",
    interests: (user.interests || []).join(", "),
  });
  const [prompts, setPrompts] = useState(
    [0, 1, 2].map((i) => user.prompts?.[i] || { question: "", answer: "" })
  );
  const [bank, setBank] = useState([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [premiumBusy, setPremiumBusy] = useState(false);
  const [premiumError, setPremiumError] = useState("");
  const fileRef = useRef(null);

  useEffect(() => {
    api("/prompts/bank").then((d) => setBank(d.bank));
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function setPrompt(i, field, value) {
    setPrompts((p) => p.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)));
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setSaved(false);
    try {
      const { user: updated } = await api("/me", {
        method: "PUT",
        body: {
          ...form,
          age: form.age ? Number(form.age) : null,
          interests: form.interests
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          prompts: prompts.filter((p) => p.question && p.answer),
        },
      });
      setUser(updated);
      setSaved(true);
    } finally {
      setBusy(false);
    }
  }

  async function onPickPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPhotoBusy(true);
    setPhotoError("");
    try {
      const formData = new FormData();
      formData.append("photo", file);
      const { user: updated } = await apiUpload("/me/photo", formData);
      setUser(updated);
    } catch (err) {
      setPhotoError(err.message);
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removePhoto() {
    setPhotoBusy(true);
    try {
      const { user: updated } = await api("/me/photo", { method: "DELETE" });
      setUser(updated);
    } finally {
      setPhotoBusy(false);
    }
  }

  async function goPremium() {
    setPremiumBusy(true);
    setPremiumError("");
    try {
      const { user: updated } = await api("/me/premium", { method: "POST" });
      setUser(updated);
    } catch (err) {
      setPremiumError(err.message);
    } finally {
      setPremiumBusy(false);
    }
  }

  const premiumActive = isPremiumActive(user);

  return (
    <div className="page">
      <header className="page-head">
        <h2>Your profile</h2>
        <button className="ghost" onClick={logout}>
          Log out
        </button>
      </header>

      <div className="profile-preview card">
        <button type="button" className="photo-edit" onClick={() => fileRef.current?.click()} disabled={photoBusy}>
          <Avatar user={{ photoUrl: user.photoUrl, avatarEmoji: form.avatarEmoji, avatarColor: form.avatarColor }} size="lg" premium={premiumActive} />
          <span className="photo-edit-badge">📷</span>
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickPhoto} />
        <div style={{ flex: 1 }}>
          <div className="chat-title">
            {form.displayName || "You"}
            {form.age ? <span className="age">{form.age}</span> : null}
          </div>
          <div className="muted sm">
            {[form.city, form.gender, form.orientation].filter(Boolean).join(" · ") || "—"}
          </div>
          {user.photoUrl && (
            <button type="button" className="profile-link" onClick={removePhoto} disabled={photoBusy}>
              Remove photo
            </button>
          )}
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="sparks-pill">✨ {user.sparks}</div>
          <Link to="/sparks" className="profile-link">
            Buy sparks
          </Link>
          <br />
          <Link to={`/u/${user.id}`} className="profile-link">
            Public view
          </Link>
        </div>
      </div>
      {photoError && <div className="error">{photoError}</div>}

      <div className="card premium-card">
        {premiumActive ? (
          <>
            <div className="chat-title">👑 Premium active</div>
            <div className="muted sm">Until {new Date(user.premiumUntil.replace(" ", "T") + "Z").toLocaleString()}</div>
          </>
        ) : (
          <>
            <div className="chat-title">👑 Go Premium</div>
            <div className="muted sm">See who liked you + appear first in Discover — 200 ✨ / 7 days.</div>
          </>
        )}
        {premiumError && <div className="error">{premiumError}</div>}
        <button className="primary" style={{ marginTop: 10 }} disabled={premiumBusy} onClick={goPremium}>
          {premiumActive ? "Extend +7 days" : "Activate Premium"}
        </button>
      </div>

      <form className="card" onSubmit={save}>
        <label>
          Display name
          <input value={form.displayName} onChange={set("displayName")} required />
        </label>
        <div className="row">
          <label>
            Age
            <input type="number" value={form.age} onChange={set("age")} />
          </label>
          <label>
            City
            <input value={form.city} onChange={set("city")} />
          </label>
        </div>
        <div className="row">
          <label>
            Gender
            <input value={form.gender} onChange={set("gender")} />
          </label>
          <label>
            Looking for
            <input value={form.orientation} onChange={set("orientation")} />
          </label>
        </div>
        <label>
          Bio
          <textarea value={form.bio} onChange={set("bio")} rows={3} maxLength={280} />
        </label>
        <label>
          Interests (comma separated)
          <input value={form.interests} onChange={set("interests")} placeholder="hiking, film, tacos" />
        </label>

        <div className="picker">
          <span>Avatar</span>
          <div className="emoji-row">
            {EMOJIS.map((e) => (
              <button
                type="button"
                key={e}
                className={"chip" + (form.avatarEmoji === e ? " on" : "")}
                onClick={() => setForm((f) => ({ ...f, avatarEmoji: e }))}
              >
                {e}
              </button>
            ))}
          </div>
          <div className="emoji-row">
            {COLORS.map((c) => (
              <button
                type="button"
                key={c}
                className={"swatch" + (form.avatarColor === c ? " on" : "")}
                style={{ background: c }}
                onClick={() => setForm((f) => ({ ...f, avatarColor: c }))}
              />
            ))}
          </div>
        </div>

        <div className="section-label" style={{ marginTop: 6 }}>
          Prompts
        </div>
        {prompts.map((p, i) => (
          <div key={i} className="prompt-row">
            <select value={p.question} onChange={(e) => setPrompt(i, "question", e.target.value)}>
              <option value="">Pick a prompt…</option>
              {bank.map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </select>
            <input
              value={p.answer}
              onChange={(e) => setPrompt(i, "answer", e.target.value)}
              placeholder="Your answer"
              maxLength={300}
            />
          </div>
        ))}

        <button className="primary" disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </button>
        {saved && <div className="ok">Saved ✓</div>}
      </form>
    </div>
  );
}
