import { useEffect, useState } from "react";
import { api } from "../api.js";

let cached = null;

// Public app config (support email, demo mode). Fetched once per page load.
export function usePublicConfig() {
  const [config, setConfig] = useState(cached || { supportEmail: "", demoMode: false, minAge: 18 });
  useEffect(() => {
    if (cached) return;
    api("/public/config")
      .then((c) => {
        cached = c;
        setConfig(c);
      })
      .catch(() => {});
  }, []);
  return config;
}
