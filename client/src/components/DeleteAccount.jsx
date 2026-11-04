import { useState } from "react";
import { api, setToken } from "../api.js";

// Two-step, in-page confirmation (the browser's confirm() isn't reliable
// in every webview), then a hard reload back to the landing page.
export default function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function remove(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/me", { method: "DELETE", body: { password } });
      setToken("");
      window.location.assign("/");
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="ghost danger-text" onClick={() => setOpen(true)}>
        Delete my account
      </button>
    );
  }
  return (
    <form className="card" onSubmit={remove}>
      <div className="chat-title">Delete your account?</div>
      <p className="muted sm">This permanently removes your profile, photos, matches, messages and sparks. It can't be undone.</p>
      <label htmlFor="delete-password">
        Enter your password to confirm
        <input id="delete-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      {error && <div className="error">{error}</div>}
      <div className="row">
        <button type="button" className="ghost" onClick={() => setOpen(false)} disabled={busy}>
          Keep my account
        </button>
        <button className="primary danger" disabled={busy || !password}>
          {busy ? "Deleting…" : "Delete forever"}
        </button>
      </div>
    </form>
  );
}
