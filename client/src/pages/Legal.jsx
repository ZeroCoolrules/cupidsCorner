import { Link, useNavigate } from "react-router-dom";
import { usePublicConfig } from "../lib/config.js";

const UPDATED = "November 4, 2026";

function Contact({ email }) {
  return email ? <a href={`mailto:${email}`}>{email}</a> : <span>the Report button in the app</span>;
}

function Terms({ email }) {
  return (
    <>
      <h2>Terms of Service</h2>
      <p className="muted sm">Last updated {UPDATED}</p>
      <h3>Who can use Cupid's Corner</h3>
      <p>You must be at least 18 years old. By creating an account you confirm that you are 18 or older and that you can legally agree to these terms. One account per person.</p>
      <h3>Your account</h3>
      <p>Keep your password private. You're responsible for what happens on your account. Give accurate information about yourself, including your age and photos that show you.</p>
      <h3>How to behave</h3>
      <p>Follow the <Link to="/guidelines">Community Guidelines</Link>. We can remove content and suspend or delete accounts that break them, with or without notice.</p>
      <h3>Sparks, Premium and gifts</h3>
      <p>Sparks are a virtual in-app currency. They have no cash value, can't be exchanged for money, and can't be transferred outside the app. Purchases are final except where the law requires a refund. Premium lasts for the period shown when you buy it.</p>
      <h3>Meeting people</h3>
      <p>We don't run criminal background checks, and a ✔ verified badge only means a selfie matched the profile photo. You are responsible for your own safety when you talk to or meet anyone you find here. Meet in public places and tell a friend where you're going.</p>
      <h3>Cupid, the AI matchmaker</h3>
      <p>Cupid is an AI. Its suggestions can be wrong, and it is not a counselor or a substitute for professional advice.</p>
      <h3>Your content</h3>
      <p>You own what you post. You give us permission to host and show it inside the app so the service works. Don't post anything you don't have the right to share.</p>
      <h3>Ending your account</h3>
      <p>You can delete your account at any time from your profile. Deletion is permanent.</p>
      <h3>No warranty</h3>
      <p>The service is provided as is. To the extent the law allows, we aren't liable for indirect damages or for how other members behave.</p>
      <h3>Changes and contact</h3>
      <p>We may update these terms and will change the date above when we do. Questions: <Contact email={email} />.</p>
    </>
  );
}

function Privacy({ email }) {
  return (
    <>
      <h2>Privacy Policy</h2>
      <p className="muted sm">Last updated {UPDATED}</p>
      <h3>What we collect</h3>
      <ul>
        <li>Account details: username, a hashed password, age, and the profile you write (name, gender, what you're looking for, city, bio, interests, prompts, photo).</li>
        <li>Activity: likes and passes, matches, messages, gifts, ratings, fans, reports and blocks, and when you were last active.</li>
        <li>Verification selfies, only if you choose to verify. We delete the selfie once it has been reviewed.</li>
        <li>Purchases: Stripe processes payments. We never see or store your card number.</li>
      </ul>
      <h3>How we use it</h3>
      <p>To run the app: show your profile to other members, rank who you see in Discover, deliver messages and calls, keep the community safe, and process purchases. We don't sell your personal information.</p>
      <h3>Who else handles it</h3>
      <ul>
        <li>Stream, for chat and video calls.</li>
        <li>Stripe, for payments.</li>
        <li>An AI provider, for messages you send to Cupid, when one is configured.</li>
        <li>Our hosting provider, which stores the database and photos.</li>
      </ul>
      <h3>Sensitive information</h3>
      <p>What you share about your gender, orientation and dating life is sensitive. Only share what you're comfortable with other members seeing.</p>
      <h3>Your choices</h3>
      <p>You can edit your profile at any time, block people, and delete your account from your profile page. Deleting your account removes your profile, photos, matches and messages from our database.</p>
      <h3>Contact</h3>
      <p>For privacy questions or requests: <Contact email={email} />.</p>
    </>
  );
}

function Guidelines({ email }) {
  return (
    <>
      <h2>Community Guidelines</h2>
      <p className="muted sm">Last updated {UPDATED}</p>
      <p>Cupid's Corner is for adults meeting other adults. Break these rules and we may remove content or suspend your account.</p>
      <ul>
        <li><b>18+ only.</b> Report anyone who seems to be under 18. We remove them right away.</li>
        <li><b>Be yourself.</b> No fake profiles, impersonation, or photos of other people.</li>
        <li><b>Respect no.</b> No harassment, threats, hate speech, or unwanted sexual messages.</li>
        <li><b>Keep cams clean in public rooms.</b> No nudity or sexual acts in rooms or on calls.</li>
        <li><b>No selling.</b> No escorting, paid dates, spam, scams, or asking people for money.</li>
        <li><b>Keep it legal.</b> Nothing illegal, and never share someone's private information.</li>
      </ul>
      <h3>If something goes wrong</h3>
      <p>Use Report and Block on any profile. If you are in danger, contact local emergency services first. You can also reach us at <Contact email={email} />.</p>
    </>
  );
}

const DOCS = { terms: Terms, privacy: Privacy, guidelines: Guidelines };

export default function Legal({ doc }) {
  const nav = useNavigate();
  const { supportEmail } = usePublicConfig();
  const Doc = DOCS[doc];
  return (
    <div className="page legal">
      <header className="page-head">
        <button className="ghost" onClick={() => (window.history.length > 1 ? nav(-1) : nav("/"))}>
          ←
        </button>
        <span />
      </header>
      <div className="card legal-body">
        <Doc email={supportEmail} />
      </div>
      <p className="legal-links muted sm">
        <Link to="/terms">Terms</Link> · <Link to="/privacy">Privacy</Link> · <Link to="/guidelines">Community Guidelines</Link>
      </p>
    </div>
  );
}
