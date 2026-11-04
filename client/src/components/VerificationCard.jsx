import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, apiUpload } from "../api.js";

// Photo verification: upload a selfie, an admin compares it to the profile
// photo, and approved members get a ✔ badge (and rank higher in Discover).
export default function VerificationCard() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef(null);

  useEffect(() => {
    api("/me/verification").then(setState).catch(() => setState(null));
  }, []);

  async function onPick(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("selfie", file);
      const { verification } = await apiUpload("/me/verification", fd);
      setState((s) => ({ ...s, verification }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;
  const status = state.verification?.status;

  return (
    <div className="card premium-card">
      {state.isVerified ? (
        <div className="chat-title">
          <span className="verified">✔</span> You're photo verified
        </div>
      ) : (
        <>
          <div className="chat-title">✔ Get verified</div>
          <div className="muted sm">
            {status === "pending"
              ? "Thanks! Your selfie is waiting for review."
              : status === "rejected"
                ? "Your last selfie didn't match your photos. Try again in good light, facing the camera."
                : "Upload a selfie that matches your profile photo. Verified members get a badge and show up higher in Discover. The selfie is private and deleted after review."}
          </div>
          {error && <div className="error">{error}</div>}
          {status !== "pending" && (
            <button className="primary" style={{ marginTop: 10 }} disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? "Uploading…" : "Upload a selfie"}
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" capture="user" hidden onChange={onPick} />
        </>
      )}
      {state.isAdmin && (
        <div style={{ marginTop: 10 }}>
          <Link to="/admin/verifications" className="profile-link">
            Review pending verifications
          </Link>
        </div>
      )}
    </div>
  );
}
