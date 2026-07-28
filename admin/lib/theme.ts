"use client";

import { useEffect, useState } from "react";

// Kept in sync by hand with the inline theme-init script in app/layout.tsx,
// which sets the initial .dark class before this ever runs (before React
// hydrates, to avoid a flash of the wrong theme).
const THEME_KEY = "requital_theme";

export function useTheme() {
  // False until the effect below reads the real (script-applied) state —
  // matches the light-mode default the class-less SSR markup renders, so
  // there's nothing to reconcile on hydration.
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  function setTheme(nextIsDark: boolean) {
    document.documentElement.classList.toggle("dark", nextIsDark);
    localStorage.setItem(THEME_KEY, nextIsDark ? "dark" : "light");
    setIsDark(nextIsDark);
  }

  return { isDark, setTheme };
}
