import { Link, useNavigate } from "react-router-dom";
import { usePublicConfig } from "../lib/config.js";
import SafetyNotice, { ScreeningStatement } from "../components/SafetyNotice.jsx";

const UPDATED = "November 24, 2026";

// Who "we" are, from the server's LEGAL_NAME and LEGAL_ADDRESS settings.
function WhoWeAre({ config }) {
  const name = config.legalName;
  return (
    <p>
      Cupid's Corner{name ? ` is run by ${name}` : " is the service at this site"}
      {config.legalAddress ? `, ${config.legalAddress}` : ""}. In these pages “we” and “us” mean {name || "Cupid's Corner"}.
    </p>
  );
}

function Contact({ email }) {
  return email ? <a href={`mailto:${email}`}>{email}</a> : <span>the Report button in the app</span>;
}

function Terms({ email, config }) {
  return (
    <>
      <h2>Terms of Service</h2>
      <p className="muted sm">Last updated {UPDATED}</p>
      <WhoWeAre config={config} />
      <h3>Who can use Cupid's Corner</h3>
      <p>You must be at least 18 years old. By creating an account you confirm that you are 18 or older and that you can legally agree to these terms. One account per person. You may not use Cupid's Corner if we have banned you before, or if you are required to register as a sex offender.</p>
      <h3>Your account</h3>
      <p>Keep your password private. You're responsible for what happens on your account. Give accurate information about yourself, including your age and photos that show you.</p>
      <h3>How to behave</h3>
      <p>Follow the <Link to="/guidelines">Community Guidelines</Link>. We can remove content and suspend or delete accounts that break them, with or without notice.</p>
      <h3>Sparks, Premium and gifts</h3>
      <p>Sparks are a virtual in-app currency. They have no cash value, can't be exchanged for money, and can't be transferred outside the app. Purchases are final except where the law requires a refund. Premium is bought with sparks and lasts for the period shown when you buy it. It does not renew by itself and you are never charged again automatically.</p>
      <p>Founding member and invite rewards are gifts from us. We may end or change an offer for people who have not yet claimed it, and we may take back rewards obtained through fake accounts or abuse.</p>
      <h3>Meeting people</h3>
      <ScreeningStatement />
      <p>A ✔ verified badge only means a selfie matched the profile photo. You are responsible for your own safety when you talk to or meet anyone you find here. Members post and host meetups themselves; we do not organise or supervise them. Read our <Link to="/safety">safety advice</Link> before you meet.</p>
      <h3>Cupid, the AI matchmaker</h3>
      <p>Cupid is an artificial intelligence, not a person, in chat and on the phone. Its suggestions can be wrong, and it is not a counselor or a substitute for professional advice. Paid coach sessions are charged in sparks at the price shown before you pay.</p>
      <h3>Your content</h3>
      <p>You own what you post. You give us permission to host and show it inside the app so the service works. Don't post anything you don't have the right to share.</p>
      <h3>Ending your account</h3>
      <p>You can delete your account at any time from your profile. Deletion is permanent.</p>
      <h3>No warranty</h3>
      <p>The service is provided as is. To the extent the law allows, we aren't liable for indirect damages or for how other members behave.</p>
      {config.governingState && (
        <>
          <h3>Governing law</h3>
          <p>These terms are governed by the laws of the State of {config.governingState}, without regard to its conflict of law rules. This does not take away any consumer protection you have under the law of the state where you live.</p>
        </>
      )}
      <h3>Changes and contact</h3>
      <p>We may update these terms and will change the date above when we do. Questions: <Contact email={email} />.</p>
    </>
  );
}

function Privacy({ email, config }) {
  return (
    <>
      <h2>Privacy Policy</h2>
      <p className="muted sm">Last updated {UPDATED}</p>
      <WhoWeAre config={config} />
      <h3>What we collect</h3>
      <ul>
        <li>Account details: username, a hashed password, age, and the profile you write (name, gender, what you're looking for, city, bio, interests, prompts, answers to profile questions and to the compatibility quiz, photos and captions).</li>
        <li>Activity: likes and passes, winks, matches, messages, posts and comments, meetups you post (including the private exact place) or ask to join, gifts, ratings, fans, invites, reports and blocks, and when you were last active.</li>
        <li>Verification selfies, only if you choose to verify. A person compares the selfie with your profile photo; we do not use face recognition software. We delete the selfie once it has been reviewed.</li>
        <li>Purchases: Stripe processes payments. We never see or store your card number.</li>
        <li>Coach calls: if you buy a phone session with Cupid, our voice provider handles the call audio so the AI can answer you.</li>
        <li>Technical data: your IP address, used briefly to limit abuse, and a sign-in token kept in your browser. We do not use advertising cookies or trackers.</li>
      </ul>
      <p>If your account came over from one of our earlier dating sites, we hold the profile and email address you gave that site.</p>
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
      <p>The compatibility quiz is optional. Some of its questions touch on faith, politics, children, money and intimacy. We use your answers only to work out how well you fit with other members. Other members never see your answers. They see a fit percentage and the topics where the two of you line up or differ, which can hint at how you answered.</p>
      <h3>How long we keep it</h3>
      <p>We keep your information while you have an account. Copies may remain in backups for a short time after you delete it, and we keep payment records as long as tax and accounting rules require.</p>
      <h3>Adults only</h3>
      <p>Cupid's Corner is for people 18 and older. We do not knowingly collect information from anyone under 18, and we delete such accounts when we find them.</p>
      <h3>Your choices</h3>
      <p>You can edit your profile at any time, block people, and delete your account from your profile page. Deleting your account removes your profile, photos, matches and messages from our database. You can also ask us for a copy of your information, or ask us to correct or delete it, using the contact below. We answer within 45 days and will not treat you differently for asking. Depending on where you live, you may have further rights under your state's privacy law.</p>
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
        <li><b>No selling.</b> No escorting, paid dates, paid companionship, sugar arrangements, spam, scams, or asking people for money.</li>
        <li><b>Meetups are for meeting.</b> Public places, honest descriptions, and no pressure on anyone to stay or to share where they live.</li>
        <li><b>Keep it legal.</b> Nothing illegal, and never share someone's private information.</li>
      </ul>
      <h3>If something goes wrong</h3>
      <p>Use Report and Block on any profile. If you are in danger, contact local emergency services first. You can also reach us at <Contact email={email} />.</p>
    </>
  );
}

function Safety() {
  return (
    <>
      <h2>Staying safe</h2>
      <p>Most people here are who they say they are. A few are not, on any dating site. Please read this before you chat or meet.</p>
      <SafetyNotice full />
      <p>Every profile has Report and Block. Use them. We read every report.</p>
    </>
  );
}

const DOCS = { terms: Terms, privacy: Privacy, guidelines: Guidelines, safety: Safety };

export default function Legal({ doc }) {
  const nav = useNavigate();
  const config = usePublicConfig();
  const { supportEmail } = config;
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
        <Doc email={supportEmail} config={config} />
      </div>
      <p className="legal-links muted sm">
        <Link to="/terms">Terms</Link> · <Link to="/privacy">Privacy</Link> · <Link to="/guidelines">Community Guidelines</Link> · <Link to="/safety">Safety</Link>
      </p>
    </div>
  );
}
