import { useEffect, useState, useCallback } from "react";

const THEME_KEY = "ai-playlist-studio-theme";

// Cycle: auto -> light -> dark -> auto
const MODES = ["auto", "light", "dark"];

function ThemeToggle() {
  const [isLight, setIsLight] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState("auto"); // "auto", "light", or "dark"

  const applyTheme = useCallback((light) => {
    if (light) {
      document.documentElement.classList.add("light");
    } else {
      document.documentElement.classList.remove("light");
    }
    setIsLight(light);
  }, []);

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem(THEME_KEY);
    const mediaQuery = window.matchMedia("(prefers-color-scheme: light)");

    if (saved === "light") {
      setMode("light");
      applyTheme(true);
    } else if (saved === "dark") {
      setMode("dark");
      applyTheme(false);
    } else {
      setMode("auto");
      applyTheme(mediaQuery.matches);
    }
  }, [applyTheme]);

  // Listen for system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: light)");

    const handleChange = (e) => {
      if (mode === "auto") {
        applyTheme(e.matches);
      }
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleChange);
    } else if (mediaQuery.addListener) {
      mediaQuery.addListener(handleChange);
    }

    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener("change", handleChange);
      } else if (mediaQuery.removeListener) {
        mediaQuery.removeListener(handleChange);
      }
    };
  }, [mode, applyTheme]);

  const cycleMode = () => {
    const currentIndex = MODES.indexOf(mode);
    const nextMode = MODES[(currentIndex + 1) % MODES.length];
    setMode(nextMode);

    const mediaQuery = window.matchMedia("(prefers-color-scheme: light)");

    if (nextMode === "auto") {
      localStorage.removeItem(THEME_KEY);
      applyTheme(mediaQuery.matches);
    } else if (nextMode === "light") {
      localStorage.setItem(THEME_KEY, "light");
      applyTheme(true);
    } else {
      localStorage.setItem(THEME_KEY, "dark");
      applyTheme(false);
    }
  };

  // Prevent hydration mismatch
  if (!mounted) {
    return (
      <button className="icon-button theme-toggle" aria-label="Toggle theme">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="5" />
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
      </button>
    );
  }

  // Auto mode icon (monitor/display)
  const autoIcon = (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );

  // Light mode icon (sun)
  const lightIcon = (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );

  // Dark mode icon (moon)
  const darkIcon = (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="5" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  );

  const modeLabels = { auto: "Auto", light: "Light", dark: "Dark" };
  const ariaLabels = {
    auto: `Theme: auto (follows system). Click to switch to light mode`,
    light: `Theme: light. Click to switch to dark mode`,
    dark: `Theme: dark. Click to switch to auto mode`
  };

  const icons = { auto: autoIcon, light: lightIcon, dark: darkIcon };

  return (
    <button
      className="icon-button theme-toggle"
      onClick={cycleMode}
      aria-label={ariaLabels[mode]}
      title={`Theme: ${modeLabels[mode]} (click to cycle)`}
    >
      {icons[mode]}
    </button>
  );
}

export default ThemeToggle;
