import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, setToken, getToken } from "./api.js";

const AuthCtx = createContext(null);

async function claimDailyBonus(setUser, setBonus) {
  try {
    const res = await api("/me/daily-bonus", { method: "POST" });
    if (res.claimed) {
      setBonus(res.amount);
      setUser((u) => (u ? { ...u, sparks: res.sparks } : u));
    }
  } catch {
    /* not fatal — just skip the toast */
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bonus, setBonus] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!getToken()) {
        setLoading(false);
        return;
      }
      try {
        const { user } = await api("/me");
        if (alive) {
          setUser(user);
          claimDailyBonus(setUser, setBonus);
        }
      } catch {
        setToken("");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const login = useCallback(async (username, password) => {
    const { token, user } = await api("/auth/login", {
      method: "POST",
      body: { username, password },
    });
    setToken(token);
    setUser(user);
    claimDailyBonus(setUser, setBonus);
  }, []);

  const signup = useCallback(async (payload) => {
    const { token, user } = await api("/auth/signup", {
      method: "POST",
      body: payload,
    });
    setToken(token);
    setUser(user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    setToken("");
    setUser(null);
  }, []);

  return (
    <AuthCtx.Provider
      value={{ user, setUser, loading, login, signup, logout, bonus, clearBonus: () => setBonus(null) }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
