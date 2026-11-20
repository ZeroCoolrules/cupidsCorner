import { Routes, Route, NavLink, Navigate, useLocation, useNavigate } from "react-router-dom";
import Avatar from "./components/Avatar.jsx";
import { useAuth } from "./auth.jsx";
import Login from "./pages/Login.jsx";
import Discover from "./pages/Discover.jsx";
import Rooms from "./pages/Rooms.jsx";
import Live from "./pages/Live.jsx";
import LiveRoom from "./pages/LiveRoom.jsx";
import Matches from "./pages/Matches.jsx";
import Likes from "./pages/Likes.jsx";
import Chats from "./pages/Chats.jsx";
import Chat from "./pages/Chat.jsx";
import CallRoom from "./pages/CallRoom.jsx";
import Profile from "./pages/Profile.jsx";
import UserProfile from "./pages/UserProfile.jsx";
import Sparks from "./pages/Sparks.jsx";
import VirtualDate from "./pages/VirtualDate.jsx";
import AdminVerifications from "./pages/AdminVerifications.jsx";
import AdminReports from "./pages/AdminReports.jsx";
import Legal from "./pages/Legal.jsx";

const legalRoutes = [
  <Route key="terms" path="/terms" element={<Legal doc="terms" />} />,
  <Route key="privacy" path="/privacy" element={<Legal doc="privacy" />} />,
  <Route key="guidelines" path="/guidelines" element={<Legal doc="guidelines" />} />,
];

function Shell({ children }) {
  const location = useLocation();
  const hideNav = /^\/(chats\/[^/]+(\/call)?|u\/[^/]+|date\/[^/]+|live\/[^/]+)$/.test(location.pathname);
  const { bonus, clearBonus } = useAuth();
  return (
    <div className="app">
      {!hideNav && <TopNav />}
      <div className="screen">{children}</div>
      {bonus != null && <BonusToast amount={bonus} onDone={clearBonus} />}
      {!hideNav && (
        <nav className="tabbar">
          <Tab to="/discover" icon="🔥" label="Discover" />
          <Tab to="/live" icon="📡" label="Live" />
          <Tab to="/rooms" icon="🌐" label="Rooms" />
          <Tab to="/matches" icon="💞" label="Matches" />
          <Tab to="/chats" icon="💬" label="Chats" />
          <Tab to="/profile" icon="🙂" label="You" />
        </nav>
      )}
    </div>
  );
}

// Desktop top bar (StreamHub layout). Hidden on phones, where the bottom
// tab bar does the same job.
function TopNav() {
  const { user } = useAuth();
  const nav = useNavigate();
  const link = ({ isActive }) => "topnav-link" + (isActive ? " active" : "");
  return (
    <header className="topnav">
      <NavLink to="/discover" className="brand">
        <span className="brand-mark">💘</span>
        <span className="brand-text">
          <b>Cupid's Corner</b>
          <small>LIVE · DATING</small>
        </span>
      </NavLink>
      <nav className="topnav-links">
        <NavLink to="/discover" className={link}>🔥 Discover</NavLink>
        <NavLink to="/live" className={link}>📡 Live</NavLink>
        <NavLink to="/rooms" className={link}>🌐 Rooms</NavLink>
        <NavLink to="/matches" className={link}>💞 Matches</NavLink>
        <NavLink to="/chats" className={link}>💬 Chats</NavLink>
      </nav>
      <div className="topnav-right">
        <NavLink to="/sparks" className="sparks-pill">✨ {user?.sparks ?? 0}</NavLink>
        <button className="go-live-btn" onClick={() => nav("/live?go=1")}>● Go Live</button>
        <NavLink to="/profile" className="topnav-me" title="Your profile">
          <Avatar user={user} size="sm" />
        </NavLink>
      </div>
    </header>
  );
}

function BonusToast({ amount, onDone }) {
  return (
    <div className="bonus-toast" onAnimationEnd={onDone}>
      ✨ Daily bonus: +{amount} sparks!
    </div>
  );
}

function Tab({ to, icon, label }) {
  return (
    <NavLink to={to} className={({ isActive }) => "tab" + (isActive ? " active" : "")}>
      <span className="tab-icon">{icon}</span>
      <span className="tab-label">{label}</span>
    </NavLink>
  );
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="app">
        <div className="screen center">
          <div className="pulse">💘</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="app">
        <div className="screen">
          <Routes>
            <Route path="/login" element={<Login />} />
            {legalRoutes}
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </div>
      </div>
    );
  }

  return (
    <Shell>
      <Routes>
        <Route path="/discover" element={<Discover />} />
        <Route path="/rooms" element={<Rooms />} />
        <Route path="/live" element={<Live />} />
        <Route path="/live/:id" element={<LiveRoom />} />
        <Route path="/matches" element={<Matches />} />
        <Route path="/likes" element={<Likes />} />
        <Route path="/chats" element={<Chats />} />
        <Route path="/chats/:id" element={<Chat />} />
        <Route path="/chats/:id/call" element={<CallRoom />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/u/:id" element={<UserProfile />} />
        <Route path="/sparks" element={<Sparks />} />
        <Route path="/date/:userId" element={<VirtualDate />} />
        <Route path="/admin/verifications" element={<AdminVerifications />} />
        <Route path="/admin/reports" element={<AdminReports />} />
        {legalRoutes}
        <Route path="*" element={<Navigate to="/discover" replace />} />
      </Routes>
    </Shell>
  );
}
