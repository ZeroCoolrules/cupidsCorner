import { Link } from "react-router-dom";

// Illinois (815 ILCS 518/10) asks a dating service to give its members safety
// advice and to say plainly whether it runs criminal background checks. We
// show it to everyone, on sign-up and on member profiles. The statement is
// bold, in capitals and at least 12-point type on purpose: keep it that way.
// If we ever start screening members, this wording has to change.
export const SCREENING_STATEMENT = "CUPID'S CORNER DOES NOT CONDUCT CRIMINAL BACKGROUND SCREENINGS ON ITS MEMBERS.";

export const SAFETY_TIPS = [
  "Anyone who is able to commit identity theft can also falsify a dating profile.",
  "There is no substitute for acting with caution when communicating with any stranger who wants to meet you.",
  "Never include your last name, email address, home address, phone number, place of work, or any other identifying information in your profile or first messages. Stop communicating with anyone who pressures you for personal or financial information or tries to trick you into revealing it.",
  "Never send money to someone you have met here, however good the reason sounds.",
  "If you choose to meet in person, always tell someone in your family or a friend where you are going and when you will return. Never agree to be picked up at your home. Always provide your own transportation to and from your date and meet in a public place with many people around.",
];

export function ScreeningStatement() {
  return (
    <p style={{ fontSize: 16, fontWeight: 700, textTransform: "uppercase", lineHeight: 1.4, margin: 0 }}>
      {SCREENING_STATEMENT}
    </p>
  );
}

export default function SafetyNotice({ full = false }) {
  return (
    <aside className="card safety-notice" aria-label="Safety notice">
      <ScreeningStatement />
      {full ? (
        <ul>
          {SAFETY_TIPS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      ) : (
        <p className="sm">
          Take care when you talk to or meet someone new. <Link to="/safety">Read our safety advice</Link>
        </p>
      )}
    </aside>
  );
}
