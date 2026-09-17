import { Routes, Route, NavLink, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./auth.jsx";
import Login from "./pages/Login.jsx";
import Discover from "./pages/Discover.jsx";
import Rooms from "./pages/Rooms.jsx";
import Matches from "./pages/Matches.jsx";
import Likes from "./pages/Likes.jsx";
import Chats from "./pages/Chats.jsx";
import Chat from "./pages/Chat.jsx";
import CallRoom from "./pages/CallRoom.jsx";
import Profile from "./pages/Profile.jsx";
import UserProfile from "./pages/UserProfile.jsx";
import Sparks from "./pages/Sparks.jsx";

function Shell({ children }) {
  const location = useLocation();
  const hideNav = /^\/(chats\/[^/]+(\/call)?|u\/[^/]+)$/.test(location.pathname);
  const { bonus, clearBonus } = useAuth();
  return (
    <div className="app">
      <div className="screen">{children}</div>
      {bonus != null && <BonusToast amount={bonus} onDone={clearBonus} />}
      {!hideNav && (
        <nav className="tabbar">
          <Tab to="/discover" icon="🔥" label="Discover" />
          <Tab to="/rooms" icon="🌐" label="Rooms" />
          <Tab to="/matches" icon="💞" label="Matches" />
          <Tab to="/chats" icon="💬" label="Chats" />
          <Tab to="/profile" icon="🙂" label="You" />
        </nav>
      )}
    </div>
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
        <Route path="/matches" element={<Matches />} />
        <Route path="/likes" element={<Likes />} />
        <Route path="/chats" element={<Chats />} />
        <Route path="/chats/:id" element={<Chat />} />
        <Route path="/chats/:id/call" element={<CallRoom />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/u/:id" element={<UserProfile />} />
        <Route path="/sparks" element={<Sparks />} />
        <Route path="*" element={<Navigate to="/discover" replace />} />
      </Routes>
    </Shell>
  );
}
