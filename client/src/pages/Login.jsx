import { useEffect, useState } from "react";
import { useAuth } from "../auth.jsx";
import { api } from "../api.js";

const FEATURES = [
  { icon: "🔥", title: "Discover & match", body: "Swipe, match, and start talking." },
  { icon: "🌐", title: "Live webcam rooms", body: "Public rooms — watch a few people's cams at once, no match needed." },
  { icon: "💬", title: "Real messaging", body: "DMs and group chats that actually work, powered by Stream." },
  { icon: "🎁", title: "Gifts & fans", body: "Rate profiles, become a fan, send virtual gifts." },
  { icon: "💘", title: "Cupid, your AI wingman", body: "Openers, date ideas, and honest advice, day or night." },
];

const EMOJIS = ["💘", "🌻", "🎸", "🌵", "📚", "🏔️", "🌊", "🍜", "🎺", "🪩", "🔥", "✨"];
const COLORS = ["#7cc8ff", "#5b8def", "#3ec6a0", "#f4a259", "#7d5fff", "#4dd0e1", "#06d6a0", "#ffd166"];

export default function Login() {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    username: "",
    password: "",
    displayName: "",
    age: "",
    gender: "",
    orientation: "",
    city: "",
    bio: "",
    avatarEmoji: "💘",
    avatarColor: "#7cc8ff",
  });

  const [stats, setStats] = useState(null);
  useEffect(() => {
    api("/public/stats").then(setStats).catch(() => {});
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "login") {
        await login(form.username.trim(), form.password);
      } else {
        await signup({
          ...form,
          username: form.username.trim(),
          age: form.age ? Number(form.age) : null,
        });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-hero">
        <div className="logo">💘</div>
        <h1>Cupid's Corner</h1>
        <p>Dating, live webcam rooms, real messaging, and an AI wingman — one place to meet people.</p>
        {stats && (
          <div className="stat-strip">
            <span>
              <b>{stats.members}</b> members
            </span>
            <span>
              <b>{stats.rooms}</b> live rooms
            </span>
            <span>
              <b>{stats.matches}</b> matches made
            </span>
            <span>
              <b>{stats.gifts}</b> gifts sent
            </span>
          </div>
        )}
      </div>

      <div className="feature-grid">
        {FEATURES.map((f) => (
          <div className="feature-card" key={f.title}>
            <div className="feature-icon">{f.icon}</div>
            <div className="feature-title">{f.title}</div>
            <div className="feature-body">{f.body}</div>
          </div>
        ))}
      </div>

      <form className="card auth-card" onSubmit={submit}>
        <div className="segmented">
          <button
            type="button"
            className={mode === "login" ? "on" : ""}
            onClick={() => setMode("login")}
          >
            Log in
          </button>
          <button
            type="button"
            className={mode === "signup" ? "on" : ""}
            onClick={() => setMode("signup")}
          >
            Sign up
          </button>
        </div>

        <label>
          Username
          <input value={form.username} onChange={set("username")} autoCapitalize="none" required />
        </label>
        <label>
          Password
          <input type="password" value={form.password} onChange={set("password")} required />
        </label>

        {mode === "signup" && (
          <>
            <label>
              Display name
              <input value={form.displayName} onChange={set("displayName")} required />
            </label>
            <div className="row">
              <label>
                Age
                <input type="number" min="18" max="120" value={form.age} onChange={set("age")} />
              </label>
              <label>
                City
                <input value={form.city} onChange={set("city")} />
              </label>
            </div>
            <div className="row">
              <label>
                Gender
                <input value={form.gender} onChange={set("gender")} placeholder="woman, man, nonbinary…" />
              </label>
              <label>
                Looking for
                <input value={form.orientation} onChange={set("orientation")} placeholder="straight, bi, queer…" />
              </label>
            </div>
            <label>
              Bio
              <textarea value={form.bio} onChange={set("bio")} rows={2} maxLength={280} />
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
          </>
        )}

        {error && <div className="error">{error}</div>}

        <button className="primary" disabled={busy}>
          {busy ? "…" : mode === "login" ? "Log in" : "Create account"}
        </button>

        {mode === "login" && (
          <p className="hint">
            Try a demo account — username <code>ava</code>, <code>leo</code>, or{" "}
            <code>mira</code>, password <code>password123</code>.
          </p>
        )}
      </form>
    </div>
  );
}
