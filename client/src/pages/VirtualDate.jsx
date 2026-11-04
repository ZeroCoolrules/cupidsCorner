import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import Avatar from "../components/Avatar.jsx";

// Virtual date with a match: pick a scenario, make one choice per step,
// and the chemistry result is posted into your chat.
export default function VirtualDate() {
  const { userId } = useParams();
  const nav = useNavigate();
  const { setUser } = useAuth();
  const [partner, setPartner] = useState(null);
  const [scenarios, setScenarios] = useState([]);
  const [sparks, setSparks] = useState(0);
  const [scenario, setScenario] = useState(null);
  const [choices, setChoices] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api(`/users/${userId}`).then((d) => setPartner(d.user));
    api("/dates/scenarios").then((d) => {
      setScenarios(d.scenarios);
      setSparks(d.sparks);
    });
  }, [userId]);

  const step = scenario?.steps[choices.length];
  const pendingCost = scenario
    ? choices.reduce((sum, id, i) => sum + (scenario.steps[i].choices.find((c) => c.id === id)?.cost || 0), 0)
    : 0;

  async function choose(choice) {
    if (choice.cost && pendingCost + choice.cost > sparks) {
      setError(`Not enough sparks for that (${choice.cost} ✨).`);
      return;
    }
    setError("");
    const next = [...choices, choice.id];
    setChoices(next);
    if (next.length === scenario.steps.length) {
      setBusy(true);
      try {
        const res = await api("/dates", {
          method: "POST",
          body: { partnerId: Number(userId), scenarioKey: scenario.key, choices: next },
        });
        setResult(res);
        setUser((u) => (u ? { ...u, sparks: res.sparks } : u));
      } catch (err) {
        setError(err.message);
        setChoices([]);
      } finally {
        setBusy(false);
      }
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <button className="ghost" onClick={() => nav(-1)}>
          ←
        </button>
        <h2>Virtual date</h2>
        <div className="sparks-pill">✨ {sparks - pendingCost}</div>
      </header>

      {partner && (
        <div className="card profile-preview" style={{ marginBottom: 14 }}>
          <Avatar user={partner} size="lg" />
          <div className="chat-title">With {partner.displayName}</div>
        </div>
      )}
      {error && <div className="error">{error}</div>}

      {!scenario &&
        scenarios.map((s) => (
          <button key={s.key} className="card date-option" onClick={() => setScenario(s)}>
            <div className="chat-title">
              {s.emoji} {s.title}
            </div>
            <div className="muted sm">{s.blurb}</div>
          </button>
        ))}

      {scenario && step && !result && (
        <div className="card">
          <div className="date-progress">
            Step {choices.length + 1} of {scenario.steps.length}
          </div>
          <div className="chat-title">{step.title}</div>
          <p>{step.text}</p>
          {step.choices.map((c) => (
            <button key={c.id} className="ghost date-choice" disabled={busy} onClick={() => choose(c)}>
              {c.text}
            </button>
          ))}
        </div>
      )}

      {busy && <p className="muted pad">Wrapping up the date…</p>}

      {result && (
        <div className="card" style={{ textAlign: "center" }}>
          <div className="date-score">{result.score}%</div>
          <div className="chat-title">{result.verdict}!</div>
          <p className="muted sm">
            {result.sparksSpent ? `You spent ${result.sparksSpent} ✨ on treats. ` : ""}
            {partner?.displayName} will see this in your chat.
          </p>
          {result.conversationId && (
            <button className="primary" onClick={() => nav(`/chats/${result.conversationId}`)}>
              Open chat
            </button>
          )}
        </div>
      )}
    </div>
  );
}
