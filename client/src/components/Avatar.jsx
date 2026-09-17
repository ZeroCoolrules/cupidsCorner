// Renders a real photo when the user has one, falling back to their emoji
// avatar on a colored circle. Optional presence dot + premium crown badge.
export default function Avatar({ user, size = "md", online = false, premium = false, className = "" }) {
  if (!user) return null;
  const sizeClass = { xs: "xs", sm: "sm", md: "", lg: "lg" }[size] ?? "";
  return (
    <span className={`avatar-wrap ${className}`}>
      {user.photoUrl ? (
        <img className={`avatar ${sizeClass} photo`} src={user.photoUrl} alt={user.displayName || ""} />
      ) : (
        <span className={`avatar ${sizeClass}`} style={{ background: user.avatarColor }}>
          {user.avatarEmoji}
        </span>
      )}
      {online && <span className="online-dot" />}
      {premium && <span className="premium-badge">👑</span>}
    </span>
  );
}

export function isOnline(lastSeenAt) {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt.replace(" ", "T") + "Z").getTime() < 60_000;
}
